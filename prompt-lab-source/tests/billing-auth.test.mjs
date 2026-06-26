import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
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
  'CLERK_SECRET_KEY',
  'PROMPTLAB_PRO_OWNER_CLERK_USER_IDS',
  'PROMPTLAB_PRO_OWNER_EMAILS',
  'PROMPTLAB_PRO_OWNER_USERNAMES',
  'PROMPTLAB_OWNER_CLERK_USER_IDS',
  'PROMPTLAB_OWNER_EMAILS',
  'PROMPTLAB_OWNER_USERNAMES',
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

function isJwksHarnessRequest(url) {
  return String(url || '') === process.env.CLERK_JWKS_URL;
}

async function loadHandler(moduleUrl) {
  const mod = await import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function callNodeHandler(handler, { method = 'GET', url = '/api/billing/license', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(body ? [body] : []);
    req.method = method;
    req.url = url;
    req.headers = {
      host: 'promptlab.tools',
      ...headers,
    };

    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      end(payload = '') {
        resolve({
          status: this.statusCode,
          headers: this.headers,
          body: Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload),
        });
      },
    };

    Promise.resolve(handler(req, res)).catch(reject);
  });
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

  function tokenFor({ userId = 'user_a', email = 'user-a@example.com', expiresIn = '5m', claims = {} } = {}) {
    const payload = {
      sub: userId,
      iss: issuer,
      ...claims,
    };
    if (email) {
      payload.email = email;
      payload.email_address = email;
    }
    return jwt.sign(payload, privateKey, {
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
    if (isJwksHarnessRequest(urlText)) return ORIGINAL_FETCH(url, init);
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

function installNoExternalFetchMock(message) {
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (isJwksHarnessRequest(urlText)) return ORIGINAL_FETCH(url, init);
    throw new Error(message);
  };
}

function installClerkProfileFetchMock(profile, message) {
  globalThis.fetch = async (url, init = {}) => {
    const urlText = String(url);
    if (isJwksHarnessRequest(urlText)) return ORIGINAL_FETCH(url, init);
    if (urlText === 'https://api.clerk.com/v1/users/user_owner') {
      assert.match(String(init?.headers?.Authorization || ''), /^Bearer sk_test_/);
      return new Response(JSON.stringify(profile), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(message);
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

test('billing license node handler ends OPTIONS preflight response', async () => {
  const handler = await loadHandler(licenseUrl);
  const response = await callNodeHandler(handler, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://promptlab.tools',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'Authorization, Content-Type',
    },
  });

  assert.equal(response.status, 204);
  assert.match(response.headers['access-control-allow-headers'] || '', /Authorization/);
  assert.equal(response.body, '');
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

test('billing license grants owner Pro by verified Clerk email before Stripe lookup', async () => {
  const jwks = await createJwksHarness();
  process.env.PROMPTLAB_OWNER_EMAILS = 'owner@example.com,dave@promptlab.tools';
  installNoExternalFetchMock('Stripe should not be queried for owner email entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_owner', email: 'owner@example.com' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'validate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.status, 'active');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.customerEmail, 'owner@example.com');
    assert.equal(payload.owner, true);
  } finally {
    await jwks.close();
  }
});

test('billing license grants owner Pro by legacy owner email env before Stripe lookup', async () => {
  const jwks = await createJwksHarness();
  process.env.PROMPTLAB_PRO_OWNER_EMAILS = 'owner@example.com,dave@promptlab.tools';
  installNoExternalFetchMock('Stripe should not be queried for owner email entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_owner', email: 'owner@example.com' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'validate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.customerEmail, 'owner@example.com');
    assert.equal(payload.owner, true);
  } finally {
    await jwks.close();
  }
});

test('billing license grants owner Pro by verified Clerk user id before Stripe lookup', async () => {
  const jwks = await createJwksHarness();
  process.env.PROMPTLAB_OWNER_CLERK_USER_IDS = 'user_owner';
  installNoExternalFetchMock('Stripe should not be queried for owner user entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_owner', email: 'private@example.com' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'activate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.customerEmail, 'private@example.com');
    assert.equal(payload.owner, true);
  } finally {
    await jwks.close();
  }
});

test('billing license grants owner Pro by Clerk user id when the token has no email claim', async () => {
  const jwks = await createJwksHarness();
  process.env.PROMPTLAB_PRO_OWNER_CLERK_USER_IDS = 'user_owner';
  installNoExternalFetchMock('External services should not be queried for owner user id entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({ userId: 'user_owner', email: '' })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'activate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.clerkUserId, 'user_owner');
    assert.equal(payload.customerEmail, '');
    assert.equal(payload.owner, true);
  } finally {
    await jwks.close();
  }
});

test('billing license grants owner Pro by Clerk username claim', async () => {
  const jwks = await createJwksHarness();
  process.env.PROMPTLAB_OWNER_USERNAMES = 'daverobertson';
  installNoExternalFetchMock('External services should not be queried for owner username entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({
          userId: 'user_owner',
          email: '',
          claims: { username: '@daverobertson' },
        })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'activate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.clerkUserId, 'user_owner');
    assert.equal(payload.owner, true);
  } finally {
    await jwks.close();
  }
});

test('billing license grants owner Pro by Clerk profile username when token omits username', async () => {
  const jwks = await createJwksHarness();
  process.env.CLERK_SECRET_KEY = 'sk_test_profile';
  process.env.PROMPTLAB_PRO_OWNER_USERNAMES = 'daverobertson';
  installClerkProfileFetchMock({
    id: 'user_owner',
    username: 'daverobertson',
    primary_email_address_id: 'email_owner',
    email_addresses: [{
      id: 'email_owner',
      email_address: 'owner@example.com',
    }],
  }, 'Stripe should not be queried for owner profile username entitlement.');

  try {
    const handler = await loadHandler(licenseUrl);
    const response = await handler(new Request('https://promptlab.tools/api/billing/license', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwks.tokenFor({
          userId: 'user_owner',
          email: '',
        })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'validate' }),
    }));

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.plan, 'pro');
    assert.equal(payload.billingPeriod, 'owner');
    assert.equal(payload.customerEmail, 'owner@example.com');
    assert.equal(payload.clerkUserId, 'user_owner');
    assert.equal(payload.owner, true);
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
