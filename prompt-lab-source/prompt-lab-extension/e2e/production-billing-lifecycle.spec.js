import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { runLifecycle, testCredentials } from '../../scripts/stripe-test-lifecycle.mjs';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

const exec = promisify(execFile);

test('@production isolated paid billing transitions and signed webhook replay', async ({ page }) => {
  test.skip(process.env.PROMPTLAB_BILLING_LIFECYCLE_SMOKE !== 'true', 'Explicit test billing scope only.');
  test.setTimeout(600_000);
  const { key } = testCredentials(process.env);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || input.href);
    if (url.hostname === 'api.stripe.com') {
      assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${key}`);
      if (url.pathname === '/v1/customers' && init.method === 'POST') {
        assert.ok(new URLSearchParams(init.body).get('metadata[promptlab_test_run]'), 'Untracked customer creation blocked');
      }
    }
    return originalFetch(input, init);
  };
  const prefix = `promptlab-test-${randomUUID()}`;
  const storeToken = randomUUID();
  const ownedCustomers = new Set();
  const deliveries = [];
  const failures = [];
  let task, sessionId, listener, webhook, license, monthlyCustomer;
  let signingSecret = '';
  let listenerOutput = '';
  let billingReady = false;
  const redis = async (...args) => JSON.parse((await exec('docker', ['exec', 'promptlab-billing-test', 'redis-cli', '--json', ...args])).stdout);
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (req.url.startsWith('/store/')) {
        assert.equal(req.headers.authorization, `Bearer ${storeToken}`);
        const args = req.url.slice('/store/'.length).split('/').map(decodeURIComponent);
        assert.ok(['rpush', 'set', 'sadd'].includes(args[0]));
        assert.ok(args[1].startsWith(`${prefix}:`));
        if (req.method === 'POST') args.push(body);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ result: await redis(...args) }));
        return;
      }
      assert.equal(req.url, '/webhook');
      const event = JSON.parse(body);
      // CLI may observe unrelated test events. Never persist or replay them.
      if (!ownedCustomers.has(event.data?.object?.customer)) { res.statusCode = 204; res.end(); return; }
      assert.equal(event.livemode, false);
      assert.ok(signingSecret && webhook);
      const response = await webhook(new Request('http://127.0.0.1/webhook', {
        method: 'POST', headers: { 'stripe-signature': req.headers['stripe-signature'] || '' }, body,
      }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).mode, 'redis');
      deliveries.push({ event, body });
      res.end('{}');
    } catch {
      failures.push('isolated webhook or store request failed');
      res.statusCode = 500; res.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const localUrl = `http://127.0.0.1:${server.address().port}`;
  Object.assign(process.env, {
    NODE_ENV: 'production', BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: key,
    KV_REST_API_URL: `${localUrl}/store`, KV_REST_API_TOKEN: storeToken,
    PROMPTLAB_BILLING_PREFIX: prefix,
  });
  // The fixture must prove purchased access, never an owner override.
  for (const name of Object.keys(process.env)) {
    if (/^PROMPTLAB_.*OWNER/.test(name)) delete process.env[name];
  }
  await page.addInitScript(() => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === appUrl.origin && url.pathname.startsWith('/api/billing/')) {
      if (url.pathname !== '/api/billing/license' || !billingReady) { await route.abort('blockedbyclient'); return; }
      const response = await license(new Request(request.url(), {
        method: request.method(), headers: request.headers(), body: request.postData() || undefined,
      }));
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
    } else if (forbiddenRequestCategory(request.url())) await route.abort('blockedbyclient');
    else await route.continue();
  });
  async function validate(expectedPlan, action = 'validate') {
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const response = await license(new Request(`${appUrl.origin}/api/billing/license`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', Origin: appUrl.origin },
      body: JSON.stringify({ action }),
    }));
    expect(response.status).toBe(action === 'activate' && expectedPlan === 'free' ? 404 : 200);
    if (response.status === 200) {
      const value = await response.json();
      expect(value.plan).toBe(expectedPlan);
      expect(value.customerId).toBe(monthlyCustomer);
      expect(value.billingPeriod).not.toBe('owner');
    }
  }
  try {
    listener = spawn('/tmp/stripe', ['listen', '--events', 'customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,charge.refunded', '--forward-to', `${localUrl}/webhook`], {
      env: { ...process.env, STRIPE_API_KEY: key }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const consume = chunk => {
      listenerOutput = (listenerOutput + chunk.toString()).slice(-8192);
      const match = listenerOutput.match(/whsec_[A-Za-z0-9]+/);
      if (match) { signingSecret = match[0]; process.env.STRIPE_WEBHOOK_SECRET = signingSecret; }
    };
    listener.stdout.on('data', consume); listener.stderr.on('data', consume);
    await expect.poll(() => Boolean(signingSecret), { timeout: 30_000 }).toBe(true);
    webhook = (await import('../../api/billing/webhook.js')).default;
    license = (await import('../../api/billing/license.js')).default;
    const report = await runLifecycle(process.env, () => {}, {
      async onCustomer({ period, customer, config, request }) {
        ownedCustomers.add(customer.id);
        if (period !== 'monthly') return;
        monthlyCustomer = customer.id;
        process.env.STRIPE_MONTHLY_PRICE_ID = config.monthlyPriceId;
        await request(`customers/${customer.id}`, { 'metadata[clerkUserId]': clerkUserId, 'metadata[clerk_user_id]': clerkUserId });
        // Search indexing must finish before the real handler can run; otherwise
        // its create-customer fallback could create an unowned fixture.
        await expect.poll(async () => {
          const query = encodeURIComponent(`metadata['clerkUserId']:'${clerkUserId}' OR metadata['clerk_user_id']:'${clerkUserId}'`);
          const result = await request(`customers/search?limit=1&query=${query}`);
          return result.data?.[0]?.id;
        }, { timeout: 90_000, intervals: [1000, 2000, 5000] }).toBe(customer.id);
        billingReady = true;
        task = await clerk.agentTasks.create({ onBehalfOf: { userId: clerkUserId }, permissions: '*',
          agentName: 'promptlab-isolated-billing', taskDescription: 'Verify test billing through an isolated backend; no production billing requests.',
          redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 600 });
        await page.goto(task.url, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
        sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
        expect(sessionId).toMatch(/^sess_/);
      },
      async onCheck(name, evidence) {
        if (!name.startsWith('monthly ')) return;
        await validate(evidence.plan);
        await validate(evidence.plan, 'activate');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
        if (evidence.plan === 'pro') await expect(page.getByText('Pro Monthly', { exact: true })).toBeVisible();
        else await expect(page.getByTestId('billing-trigger')).toHaveText('Upgrade');
        if (!name.includes('cancellation takes effect')) return;
        await expect.poll(() => deliveries.some(({ event }) => event.type === 'customer.subscription.deleted' && event.data.object.customer === monthlyCustomer), { timeout: 30_000 }).toBe(true);
        const active = deliveries.find(({ event }) => event.type === 'customer.subscription.created' && event.data.object.customer === monthlyCustomer);
        assert.ok(active, 'Expected genuine Stripe CLI delivery of activation');
        const replay = async body => {
          const timestamp = Math.floor(Date.now() / 1000);
          const digest = createHmac('sha256', signingSecret).update(`${timestamp}.${body}`).digest('hex');
          return webhook(new Request(`${localUrl}/webhook`, { method: 'POST', body,
            headers: { 'stripe-signature': `t=${timestamp},v1=${digest}` } }));
        };
        const invalid = await webhook(new Request(`${localUrl}/webhook`, { method: 'POST', body: active.body, headers: { 'stripe-signature': 'invalid' } }));
        expect(invalid.status).toBe(401);
        for (let i = 0; i < 2; i += 1) expect((await replay(active.body)).status).toBe(200);
        // Current storage is an arrival log, not an idempotent entitlement store.
        // Replaying an old active event must never restore purchased access.
        await validate('free');
        console.info('[test billing] genuine signed webhook persisted; duplicate/stale replay leaves entitlement Free; invalid signature rejected');
      },
    });
    console.info(JSON.stringify({ lifecyclePassed: report.passed, checks: report.checks.map(({ name }) => name), cleanup: report.cleanup }));
    assert.equal(report.passed, true, report.error || 'Lifecycle cleanup failed');
    expect(failures).toEqual([]);
    expect(deliveries.length).toBeGreaterThan(0);
    console.info(JSON.stringify({ checks: report.checks.map(({ name }) => name), cleanup: report.cleanup,
      paidBrowser: 'monthly transitions and reload passed', annual: 'Stripe API only',
      limitations: ['Webhook arrival log has no deduplication or event ordering guarantee.', 'Refund retains access while subscription is active; policy approval remains separate.'] }));
  } finally {
    billingReady = false;
    globalThis.fetch = originalFetch;
    if (listener) { listener.kill('SIGTERM'); await new Promise(resolve => { listener.once('exit', resolve); setTimeout(resolve, 3000); }); }
    await new Promise(resolve => server.close(resolve));
    if (sessionId) await clerk.sessions.revokeSession(sessionId);
    else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
    expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
  }
});
