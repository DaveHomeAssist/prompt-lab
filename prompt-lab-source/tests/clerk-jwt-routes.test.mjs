// Route-level Clerk session auth. These cases describe the behavior each
// route had before the three verifiers were folded into one, and they must
// keep passing after that change.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const ORIGINAL_FETCH = globalThis.fetch;
const ISSUER = 'https://clerk.routes.example.test';
const WEB_ORIGIN = 'https://promptlab.tools';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const kid = 'route-auth-key';
const jwk = { ...publicJwk, kid, alg: 'RS256', use: 'sig' };

const ENV_KEYS = [
  'NODE_ENV',
  'BILLING_ENABLED',
  'CLERK_SECRET_KEY',
  'CLERK_JWKS_URL',
  'CLERK_JWT_ISSUER',
  'CLERK_JWT_AUDIENCE',
  'CLERK_JWT_KEY',
  'CLERK_AUTHORIZED_PARTIES',
  'STRIPE_SECRET_KEY',
  'STRIPE_MONTHLY_PRICE_ID',
  'STRIPE_YEARLY_PRICE_ID',
  'STRIPE_PORTAL_RETURN_URL',
  'STRIPE_WEBHOOK_SECRET',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'HOSTED_PROXY_ENABLED',
  'HOSTED_SHARED_KEY_ENABLED',
  'HOSTED_BURST_LIMIT',
  'HOSTED_DEMO_DAILY_LIMIT',
  'HOSTED_GLOBAL_DAILY_LIMIT',
  'ANTHROPIC_API_KEY',
  'PROMPTLAB_PRO_OWNER_CLERK_USER_IDS',
  'PROMPTLAB_OWNER_CLERK_USER_IDS',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

function billingUrl(fileName) {
  return pathToFileURL(path.join(sourceDir, 'api', 'billing', fileName)).href;
}

const proxyUrl = pathToFileURL(path.join(sourceDir, 'api', 'proxy.js')).href;

async function loadHandler(moduleUrl) {
  const mod = await import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function startJwks() {
  const server = http.createServer((request, response) => {
    if (request.url !== '/jwks') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/jwks`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const harness = await startJwks();

function signToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function billingToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    sub: 'user_a',
    iss: ISSUER,
    azp: WEB_ORIGIN,
    email: 'user-a@example.com',
    email_address: 'user-a@example.com',
    email_verified: true,
    iat: now - 1,
    nbf: now - 1,
    exp: now + 300,
    ...claims,
  });
}

function proxyToken(claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    sub: 'user_owner',
    sid: 'sess_owner',
    iss: process.env.CLERK_JWT_ISSUER,
    azp: WEB_ORIGIN,
    iat: now - 1,
    nbf: now - 1,
    exp: now + 300,
    ...claims,
  });
}

function installFetchMock(calls) {
  globalThis.fetch = async (url, init) => {
    const urlText = String(url);
    calls.push(urlText);
    if (urlText === process.env.CLERK_JWKS_URL) return ORIGINAL_FETCH(url, init);
    if (urlText === `${process.env.CLERK_JWT_ISSUER}/.well-known/jwks.json`) {
      return Response.json({ keys: [jwk] });
    }
    if (urlText.startsWith('https://api.clerk.com/')) return Response.json({});
    if (urlText.includes('/customers/search')) {
      return Response.json({
        data: [{
          id: 'cus_a',
          email: 'user-a@example.com',
          metadata: { clerkUserId: 'user_a', clerk_user_id: 'user_a' },
        }],
      });
    }
    if (urlText.includes('/subscriptions')) return Response.json({ data: [] });
    if (urlText.includes('/checkout/sessions')) {
      return Response.json({ id: 'cs_test', url: 'https://checkout.stripe.test/c/cs_test' });
    }
    if (urlText.includes('/billing_portal/sessions')) {
      return Response.json({ url: 'https://billing.stripe.test/p/session' });
    }
    if (urlText === 'https://api.anthropic.com/v1/messages') {
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected fetch: ${urlText}`);
  };
}

function useBillingEnv(mode) {
  process.env.NODE_ENV = 'test';
  process.env.BILLING_ENABLED = 'true';
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_MONTHLY_PRICE_ID = 'price_monthly';
  process.env.STRIPE_YEARLY_PRICE_ID = 'price_yearly';
  process.env.STRIPE_PORTAL_RETURN_URL = 'https://promptlab.tools/app/';
  process.env.CLERK_JWT_ISSUER = ISSUER;
  delete process.env.CLERK_JWT_AUDIENCE;
  delete process.env.CLERK_AUTHORIZED_PARTIES;
  if (mode === 'sdk') {
    delete process.env.CLERK_JWKS_URL;
    process.env.CLERK_SECRET_KEY = 'sk_test_clerk';
    process.env.CLERK_JWT_KEY = publicKeyPem;
  } else {
    process.env.CLERK_JWKS_URL = harness.url;
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_JWT_KEY;
  }
}

function useProxyEnv() {
  process.env.NODE_ENV = 'test';
  process.env.CLERK_JWT_ISSUER = ISSUER;
  delete process.env.CLERK_JWT_AUDIENCE;
  delete process.env.CLERK_AUTHORIZED_PARTIES;
  delete process.env.CLERK_JWKS_URL;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_JWT_KEY;
  process.env.PROMPTLAB_PRO_OWNER_CLERK_USER_IDS = 'user_owner';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';
  process.env.HOSTED_BURST_LIMIT = '100';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '100';
  process.env.HOSTED_GLOBAL_DAILY_LIMIT = '100';
  process.env.ANTHROPIC_API_KEY = 'fixture-shared-key';
}

const ROUTES = [
  {
    name: 'license',
    file: 'license.js',
    path: '/api/billing/license',
    body: { action: 'validate' },
  },
  {
    name: 'checkout',
    file: 'checkout.js',
    path: '/api/billing/checkout',
    body: { period: 'monthly' },
  },
  {
    name: 'portal',
    file: 'portal.js',
    path: '/api/billing/portal',
    body: {},
  },
];

function tokenForCase(authCase) {
  const now = Math.floor(Date.now() / 1000);
  if (authCase === 'valid') return billingToken();
  if (authCase === 'expired') return billingToken({ exp: now - 30, iat: now - 90, nbf: now - 90 });
  if (authCase === 'wrong issuer') return billingToken({ iss: 'https://evil.example' });
  if (authCase === 'wrong azp') return billingToken({ azp: 'https://untrusted.example' });
  return '';
}

async function callBilling(route, token, { url } = {}) {
  const calls = [];
  installFetchMock(calls);
  const handler = await loadHandler(billingUrl(route.file));
  const response = await handler(new Request(url || `https://promptlab.tools${route.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(route.body),
  }));
  const body = await response.json();
  return { status: response.status, body, calls };
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(async () => {
  await harness.close();
});

for (const mode of ['manual', 'sdk']) {
  for (const route of ROUTES) {
    for (const authCase of ['valid', 'expired', 'wrong issuer', 'wrong azp', 'missing token']) {
      test(`${route.name} ${mode} auth: ${authCase}`, async () => {
        useBillingEnv(mode);
        const result = await callBilling(route, tokenForCase(authCase));
        if (authCase === 'valid') {
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(result.body.ok, true);
          assert.equal(result.calls.some((url) => url.includes('api.stripe.com')), true);
        } else if (authCase === 'missing token') {
          assert.equal(result.status, 401);
          assert.equal(result.body.error, 'Missing Clerk authorization.');
          assert.equal(result.calls.some((url) => url.includes('api.stripe.com')), false);
        } else {
          assert.equal(result.status, 401);
          assert.equal(result.body.error, 'Invalid or expired Clerk authorization.');
          assert.equal(result.calls.some((url) => url.includes('api.stripe.com')), false);
        }
      });
    }
  }
}

for (const authCase of ['valid', 'expired', 'wrong issuer', 'wrong azp', 'missing token']) {
  test(`proxy auth: ${authCase}`, async () => {
    useProxyEnv();
    const calls = [];
    installFetchMock(calls);
    const handler = await loadHandler(proxyUrl);
    const now = Math.floor(Date.now() / 1000);
    const token = authCase === 'missing token' ? '' : proxyToken({
      ...(authCase === 'expired' ? { exp: now - 30, iat: now - 90, nbf: now - 90 } : {}),
      ...(authCase === 'wrong issuer' ? { iss: 'https://evil.example' } : {}),
      ...(authCase === 'wrong azp' ? { azp: 'https://untrusted.example' } : {}),
    });
    const response = await handler(new Request('https://promptlab.tools/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: WEB_ORIGIN,
        'x-forwarded-for': `203.0.113.${authCase.length}`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        targetUrl: 'https://api.anthropic.com/v1/messages',
        headers: {},
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(response.headers.get('X-Hosted-Access'), authCase === 'valid' ? 'owner' : 'standard');
  });
}

test('billing manual path accepts an iat 30s in the future and an exp 3s in the past is rejected', async () => {
  useBillingEnv('manual');
  const now = Math.floor(Date.now() / 1000);
  const future = await callBilling(ROUTES[0], billingToken({ iat: now + 30 }));
  assert.equal(future.status, 200, JSON.stringify(future.body));
  const justExpired = await callBilling(ROUTES[0], billingToken({ exp: now - 3 }));
  assert.equal(justExpired.status, 401);
  assert.equal(justExpired.body.error, 'Invalid or expired Clerk authorization.');
});

test('billing SDK path rejects an iat 30s in the future and an exp 3s in the past', async () => {
  useBillingEnv('sdk');
  const now = Math.floor(Date.now() / 1000);
  const future = await callBilling(ROUTES[0], billingToken({ iat: now + 30 }));
  assert.equal(future.status, 401);
  assert.equal(future.body.error, 'Invalid or expired Clerk authorization.');
  const justExpired = await callBilling(ROUTES[0], billingToken({ exp: now - 3 }));
  assert.equal(justExpired.status, 401);
  assert.equal(justExpired.body.error, 'Invalid or expired Clerk authorization.');
});

test('proxy keeps a future iat and rejects an exp 3s in the past', async () => {
  useProxyEnv();
  installFetchMock([]);
  const handler = await loadHandler(proxyUrl);
  const now = Math.floor(Date.now() / 1000);
  async function access(claims) {
    const response = await handler(new Request('https://promptlab.tools/api/proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: WEB_ORIGIN,
        Authorization: `Bearer ${proxyToken(claims)}`,
      },
      body: JSON.stringify({
        targetUrl: 'https://api.anthropic.com/v1/messages',
        headers: {},
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
    }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.headers.get('X-Hosted-Access');
  }
  assert.equal(await access({ iat: now + 30 }), 'owner');
  assert.equal(await access({ exp: now - 3 }), 'standard');
});

test('billing manual mode uses the issuer public JWKS when no override or secret is set', async () => {
  useBillingEnv('manual');
  delete process.env.CLERK_JWKS_URL;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_JWT_KEY;
  const result = await callBilling(ROUTES[0], billingToken());
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(result.calls.includes(`${ISSUER}/.well-known/jwks.json`));
  assert.equal(result.calls.includes('https://api.clerk.com/v1/jwks'), false);
});

test('billing rejects a token that omits the authorized party', async () => {
  for (const mode of ['manual', 'sdk']) {
    useBillingEnv(mode);
    const result = await callBilling(ROUTES[0], billingToken({ azp: undefined }));
    assert.equal(result.status, 401, mode);
    assert.equal(result.body.error, 'Invalid or expired Clerk authorization.');
    assert.equal(result.calls.some((url) => url.includes('api.stripe.com')), false);
  }
});

test('billing accepts a foreign issuer when CLERK_JWT_ISSUER is unset, and accepts azp equal to the request origin', async () => {
  useBillingEnv('manual');
  delete process.env.CLERK_JWT_ISSUER;
  const foreign = await callBilling(ROUTES[0], billingToken({ iss: 'https://evil.example' }));
  assert.equal(foreign.status, 200, JSON.stringify(foreign.body));

  useBillingEnv('manual');
  const preview = await callBilling(
    ROUTES[0],
    billingToken({ azp: 'https://preview-clerk.example' }),
    { url: 'https://preview-clerk.example/api/billing/license' },
  );
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
});

test('proxy rejects a foreign issuer when CLERK_JWT_ISSUER is unset and does not treat the request host as azp', async () => {
  useProxyEnv();
  delete process.env.CLERK_JWT_ISSUER;
  const calls = [];
  installFetchMock(calls);
  const handler = await loadHandler(proxyUrl);
  const response = await handler(new Request('https://promptlab.tools/api/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: WEB_ORIGIN,
      Authorization: `Bearer ${proxyToken({ iss: 'https://evil.example', azp: 'https://preview-clerk.example' })}`,
    },
    body: JSON.stringify({
      targetUrl: 'https://api.anthropic.com/v1/messages',
      headers: {},
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        messages: [{ role: 'user', content: 'hello' }],
      }),
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Hosted-Access'), 'standard');
  assert.equal(calls.some((url) => url.includes('clerk.promptlab.tools')), false);
});

function apiJavaScriptFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...apiJavaScriptFiles(fullPath));
    else if (entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

test('session JWT verification is only implemented in clerkJwtVerifier.js', () => {
  const verifier = path.join(sourceDir, 'api', '_lib', 'clerkJwtVerifier.js');
  const others = apiJavaScriptFiles(path.join(sourceDir, 'api')).filter((file) => file !== verifier);
  for (const file of others) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ['"]@clerk\/backend['"]|createVerify\(|\bjwtVerify\(|\bcompactVerify\(/, file);
  }
  const shared = readFileSync(verifier, 'utf8');
  assert.match(shared, /\bjwtVerify\(/);
  assert.match(shared, /\bcompactVerify\(/);
  assert.doesNotMatch(shared, /from ['"]@clerk\/backend['"]/);
});
