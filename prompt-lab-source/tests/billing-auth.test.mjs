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

const licenseUrl = billingModuleUrl('license.js');
const portalUrl = billingModuleUrl('portal.js');
const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'CLERK_JWKS_URL',
  'CLERK_JWT_ISSUER',
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
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
  const kid = `test-key-${Date.now()}`;
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

  function tokenFor({ userId = 'user_a', email = 'user-a@example.com', expiresIn = '5m' } = {}) {
    return jwt.sign({
      sub: userId,
      email,
      email_address: email,
      iss: issuer,
    }, privateKey, {
      algorithm: 'RS256',
      keyid: kid,
      expiresIn,
    });
  }

  return {
    tokenFor,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function installStripeFetchMock(calls = []) {
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    calls.push({ url: urlText, init });

    if (urlText.includes('/customers/search')) {
      const decoded = decodeURIComponent(urlText);
      if (decoded.includes('user_a') || decoded.includes('user-a@example.com')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'cus_a',
            email: 'user-a@example.com',
            name: 'User A',
            metadata: { clerkUserId: 'user_a' },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlText.includes('/customers?')) {
      if (urlText.includes('user-a%40example.com')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'cus_a',
            email: 'user-a@example.com',
            name: 'User A',
            metadata: { clerkUserId: 'user_a' },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlText.includes('user-b%40example.com')) {
        return new Response(JSON.stringify({
          data: [{
            id: 'cus_b',
            email: 'user-b@example.com',
            name: 'User B',
            metadata: { clerkUserId: 'user_b' },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (urlText.includes('/customers/cus_a')) {
      return new Response(JSON.stringify({
        id: 'cus_a',
        email: 'user-a@example.com',
        name: 'User A',
        metadata: { clerkUserId: 'user_a' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlText.includes('/customers/cus_b')) {
      return new Response(JSON.stringify({
        id: 'cus_b',
        email: 'user-b@example.com',
        name: 'User B',
        metadata: { clerkUserId: 'user_b' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlText.includes('/subscriptions?customer=cus_a')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'sub_a',
          status: 'active',
          items: { data: [{ price: { id: 'price_monthly' } }] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlText.includes('/subscriptions?customer=cus_b')) {
      return new Response(JSON.stringify({
        data: [{
          id: 'sub_b',
          status: 'active',
          items: { data: [{ price: { id: 'price_monthly' } }] },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    if (urlText.includes('/billing_portal/sessions')) {
      return new Response(JSON.stringify({
        url: 'https://billing.stripe.com/session/test_a',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    throw new Error(`Unexpected Stripe request: ${urlText}`);
  };
}

test.beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
});

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('billing license rejects missing Clerk authorization', async () => {
  const handler = await loadHandler(licenseUrl);
  const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'validate' }),
  }));

  assert.equal(response.status, 401);
});

test('billing license rejects expired Clerk authorization', async () => {
  const jwks = await createJwksHarness();
  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ expiresIn: '-1s' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'validate' }),
    }));

    assert.equal(response.status, 401);
  } finally {
    await jwks.close();
  }
});

test('billing license uses the verified Clerk identity instead of the posted email', async () => {
  const jwks = await createJwksHarness();
  const calls = [];
  installStripeFetchMock(calls);

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_a', email: 'user-a@example.com' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'activate',
        customerEmail: 'user-b@example.com',
        customerId: 'cus_b',
      }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.customerId, 'cus_a');
    assert.equal(payload.customerEmail, 'user-a@example.com');
    assert.equal(payload.subscriptionId, 'sub_a');
    assert.equal(calls.some((call) => call.url.includes('user-b%40example.com') || call.url.includes('cus_b')), false);
  } finally {
    await jwks.close();
  }
});

test('billing portal uses the verified Clerk customer instead of a posted customer id', async () => {
  const jwks = await createJwksHarness();
  const calls = [];
  installStripeFetchMock(calls);

  try {
    const handler = await loadHandler(portalUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/portal', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_a', email: 'user-a@example.com' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customerId: 'cus_b',
        customerEmail: 'user-b@example.com',
      }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.customerId, 'cus_a');
    assert.equal(payload.customerEmail, 'user-a@example.com');

    const portalCall = calls.find((call) => call.url.includes('/billing_portal/sessions'));
    assert.ok(portalCall);
    assert.equal(new URLSearchParams(portalCall.init.body).get('customer'), 'cus_a');
    assert.equal(calls.some((call) => call.url.includes('user-b%40example.com') || call.url.includes('cus_b')), false);
  } finally {
    await jwks.close();
  }
});
