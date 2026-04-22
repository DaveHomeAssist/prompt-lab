import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
  'PROMPTLAB_BILLING_TIMEOUT_MS',
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

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('billing checkout creates a Stripe checkout for the requested plan', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_CHECKOUT_SUCCESS_URL = 'https://promptlab.tools/app/?billing=success';
  process.env.STRIPE_CHECKOUT_CANCEL_URL = 'https://promptlab.tools/app/?billing=cancelled';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(new URLSearchParams(init.body));
    return new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler(checkoutUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period: 'monthly',
      email: 'user@example.com',
      source: 'upgrade-modal',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://checkout.stripe.com/c/pay/cs_test_123');
  assert.equal(captured[0].get('line_items[0][price]'), 'price_monthly');
  assert.equal(captured[0].get('customer_email'), 'user@example.com');
  assert.equal(captured[0].get('subscription_data[metadata][billing_period]'), 'monthly');
});

test('billing sync validates only configured Prompt Lab Stripe prices', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
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

  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
      customerEmail: 'user@example.com',
    }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.plan, 'pro');
  assert.equal(payload.billingPeriod, 'monthly');
  assert.equal(payload.customerId, 'cus_123');
  assert.match(calls[0], /customers\?limit=1&email=user%40example.com/);
});

test('billing sync rejects an email with no active Prompt Lab Pro subscription', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';

  globalThis.fetch = async (url) => {
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
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

  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'activate',
      customerEmail: 'user@example.com',
    }),
  }));

  assert.equal(response.status, 404);
  assert.match(await response.text(), /No active Prompt Lab Pro subscription/i);
});

test('billing portal returns the configured portal url', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/customers?')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'cus_123',
          email: 'user@example.com',
          name: 'Prompt Lab User',
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
  const handler = await loadHandler(portalUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/portal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerEmail: 'user@example.com' }),
  }));

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.url, 'https://billing.stripe.com/session/test_123');
});

test('billing license fails fast when Stripe lookup hangs', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.PROMPTLAB_BILLING_TIMEOUT_MS = '25';

  globalThis.fetch = async () => new Promise(() => {});

  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'validate',
      customerEmail: 'user@example.com',
    }),
  }));

  assert.equal(response.status, 504);
  assert.match(await response.text(), /timed out/i);
});
