// Regression tests for the Oct 29 2026 audit fixes (INT-02, INT-03, INT-04,
// INT-06, INT-07, SEC-A05, SEC-A07, SEC-A08, SEC-A10, AN-04, AN-07).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stripeBillingUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'stripeBilling.js')).href;
const telemetryStoreUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'telemetryStore.js')).href;
const clientTelemetryUrl = pathToFileURL(path.join(sourceDir, 'prompt-lab-extension', 'src', 'lib', 'telemetry.js')).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV', 'VERCEL_ENV', 'PROMPTLAB_TELEMETRY_PREFIX', 'PROMPTLAB_PROXY_ALLOWED_ORIGINS',
  'PROMPTLAB_WEB_ORIGIN', 'VITE_PROMPTLAB_WEB_ORIGIN', 'PROMPTLAB_BILLING_RECORD_TTL_DAYS',
  'PROMPTLAB_TELEMETRY_RECORD_TTL_DAYS', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_YEARLY_PRICE_ID',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

async function load(url) {
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

// Minimal Upstash REST fake: records every command and keeps SET NX state.
function redisFake() {
  const commands = [];
  const keys = new Set();
  const fetch = async (url, init = {}) => {
    const parts = new URL(String(url)).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const body = init.body == null ? null : String(init.body);
    commands.push({ parts, body });
    const [command, key, ...rest] = parts;
    if (command === 'set' && rest.includes('NX')) {
      if (keys.has(key)) return Response.json({ result: null });
      keys.add(key);
      return Response.json({ result: 'OK' });
    }
    return Response.json({ result: command === 'incr' ? 1 : 'OK' });
  };
  return { commands, fetch };
}

function redisConfig(extra = {}) {
  return {
    redisUrl: 'https://redis.example.test',
    redisToken: 'test-token',
    storagePrefix: 'promptlab:stripe',
    recordTtlSeconds: 86_400,
    eventListLimit: 1000,
    consoleFallback: false,
    monthlyPriceId: 'price_monthly',
    yearlyPriceId: 'price_yearly',
    ...extra,
  };
}

test('INT-04: webhook records take customer and subscription ids from the right fields', async () => {
  const { buildStripeWebhookRecord } = await load(stripeBillingUrl);
  const config = redisConfig();
  const session = buildStripeWebhookRecord({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', object: 'checkout.session', customer: 'cus_1', subscription: 'sub_1' } },
  }, config);
  assert.equal(session.eventId, 'evt_1');
  assert.equal(session.customerId, 'cus_1');
  assert.equal(session.subscriptionId, 'sub_1');

  const dispute = buildStripeWebhookRecord({
    id: 'evt_2', type: 'charge.dispute.created', data: { object: { id: 'du_1', object: 'dispute', charge: 'ch_1' } },
  }, config);
  assert.equal(dispute.customerId, '');
  assert.equal(dispute.subscriptionId, '');

  const subscription = buildStripeWebhookRecord({
    id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_9', object: 'subscription', customer: 'cus_9' } },
  }, config);
  assert.equal(subscription.customerId, 'cus_9');
  assert.equal(subscription.subscriptionId, 'sub_9');

  const customer = buildStripeWebhookRecord({
    id: 'evt_4', type: 'customer.updated', data: { object: { id: 'cus_7', object: 'customer' } },
  }, config);
  assert.equal(customer.customerId, 'cus_7');
  assert.equal(customer.subscriptionId, '');

  const invoice = buildStripeWebhookRecord({
    id: 'evt_5', type: 'invoice.paid',
    data: { object: { id: 'in_1', object: 'invoice', customer: 'cus_5', parent: { subscription_details: { subscription: 'sub_5' } } } },
  }, config);
  assert.equal(invoice.subscriptionId, 'sub_5');
});

test('INT-02 / INT-03: a redelivered event is stored once, with expiring keys and no name', async () => {
  const { buildStripeWebhookRecord, persistStripeWebhookRecord } = await load(stripeBillingUrl);
  const fake = redisFake();
  globalThis.fetch = fake.fetch;
  const config = redisConfig();
  const event = {
    id: 'evt_dup',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_1', object: 'checkout.session', customer: 'cus_1', subscription: 'sub_1',
        customer_details: { email: 'buyer@example.com', name: 'Buyer Name' },
      },
    },
  };

  const first = await persistStripeWebhookRecord(buildStripeWebhookRecord(event, config), config);
  const second = await persistStripeWebhookRecord(buildStripeWebhookRecord(event, config), config);
  assert.deepEqual(first, { ok: true, mode: 'redis' });
  assert.deepEqual(second, { ok: true, mode: 'redis', duplicate: true });

  const rpush = fake.commands.filter(({ parts }) => parts[0] === 'rpush');
  assert.equal(rpush.length, 1, 'the arrival log gets one entry per event id');
  assert.equal(JSON.parse(rpush[0].body).customerName, undefined);
  assert.equal(rpush[0].body.includes('Buyer Name'), false);

  assert.deepEqual(fake.commands.find(({ parts }) => parts[0] === 'set' && parts.includes('NX')).parts,
    ['set', 'promptlab:stripe:event:evt_dup', '1', 'NX', 'EX', '86400']);
  assert.ok(fake.commands.some(({ parts }) => parts[0] === 'ltrim' && parts[1] === 'promptlab:stripe:events'));
  for (const key of ['promptlab:stripe:events', 'promptlab:stripe:customer:cus_1', 'promptlab:stripe:email:buyer@example.com', 'promptlab:stripe:subscription:sub_1']) {
    assert.ok(fake.commands.some(({ parts }) => parts[0] === 'expire' && parts[1] === key && parts[2] === '86400'), `${key} expires`);
  }
  assert.equal(fake.commands.some(({ parts }) => parts[0] === 'sadd'), false, 'no never-expiring index sets');
});

test('INT-06: a license check for a new account creates no Stripe customer', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  const { lookupBillingForClerk } = await load(stripeBillingUrl);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET' });
    return Response.json({ data: [] });
  };
  const result = await lookupBillingForClerk(redisConfig({ secretKey: 'sk_test_fixture' }), {
    clerkUserId: 'user_new', clerkEmail: 'new@example.com',
  });
  assert.equal(result.plan, 'free');
  assert.equal(result.customerId, '');
  assert.equal(calls.some(({ method }) => method === 'POST'), false);
});

test('INT-07 / SEC-A07: billing CORS refuses malformed extension origins', async () => {
  process.env.PROMPTLAB_PROXY_ALLOWED_ORIGINS = 'https://listed.example';
  const { isAllowedCorsOrigin } = await load(stripeBillingUrl);
  assert.equal(isAllowedCorsOrigin('https://promptlab.tools'), true);
  assert.equal(isAllowedCorsOrigin('https://mobile.promptlab.tools'), true);
  assert.equal(isAllowedCorsOrigin('https://listed.example'), true);
  assert.equal(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(isAllowedCorsOrigin('chrome-extension://evil'), false);
  assert.equal(isAllowedCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmnop.evil'), false);
  assert.equal(isAllowedCorsOrigin('https://evil.example'), false);
});

test('SEC-A08: signature check accepts the right digest and rejects a near miss', async () => {
  const { verifyStripeSignature } = await load(stripeBillingUrl);
  const secret = 'whsec_fixture_value';
  const body = '{"id":"evt_1"}';
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${digest.toUpperCase()}`, secret), true);
  const nearMiss = `${digest.slice(0, -1)}${digest.endsWith('0') ? '1' : '0'}`;
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${nearMiss}`, secret), false);
  assert.equal(await verifyStripeSignature(body, `t=${timestamp},v1=${digest.slice(0, 10)}`, secret), false);
});

test('SEC-A10: upstream Stripe and Redis errors reach the client as generic text', async () => {
  const { clientErrorMessage } = await load(stripeBillingUrl);
  const originalError = console.error;
  console.error = () => {};
  try {
    const upstream = Object.assign(new Error('No such price: price_internal_123'), { upstream: 'stripe', status: 400 });
    assert.equal(clientErrorMessage(upstream, 'Could not create checkout.'), 'Could not create checkout.');
    const redis = Object.assign(new Error('WRONGPASS invalid token'), { upstream: 'redis' });
    assert.equal(clientErrorMessage(redis, 'Billing request failed.'), 'Billing request failed.');
  } finally {
    console.error = originalError;
  }
  assert.equal(clientErrorMessage(new Error('Add a verified email to your account and retry.'), 'x'),
    'Add a verified email to your account and retry.');
});

test('AN-04: preview and development deployments use their own telemetry prefix', async () => {
  const { defaultTelemetryPrefix, buildTelemetryConfig } = await load(telemetryStoreUrl);
  assert.equal(defaultTelemetryPrefix('production'), 'promptlab');
  assert.equal(defaultTelemetryPrefix(''), 'promptlab');
  assert.equal(defaultTelemetryPrefix('preview'), 'promptlab-preview');
  assert.equal(defaultTelemetryPrefix('development'), 'promptlab-development');
  process.env.VERCEL_ENV = 'preview';
  delete process.env.PROMPTLAB_TELEMETRY_PREFIX;
  assert.equal(buildTelemetryConfig().prefix, 'promptlab-preview');
  process.env.PROMPTLAB_TELEMETRY_PREFIX = 'custom';
  assert.equal(buildTelemetryConfig().prefix, 'custom');
});

test('AN-07 / INT-03: events carry no contact email; profile and contact keys expire', async () => {
  const { normalizeTelemetryEvent, persistTelemetryEvent } = await load(telemetryStoreUrl);
  const event = normalizeTelemetryEvent({
    event: 'billing.modal_opened', deviceId: 'pldev-1', telemetryEnabled: true,
    contactEmail: 'person@example.com', context: { plan: 'free' },
  });
  assert.equal(Object.hasOwn(event, 'contactEmail'), false);

  const identify = normalizeTelemetryEvent({
    event: 'identity.updated', deviceId: 'pldev-1', telemetryEnabled: true,
    contactEmail: 'person@example.com', context: { source: 'preferences', telemetryEnabled: true },
  });
  assert.equal(identify.contactEmail, 'person@example.com');

  const fake = redisFake();
  globalThis.fetch = fake.fetch;
  const config = {
    redisUrl: 'https://redis.example.test', redisToken: 'test-token', prefix: 'promptlab',
    eventListLimit: 2000, recordTtlSeconds: 3600, consoleFallback: false,
  };
  await persistTelemetryEvent(identify, config);
  const listed = fake.commands.find(({ parts }) => parts[0] === 'rpush');
  assert.equal(listed.body.includes('person@example.com'), false, 'the shared event list has no email');
  for (const key of ['promptlab:telemetry:profile:pldev-1', 'promptlab:telemetry:contact:person@example.com', 'promptlab:telemetry:telemetry:events']) {
    assert.ok(fake.commands.some(({ parts }) => parts[0] === 'expire' && parts[1] === key && parts[2] === '3600'), `${key} expires`);
  }
  assert.equal(fake.commands.some(({ parts }) => parts[0] === 'sadd'), false);
});

test('AN-07: the client event envelope never includes the contact email', async () => {
  const { buildTelemetryEnvelope, buildTelemetryIdentityPayload } = await load(clientTelemetryUrl);
  const state = { deviceId: 'pldev-1', telemetryEnabled: true, contactEmail: 'person@example.com' };
  const envelope = buildTelemetryEnvelope(state, 'plsess-1', 'billing.modal_opened', { plan: 'free' });
  assert.equal(Object.hasOwn(envelope, 'contactEmail'), false);
  assert.equal(buildTelemetryIdentityPayload(state, 'plsess-1').contactEmail, 'person@example.com');
});
