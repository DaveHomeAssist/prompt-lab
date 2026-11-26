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

function invoice(subscriptionId, priceId = 'price_monthly') {
  return {
    id: 'in_disputed',
    ...(subscriptionId ? { subscription: subscriptionId } : {}),
    lines: { data: [{ price: { id: priceId } }] },
  };
}

// charge: what GET /v1/charges/ch_disputed returns. Defaults to an older API
// version shape that carries the invoice id on the charge.
function stripeFake({
  subscriptions,
  cancelResponse,
  charge = { id: 'ch_disputed', customer: 'cus_disputed', invoice: 'in_disputed' },
  invoiceBody = invoice('sub_monthly_active'),
  invoicePayments = null,
} = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ method: init.method || 'GET', path: parsed.pathname, search: parsed.search, auth: init.headers?.Authorization });
    assert.equal(parsed.hostname, 'api.stripe.com');
    if (parsed.pathname === '/v1/charges/ch_disputed') {
      assert.equal(parsed.search, '', 'no expansion: it fails on newer API versions');
      return Response.json(charge);
    }
    if (parsed.pathname === '/v1/invoice_payments') {
      assert.equal(parsed.searchParams.get('payment[payment_intent]'), 'pi_disputed');
      if (!invoicePayments) return Response.json({ error: { message: 'Unrecognized request URL' } }, { status: 404 });
      return Response.json({ data: invoicePayments });
    }
    if (parsed.pathname === '/v1/invoices/in_disputed') {
      return Response.json(invoiceBody);
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

const CUSTOMER_SUBSCRIPTIONS = [
  subscription('sub_monthly_active', 'price_monthly', 'active'),
  subscription('sub_yearly_past_due', 'price_yearly', 'past_due'),
  subscription('sub_other_product', 'price_other_product', 'active'),
  subscription('sub_already_canceled', 'price_monthly', 'canceled'),
  subscription('sub_resubscribed_later', 'price_monthly', 'active', DISPUTE_CREATED + 3600),
];

async function runDispute(fake, charge) {
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();
  const response = await webhook(signedRequest(disputeEvent(charge)));
  assert.equal(response.status, 200);
  const body = await response.json();
  const cancels = fake.calls.filter((call) => call.method === 'DELETE').map((call) => call.path);
  return { body, cancels };
}

test('a dispute of a Prompt Lab payment cancels only the subscription that invoice belongs to', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: CUSTOMER_SUBSCRIPTIONS });
  const { body, cancels } = await runDispute(fake);
  assert.equal(body.ok, true);
  assert.equal(body.access, 'canceled');
  assert.deepEqual(cancels, ['/v1/subscriptions/sub_monthly_active']);
  const cancel = fake.calls.find((call) => call.method === 'DELETE');
  assert.equal(cancel.auth, 'Bearer sk_test_policy_fixture');
  assert.match(new URLSearchParams(cancel.search).get('cancellation_details[comment]'), /payment disputed \(du_123\)/);
});

test('a dispute of another product\'s charge on the same customer changes nothing', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: CUSTOMER_SUBSCRIPTIONS,
    invoiceBody: invoice('sub_other_product', 'price_other_product'),
  });
  const { body, cancels } = await runDispute(fake);
  assert.equal(body.access, 'none');
  assert.deepEqual(cancels, []);
});

test('a dispute of a one-off charge with no invoice changes nothing', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: CUSTOMER_SUBSCRIPTIONS,
    charge: { id: 'ch_disputed', customer: 'cus_disputed', payment_intent: 'pi_disputed' },
  });
  const { body, cancels } = await runDispute(fake);
  assert.equal(body.access, 'none');
  assert.deepEqual(cancels, []);
  assert.equal(fake.calls.some((call) => call.path === '/v1/subscriptions'), false);
});

test('newer API versions find the invoice through invoice payments', async () => {
  configureEnv();
  const fake = stripeFake({
    subscriptions: CUSTOMER_SUBSCRIPTIONS,
    charge: { id: 'ch_disputed', customer: 'cus_disputed', payment_intent: 'pi_disputed' },
    invoicePayments: [{ id: 'inpay_1', invoice: 'in_disputed' }],
    invoiceBody: {
      id: 'in_disputed',
      parent: { subscription_details: { subscription: 'sub_yearly_past_due' } },
      lines: { data: [{ pricing: { price_details: { price: 'price_yearly' } } }] },
    },
  });
  const { body, cancels } = await runDispute(fake);
  assert.equal(body.access, 'canceled');
  assert.deepEqual(cancels, ['/v1/subscriptions/sub_yearly_past_due']);
});

test('an invoice that paid a Prompt Lab price without naming a subscription cancels live Prompt Lab subscriptions', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: CUSTOMER_SUBSCRIPTIONS, invoiceBody: invoice('', 'price_yearly') });
  const { body, cancels } = await runDispute(fake);
  assert.equal(body.access, 'canceled');
  assert.deepEqual(cancels, ['/v1/subscriptions/sub_monthly_active', '/v1/subscriptions/sub_yearly_past_due']);
});

test('an expanded disputed charge is used without another charge lookup', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: [subscription('sub_monthly_active', 'price_monthly', 'trialing')] });
  const { body } = await runDispute(fake, { id: 'ch_expanded', customer: 'cus_disputed', invoice: invoice('sub_monthly_active') });
  assert.equal(body.access, 'canceled');
  assert.equal(fake.calls.some((call) => call.path.startsWith('/v1/charges/') || call.path.startsWith('/v1/invoices/')), false);
});

test('a dispute with no cancelable Prompt Lab subscription changes nothing', async () => {
  configureEnv();
  const fake = stripeFake({ subscriptions: [subscription('sub_old', 'price_monthly', 'canceled')], invoiceBody: invoice('sub_old') });
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

// REVIEW-2026-11-25 High: parallel checkouts must not leave two live Prompt
// Lab subscriptions on one customer.
function subscriptionEvent(type, object) {
  return { id: `evt_${type}_${object.id}`, type, data: { object: { customer: 'cus_dup', ...object } } };
}

function duplicateFake(subscriptions) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    calls.push({ method: init.method || 'GET', path: parsed.pathname, search: parsed.search });
    if (parsed.pathname === '/v1/subscriptions' && (init.method || 'GET') === 'GET') {
      assert.equal(parsed.searchParams.get('customer'), 'cus_dup');
      return Response.json({ data: subscriptions });
    }
    if (init.method === 'DELETE' && parsed.pathname.startsWith('/v1/subscriptions/')) {
      return Response.json({ id: parsed.pathname.split('/').pop(), status: 'canceled' });
    }
    throw new Error(`Unexpected Stripe request ${init.method || 'GET'} ${parsed.pathname}`);
  };
  return { calls, fetch };
}

async function runSubscriptionEvent(fake, event) {
  globalThis.fetch = fake.fetch;
  const webhook = await loadWebhook();
  const response = await webhook(signedRequest(event));
  assert.equal(response.status, 200);
  const body = await response.json();
  const cancels = fake.calls.filter((call) => call.method === 'DELETE').map((call) => call.path);
  return { body, cancels };
}

test('a second live Prompt Lab subscription on one customer is canceled and the oldest kept', async () => {
  configureEnv();
  const older = subscription('sub_first', 'price_monthly', 'active', DISPUTE_CREATED);
  const newer = subscription('sub_second', 'price_monthly', 'active', DISPUTE_CREATED + 5);
  const fake = duplicateFake([newer, older]);
  const { body, cancels } = await runSubscriptionEvent(fake, subscriptionEvent('customer.subscription.created', newer));
  assert.equal(body.access, 'canceled');
  assert.deepEqual(cancels, ['/v1/subscriptions/sub_second']);
  assert.match(new URLSearchParams(fake.calls.find((call) => call.method === 'DELETE').search).get('cancellation_details[comment]'), /duplicate subscription \(kept sub_first\)/);
});

test('the oldest live subscription is never canceled, even when its own event arrives late', async () => {
  configureEnv();
  const older = subscription('sub_first', 'price_monthly', 'active', DISPUTE_CREATED);
  const newer = subscription('sub_second', 'price_yearly', 'trialing', DISPUTE_CREATED + 5);
  const fake = duplicateFake([older, newer]);
  const { body, cancels } = await runSubscriptionEvent(fake, subscriptionEvent('customer.subscription.created', older));
  assert.equal(body.access, 'none');
  assert.deepEqual(cancels, []);
});

test('a duplicate that becomes live through an update is canceled', async () => {
  configureEnv();
  const older = subscription('sub_first', 'price_monthly', 'active', DISPUTE_CREATED);
  const newer = subscription('sub_second', 'price_monthly', 'active', DISPUTE_CREATED + 60);
  const fake = duplicateFake([older, newer]);
  const { cancels } = await runSubscriptionEvent(fake, subscriptionEvent('customer.subscription.updated', newer));
  assert.deepEqual(cancels, ['/v1/subscriptions/sub_second']);
});

test('a single subscription, a resubscription after cancel, or another product changes nothing', async () => {
  configureEnv();
  const canceled = subscription('sub_old', 'price_monthly', 'canceled', DISPUTE_CREATED);
  const fresh = subscription('sub_new', 'price_monthly', 'active', DISPUTE_CREATED + 86_400);
  const other = subscription('sub_other', 'price_other_product', 'active', DISPUTE_CREATED + 90_000);
  const incomplete = subscription('sub_pending', 'price_monthly', 'incomplete', DISPUTE_CREATED + 90_001);
  for (const event of [
    subscriptionEvent('customer.subscription.created', fresh),
    subscriptionEvent('customer.subscription.created', other),
    subscriptionEvent('customer.subscription.created', incomplete),
  ]) {
    const fake = duplicateFake([canceled, fresh, other, incomplete]);
    const { body, cancels } = await runSubscriptionEvent(fake, event);
    assert.equal(body.access, 'none', event.data.object.id);
    assert.deepEqual(cancels, [], event.data.object.id);
  }
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

for (const scenario of ['missing signature', 'wrong secret', 'tampered body', 'expired signature', 'future signature']) {
  test(`webhook rejects ${scenario} before persistence or Stripe access`, async () => {
    configureEnv();
    process.env.NODE_ENV = 'production';
    process.env.KV_REST_API_URL = 'https://redis.example.test';
    process.env.KV_REST_API_TOKEN = 'test-token';
    const calls = [];
    globalThis.fetch = async (...args) => { calls.push(args); throw new Error('Unexpected external request'); };
    const body = JSON.stringify(disputeEvent());
    const offset = scenario === 'expired signature' ? -600 : scenario === 'future signature' ? 600 : 0;
    const timestamp = Math.floor(Date.now() / 1000) + offset;
    const digest = createHmac('sha256', scenario === 'wrong secret' ? 'wrong-secret' : SECRET)
      .update(`${timestamp}.${body}`).digest('hex');
    const request = new Request('https://promptlab.tools/api/billing/webhook', {
      method: 'POST',
      headers: scenario === 'missing signature' ? {} : { 'stripe-signature': `t=${timestamp},v1=${digest}` },
      body: scenario === 'tampered body' ? body.replace('ch_disputed', 'ch_other') : body,
    });
    const response = await (await loadWebhook())(request);
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
  });
}
