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
  'CLERK_JWKS_URL',
  'CLERK_JWT_ISSUER',
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
  'STRIPE_CHECKOUT_SUCCESS_URL',
  'STRIPE_CHECKOUT_CANCEL_URL',
  'STRIPE_PORTAL_RETURN_URL',
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
  const jwks = await createJwksHarness();
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  const calls = [];

  globalThis.fetch = async (url) => {
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
