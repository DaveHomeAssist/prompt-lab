import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');

function billingModuleUrl(fileName) {
  return pathToFileURL(path.join(sourceDir, 'api', 'billing', fileName)).href;
}

const checkoutUrl = billingModuleUrl('checkout.js');
const licenseUrl = billingModuleUrl('license.js');
const portalUrl = billingModuleUrl('portal.js');

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV',
  'BILLING_ENABLED',
  'CLERK_JWKS_URL',
  'CLERK_JWT_ISSUER',
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
  'PROMPTLAB_STRIPE_TIMEOUT_MS',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

async function loadHandler(moduleUrl) {
  const mod = await import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function isJwksHarnessRequest(url) {
  return String(url || '') === process.env.CLERK_JWKS_URL;
}

async function createJwksHarness() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = `stripe-test-key-${Date.now()}`;
  const issuer = 'https://clerk.promptlab.test';
  const server = http.createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }],
    }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  process.env.CLERK_JWKS_URL = `http://127.0.0.1:${port}/jwks`;
  process.env.CLERK_JWT_ISSUER = issuer;

  return {
    token: jwt.sign({
      sub: 'user_123',
      email: 'user@example.com',
      email_address: 'user@example.com',
      email_verified: true,
      iss: issuer,
    }, privateKey, {
      algorithm: 'RS256',
      keyid: kid,
      expiresIn: '5m',
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('billing checkout uses verified Clerk identity and ignores posted identity fields', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://promptlab.tools/app/?billing=success';
  process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://promptlab.tools/app/?billing=cancelled';

  const captured = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === process.env.CLERK_JWKS_URL) return ORIGINAL_FETCH(url, init);
    if (String(url).includes('/customers/search')) {
      assert.match(decodeURIComponent(String(url)), /metadata\['clerkUserId'\]:'user_123'/);
      return new Response(JSON.stringify({ data: [{
        id: 'cus_existing', email: 'user@example.com', metadata: { clerkUserId: 'user_123' },
      }] }), { status: 200 });
    }
    if (String(url).includes('/subscriptions?')) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    assert.match(String(url), /\/checkout\/sessions$/);
    captured.push(new URLSearchParams(init.body));
    return new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    const handler = await loadHandler(checkoutUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        period: 'monthly',
        email: 'attacker@example.com',
        clerkUserId: 'user_attacker',
        customerId: 'cus_attacker',
        contactEmail: 'attacker@example.com',
        source: 'upgrade-modal',
      }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
    assert.equal(captured[0].get('line_items[0][price]'), 'price_monthly');
    assert.equal(payload.customerId, 'cus_existing');
    assert.equal(captured[0].get('customer'), 'cus_existing');
    assert.equal(captured[0].get('customer_email'), null);
    assert.equal(captured[0].get('metadata[clerk_user_id]'), 'user_123');
    assert.equal(captured[0].get('subscription_data[metadata][clerk_user_id]'), 'user_123');
    assert.equal(captured[0].get('metadata[contact_email]'), null);
    assert.equal(captured[0].get('subscription_data[metadata][billing_period]'), 'monthly');
  } finally {
    await jwks.close();
  }
});

test('billing checkout aborts a stalled Stripe request', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.PROMPTLAB_STRIPE_TIMEOUT_MS = '5';

  globalThis.fetch = async (url, init) => {
    if (String(url) === process.env.CLERK_JWKS_URL) return ORIGINAL_FETCH(url, init);
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  };

  try {
    const handler = await loadHandler(checkoutUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ period: 'monthly' }),
    }));

    assert.equal(response.status, 504);
    assert.match(await response.text(), /Stripe request timed out/i);
  } finally {
    await jwks.close();
  }
});

test('billing sync validates only configured Prompt Lab Stripe prices', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  const calls = [];

  globalThis.fetch = async (url) => {
    if (isJwksHarnessRequest(url)) return ORIGINAL_FETCH(url);
    calls.push(String(url));
    if (String(url).includes('/customers/search')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
          metadata: { clerkUserId: 'user_123' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: [{
        id: 'sub_123',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_monthly' },
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'validate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'monthly');
    assert.equal(payload.customerId, 'cus_123');
    assert.match(decodeURIComponent(calls[0]), /customers\/search\?limit=1&query=.*metadata\['clerkUserId'\]:'user_123'/);
  } finally {
    await jwks.close();
  }
});

test('billing sync rejects an email with no active Prompt Lab Pro subscription', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';

  globalThis.fetch = async (url) => {
    if (isJwksHarnessRequest(url)) return ORIGINAL_FETCH(url);
    if (String(url).includes('/customers/search')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
          metadata: { clerkUserId: 'user_123' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      data: [{
        id: 'sub_123',
        status: 'active',
        items: {
          data: [{
            price: { id: 'price_other' },
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'activate' }),
    }));

    assert.equal(response.status, 404);
    assert.match(await response.text(), /No active Prompt Lab Pro subscription/i);
  } finally {
    await jwks.close();
  }
});

test('billing portal returns the configured portal url', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
  globalThis.fetch = async (url, init) => {
    if (isJwksHarnessRequest(url)) return ORIGINAL_FETCH(url, init);
    if (String(url).includes('/customers/search')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
          metadata: { clerkUserId: 'user_123' },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(init.method, 'POST');
    assert.equal(new URLSearchParams(init.body).get('customer'), 'cus_123');
    return new Response(JSON.stringify({
      url: 'https://billing.stripe.com/session/test_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    const handler = await loadHandler(portalUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/portal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.url, 'https://billing.stripe.com/session/test_123');
  } finally {
    await jwks.close();
  }
});

function stripeJson(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('a license check and a concurrent checkout end with one customer while Stripe Search lags', async () => {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';

  // Search never sees new customers, the email list sees only finished
  // creates, and Idempotency-Key replays a create (409 while in flight).
  const customers = [];
  const byKey = new Map();
  const createKeys = [];
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    if (isJwksHarnessRequest(text)) return ORIGINAL_FETCH(url, init);
    if (text.includes('/customers/search')) return stripeJson({ data: [] });
    if (text.includes('/customers?')) {
      const email = new URL(text).searchParams.get('email');
      return stripeJson({ data: customers.filter((customer) => customer.email === email) });
    }
    if (text.includes('/subscriptions?')) return stripeJson({ data: [] });
    if (text.endsWith('/customers') && init.method === 'POST') {
      const key = init.headers['Idempotency-Key'];
      createKeys.push(key);
      const saved = byKey.get(key);
      if (saved === 'in-flight') return stripeJson({ error: { type: 'idempotency_error' } }, 409);
      if (saved) return stripeJson(saved);
      byKey.set(key, 'in-flight');
      await new Promise((resolve) => setTimeout(resolve, 50));
      const params = new URLSearchParams(init.body);
      const customer = {
        id: `cus_${customers.length + 1}`,
        email: params.get('email'),
        metadata: { clerkUserId: params.get('metadata[clerkUserId]') },
      };
      customers.push(customer);
      byKey.set(key, customer);
      return stripeJson(customer);
    }
    if (text.endsWith('/checkout/sessions')) {
      return stripeJson({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    }
    throw new Error(`Unexpected Stripe request: ${text}`);
  };

  try {
    const license = await loadHandler(licenseUrl);
    const checkout = await loadHandler(checkoutUrl);
    const post = (pathname, body) => new Request(`https://promptlab.tools${pathname}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwks.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const [licenseResponse, checkoutResponse] = await Promise.all([
      license(post('/api/billing/license', { action: 'validate' })),
      checkout(post('/api/billing/checkout', { period: 'monthly' })),
    ]);

    assert.equal(licenseResponse.status, 200);
    assert.equal(checkoutResponse.status, 200);
    assert.equal(customers.length, 1);
    // INT-06: the license check only looks up; it sees the customer only if
    // the checkout's create finished first.
    assert.ok(['', 'cus_1'].includes((await licenseResponse.json()).customerId));
    assert.equal((await checkoutResponse.json()).customerId, 'cus_1');
    assert.ok(createKeys.length >= 1);
    assert.equal(new Set(createKeys).size, 1);
    assert.match(createKeys[0], /^promptlab-customer:user_123:[0-9a-f]{32}$/);
  } finally {
    await jwks.close();
  }
});

test('customer creation retries an in-flight idempotent create and reuses its customer', async () => {
  const { getOrCreateStripeCustomer } = await import(
    `${pathToFileURL(path.join(sourceDir, 'api', '_lib', 'stripeBilling.js')).href}?t=${Date.now()}`
  );
  const creates = [];
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    if (text.includes('/customers/search') || text.includes('/customers?')) return stripeJson({ data: [] });
    assert.ok(text.endsWith('/customers') && init.method === 'POST', `Unexpected Stripe request: ${text}`);
    creates.push(init.headers['Idempotency-Key']);
    return creates.length === 1
      ? stripeJson({ error: { type: 'idempotency_error', message: 'Another request is in progress.' } }, 409)
      : stripeJson({ id: 'cus_replayed', email: 'user@example.com', metadata: { clerkUserId: 'user_123' } });
  };

  const customer = await getOrCreateStripeCustomer({ secretKey: 'sk_test_123' }, {
    clerkUserId: 'user_123',
    clerkEmail: 'User@Example.com',
  });

  assert.equal(customer.id, 'cus_replayed');
  assert.equal(creates.length, 2);
  assert.equal(creates[0], creates[1]);
  assert.doesNotMatch(creates[0], /@/);
});

test('customer creation keeps waiting while a slow winning create is still in flight', async () => {
  const { getOrCreateStripeCustomer } = await import(
    `${pathToFileURL(path.join(sourceDir, 'api', '_lib', 'stripeBilling.js')).href}?t=${Date.now()}`
  );
  // Another request holds the key for 1.2s, longer than three 250ms waits.
  const inFlightUntil = Date.now() + 1200;
  let creates = 0;
  globalThis.fetch = async (url, init = {}) => {
    const text = String(url);
    if (text.includes('/customers/search') || text.includes('/customers?')) return stripeJson({ data: [] });
    assert.ok(text.endsWith('/customers') && init.method === 'POST', `Unexpected Stripe request: ${text}`);
    creates += 1;
    return Date.now() < inFlightUntil
      ? stripeJson({ error: { type: 'idempotency_error' } }, 409)
      : stripeJson({ id: 'cus_slow_winner', email: 'user@example.com', metadata: { clerkUserId: 'user_123' } });
  };

  const customer = await getOrCreateStripeCustomer({ secretKey: 'sk_test_123' }, {
    clerkUserId: 'user_123',
    clerkEmail: 'user@example.com',
  });

  assert.equal(customer.id, 'cus_slow_winner');
  assert.ok(creates >= 3);
});

test('legacy annual price IDs keep Pro for existing subscribers but never reach checkout', async () => {
  const lib = await import(pathToFileURL(path.join(sourceDir, 'api', '_lib', 'stripeBilling.js')).href);
  const config = {
    monthlyPriceId: 'price_monthly',
    yearlyPriceId: 'price_yearly_79',
    legacyYearlyPriceIds: ['price_yearly_99'],
  };
  const map = lib.getAllowedPriceMap(config);
  assert.equal(map.get('price_yearly_79'), 'annual');
  assert.equal(map.get('price_yearly_99'), 'annual');
  assert.equal(lib.resolveCheckoutPriceId(config, 'annual'), 'price_yearly_79');
  assert.equal(lib.resolveCheckoutPriceId(config, 'monthly'), 'price_monthly');

  const record = lib.normalizeBillingRecord({
    customer: { id: 'cus_legacy', email: 'legacy@example.com' },
    subscriptions: [{ id: 'sub_legacy', status: 'active', items: { data: [{ price: { id: 'price_yearly_99' } }] } }],
    config,
  });
  assert.equal(record.plan, 'pro');
  assert.equal(record.billingPeriod, 'annual');
  assert.equal(record.priceId, 'price_yearly_99');

  const unrelated = lib.normalizeBillingRecord({
    customer: { id: 'cus_other' },
    subscriptions: [{ id: 'sub_other', status: 'active', items: { data: [{ price: { id: 'price_other' } }] } }],
    config,
  });
  assert.equal(unrelated.plan, 'free');
});

test('STRIPE_LEGACY_YEARLY_PRICE_IDS is parsed as a comma-separated list', async () => {
  const previous = process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS;
  process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS = ' price_a , ,price_b ';
  try {
    const lib = await import(pathToFileURL(path.join(sourceDir, 'api', '_lib', 'stripeBilling.js')).href);
    assert.deepEqual(lib.buildStripeConfig().legacyYearlyPriceIds, ['price_a', 'price_b']);
  } finally {
    if (typeof previous === 'undefined') delete process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS;
    else process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS = previous;
  }
});

for (const metadata of [{}, { clerkUserId: 'user_123' }, { clerk_user_id: 'user_123' }, { clerkUserId: 'user_123', clerk_user_id: 'user_123' }]) {
  test(`same-account and unbound legacy customers remain usable: ${JSON.stringify(metadata)}`, async () => {
    const { getOrCreateStripeCustomer } = await import('../api/_lib/stripeBilling.js');
    const updates = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).includes('/customers/search')) return stripeJson({ data: [] });
      if (String(url).includes('/customers?')) return stripeJson({ data: [{ id: 'cus_legacy', email: 'user@example.com', metadata }] });
      assert.equal(String(url), 'https://api.stripe.com/v1/customers/cus_legacy');
      updates.push(new URLSearchParams(init.body));
      return stripeJson({ id: 'cus_legacy', metadata: { clerkUserId: 'user_123', clerk_user_id: 'user_123' } });
    };
    const customer = await getOrCreateStripeCustomer({ secretKey: 'sk_test_fixture' }, { clerkUserId: 'user_123', clerkEmail: 'user@example.com' });
    assert.equal(customer.id, 'cus_legacy');
    assert.equal(updates.length, Object.keys(metadata).length === 0 ? 1 : 0);
    if (updates.length) assert.equal(updates[0].get('metadata[clerkUserId]'), 'user_123');
  });
}

async function runCheckoutWithSubscriptions(subscriptions) {
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS = 'price_legacy_99';
  const sessionPosts = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === process.env.CLERK_JWKS_URL) return ORIGINAL_FETCH(url, init);
    if (String(url).includes('/customers/search')) {
      return new Response(JSON.stringify({ data: [{
        id: 'cus_existing', email: 'user@example.com', metadata: { clerkUserId: 'user_123' },
      }] }), { status: 200 });
    }
    if (String(url).includes('/subscriptions?')) {
      assert.match(String(url), /customer=cus_existing/);
      return new Response(JSON.stringify({ data: subscriptions }), { status: 200 });
    }
    assert.match(String(url), /\/checkout\/sessions$/);
    sessionPosts.push(new URLSearchParams(init.body));
    return new Response(JSON.stringify({ id: 'cs_test_new', url: 'https://checkout.stripe.com/c/pay/cs_test_new' }), { status: 200 });
  };
  try {
    const handler = await loadHandler(checkoutUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwks.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'annual', source: 'billing-modal' }),
    }));
    return { response, payload: await response.json(), sessionPosts };
  } finally {
    delete process.env.STRIPE_LEGACY_YEARLY_PRICE_IDS;
    await jwks.close();
  }
}

function subscriptionFixture(status, priceId) {
  return { id: `sub_${status}`, status, items: { data: [{ price: { id: priceId } }] } };
}

for (const [status, priceId] of [
  ['active', 'price_monthly'],
  ['trialing', 'price_yearly'],
  ['past_due', 'price_monthly'],
  ['active', 'price_legacy_99'],
]) {
  test(`checkout refuses with 409 when the customer already has a ${status} Prompt Lab subscription (${priceId})`, async () => {
    const { response, payload, sessionPosts } = await runCheckoutWithSubscriptions([
      subscriptionFixture('canceled', 'price_monthly'),
      subscriptionFixture(status, priceId),
    ]);
    assert.equal(response.status, 409);
    assert.equal(payload.code, 'already_subscribed');
    assert.equal(payload.portalAvailable, true);
    assert.equal(payload.retryable, false);
    assert.equal(payload.subscriptionStatus, status);
    assert.match(payload.error, /Manage Purchases/);
    assert.equal(sessionPosts.length, 0, 'no Checkout Session may be created');
  });
}

test('checkout proceeds when only canceled, incomplete or non-Prompt Lab subscriptions exist', async () => {
  const { response, payload, sessionPosts } = await runCheckoutWithSubscriptions([
    subscriptionFixture('canceled', 'price_yearly'),
    subscriptionFixture('incomplete_expired', 'price_monthly'),
    subscriptionFixture('incomplete', 'price_monthly'),
    subscriptionFixture('active', 'price_some_other_product'),
  ]);
  assert.equal(response.status, 200);
  assert.equal(payload.url, 'https://checkout.stripe.com/c/pay/cs_test_new');
  assert.equal(sessionPosts.length, 1);
});
