// Billing policy (docs/billing-policy.md): webhook access enforcement.
// Disputes cancel the customer's Prompt Lab subscription immediately; refunds
// and every other event are recorded only and never touch Stripe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.join(path.resolve(testDir, '..'), 'api');
const webhookUrl = pathToFileURL(path.join(apiDir, 'billing', 'webhook.js')).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV', 'BILLING_ENABLED', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_YEARLY_PRICE_ID', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PROMPTLAB_BILLING_CONSOLE_FALLBACK',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const SECRET = 'whsec_policy_fixture';
const DISPUTE_CREATED = 1_800_000_000;

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

function configureEnv() {
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'PROMPTLAB_BILLING_CONSOLE_FALLBACK']) {
    delete process.env[key];
  }
  process.env.NODE_ENV = 'test';
  process.env.BILLING_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_policy_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
}

async function loadWebhook() {
  return (await import(`${webhookUrl}?t=${Date.now()}-${Math.random()}`)).default;
}

function signedRequest(event) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  return new Request('https://promptlab.tools/api/billing/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': `t=${timestamp},v1=${digest}` },
    body,
  });
}

function subscription(id, priceId, status, created = DISPUTE_CREATED - 86_400) {
  return { id, status, created, items: { data: [{ price: { id: priceId } }] } };
}

function disputeEvent(charge = 'ch_disputed') {
  return {
    id: 'evt_dispute', type: 'charge.dispute.created',
    data: { object: { id: 'du_123', object: 'dispute', charge, created: DISPUTE_CREATED, status: 'needs_response' } },
  };
}

function stripeFake({ subscriptions, cancelResponse } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ method: init.method || 'GET', path: parsed.pathname, search: parsed.search, auth: init.headers?.Authorization });
    assert.equal(parsed.hostname, 'api.stripe.com');
    if (parsed.pathname === '/v1/charges/ch_disputed') {
      return Response.json({ id: 'ch_disputed', customer: 'cus_disputed' });
    }
    if (parsed.pathname === '/v1/subscriptions' && (init.method || 'GET') === 'GET') {
      assert.equal(parsed.searchParams.get('customer'), 'cus_disputed');
      return Response.json({ data: subscriptions });
    }
    if (init.method === 'DELETE' && parsed.pathname.startsWith('/v1/subscriptions/')) {
      if (cancelResponse) return cancelResponse(parsed);
      return Response.json({ id: parsed.pathname.split('/').pop(), status: 'canceled' });
    }
    throw new Error(`Unexpected Stripe request ${init.method || 'GET'} ${parsed.pathname}`);
  };
  return { calls, fetch };
}

test('a dispute immediately cancels only Prompt Lab subscriptions that existed when it opened', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: [
      subscription('sub_monthly_active', 'price_monthly', 'active'),
      subscription('sub_yearly_past_due', 'price_yearly', 'past_due'),
      subscription('sub_other_product', 'price_other_product', 'active'),
      subscription('sub_already_canceled', 'price_monthly', 'canceled'),
      subscription('sub_resubscribed_later', 'price_monthly', 'active', DISPUTE_CREATED + 3600),
    ],
  });
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();

  const response = await webhook(signedRequest(disputeEvent()));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.access, 'canceled');

  const cancels = fake.calls.filter((call) => call.method === 'DELETE');
  assert.deepEqual(cancels.map((call) => call.path), [
    '/v1/subscriptions/sub_monthly_active',
    '/v1/subscriptions/sub_yearly_past_due',
  ]);
  for (const call of cancels) {
    assert.equal(call.auth, 'Bearer sk_test_policy_fixture');
    assert.match(new URLSearchParams(call.search).get('cancellation_details[comment]'), /payment disputed \(du_123\)/);
  }
});

test('an expanded disputed charge is used without another Stripe lookup', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: [subscription('sub_monthly_active', 'price_monthly', 'trialing')] });
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();

  const response = await webhook(signedRequest(disputeEvent({ id: 'ch_expanded', customer: 'cus_disputed' })));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access, 'canceled');
  assert.equal(fake.calls.some((call) => call.path.startsWith('/v1/charges/')), false);
});

test('a dispute with no cancelable Prompt Lab subscription changes nothing', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: [subscription('sub_old', 'price_monthly', 'canceled')] });
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();

  const response = await webhook(signedRequest(disputeEvent()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access, 'none');
  assert.equal(fake.calls.some((call) => call.method === 'DELETE'), false);
});

test('a subscription canceled concurrently is treated as already enforced', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: [subscription('sub_monthly_active', 'price_monthly', 'active')],
    cancelResponse: () => Response.json({ error: { message: 'No such subscription: sub_monthly_active' } }, { status: 404 }),
  });
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();

  const response = await webhook(signedRequest(disputeEvent()));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).access, 'canceled');
});

test('a failed dispute cancellation answers 5xx so Stripe redelivers the event', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: [subscription('sub_monthly_active', 'price_monthly', 'active')],
    cancelResponse: () => Response.json({ error: { message: 'Stripe is unavailable.' } }, { status: 500 }),
  });
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();

  const response = await webhook(signedRequest(disputeEvent()));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.retryable, true);
  assert.match(body.error, /Stripe is unavailable/);
});

test('refunds and other lifecycle events are recorded without changing access', async () => {
  configureEnv();
  globalThis.fetch = async (url) => { throw new Error(`Unexpected request ${url}`); };
  const webhook = await loadWebhook();

  const events = [
    { type: 'charge.refunded', data: { object: { id: 'ch_1', object: 'charge', customer: 'cus_1', amount: 900, amount_refunded: 900, refunded: true } } },
    { type: 'charge.refunded', data: { object: { id: 'ch_2', object: 'charge', customer: 'cus_1', amount: 900, amount_refunded: 450, refunded: false } } },
    { type: 'invoice.payment_failed', data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_1' } } },
    { type: 'charge.dispute.closed', data: { object: { id: 'du_1', charge: 'ch_1', status: 'won' } } },
    { type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } } },
  ];
  for (const event of events) {
    const response = await webhook(signedRequest(event));
    assert.equal(response.status, 200, event.type);
    assert.deepEqual(await response.json(), { ok: true, mode: 'noop', access: 'none' }, event.type);
  }
});
