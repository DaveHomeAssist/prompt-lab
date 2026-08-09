import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const apiDir = path.join(sourceDir, 'api');
const checkoutUrl = pathToFileURL(path.join(apiDir, 'billing', 'checkout.js')).href;
const licenseUrl = pathToFileURL(path.join(apiDir, 'billing', 'license.js')).href;
const portalUrl = pathToFileURL(path.join(apiDir, 'billing', 'portal.js')).href;
const webhookUrl = pathToFileURL(path.join(apiDir, 'billing', 'webhook.js')).href;
const runtimeSafetyUrl = pathToFileURL(path.join(apiDir, '_lib', 'runtimeSafety.js')).href;
const stripeBillingUrl = pathToFileURL(path.join(apiDir, '_lib', 'stripeBilling.js')).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV',
  'BILLING_ENABLED',
  'CLERK_SECRET_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'KV_URL',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'PROMPTLAB_REDIS_TIMEOUT_MS',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

async function loadModule(url) {
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

function postRequest(pathname, body = {}) {
  return new Request(`https://promptlab.tools${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('all billing routes default off in production before auth or external work', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.BILLING_ENABLED;
  globalThis.fetch = assert.fail;

  const cases = [
    [checkoutUrl, '/api/billing/checkout', { period: 'monthly' }],
    [portalUrl, '/api/billing/portal', {}],
    [webhookUrl, '/api/billing/webhook', {}],
  ];

  for (const [moduleUrl, pathname, body] of cases) {
    const { default: handler } = await loadModule(moduleUrl);
    const response = await handler(postRequest(pathname, body));
    assert.equal(response.status, 503, pathname);
    assert.match(await response.text(), /Billing is disabled/i, pathname);
  }
});

// License is the exception to the 503 default: unpatched clients retry 5xx
// responses in a loop, so billing-off must be a terminal 200 contract.
const BILLING_DISABLED_CONTRACT = {
  ok: true,
  plan: 'free',
  status: 'free',
  billingDisabled: true,
  retryable: false,
};

test('license returns the terminal billing-disabled contract when the feature is off', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.BILLING_ENABLED;
  globalThis.fetch = assert.fail;

  const { default: handler } = await loadModule(licenseUrl);
  const response = await handler(postRequest('/api/billing/license', { action: 'validate' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), BILLING_DISABLED_CONTRACT);
});

test('license returns the terminal billing-disabled contract when production secrets are missing', async () => {
  process.env.NODE_ENV = 'production';
  process.env.BILLING_ENABLED = 'true';
  for (const key of ENV_KEYS.filter((name) => !['NODE_ENV', 'BILLING_ENABLED'].includes(name))) {
    delete process.env[key];
  }
  globalThis.fetch = assert.fail;

  const { default: handler } = await loadModule(licenseUrl);
  const response = await handler(postRequest('/api/billing/license', { action: 'validate' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), BILLING_DISABLED_CONTRACT);
});

test('explicit billing enablement still fails closed when production secrets are missing', async () => {
  process.env.NODE_ENV = 'production';
  process.env.BILLING_ENABLED = 'true';
  for (const key of ENV_KEYS.filter((name) => !['NODE_ENV', 'BILLING_ENABLED'].includes(name))) {
    delete process.env[key];
  }

  const { default: handler } = await loadModule(checkoutUrl);
  const response = await handler(postRequest('/api/billing/checkout', { period: 'monthly' }));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Billing is not configured/i);
});

test('checkout requires a Clerk bearer token when billing is available', async () => {
  delete process.env.NODE_ENV;
  delete process.env.BILLING_ENABLED;

  const { default: handler } = await loadModule(checkoutUrl);
  const response = await handler(postRequest('/api/billing/checkout', { period: 'monthly' }));
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Clerk authorization/i);
});

test('external fetch helper aborts stalled work with a typed timeout', async () => {
  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const { fetchWithTimeout, isExternalFetchTimeout } = await loadModule(runtimeSafetyUrl);
  await assert.rejects(
    () => fetchWithTimeout('https://example.test', {}, { service: 'Test service', timeoutMs: 5 }),
    (error) => {
      assert.equal(isExternalFetchTimeout(error), true);
      assert.match(error.message, /Test service request timed out/i);
      return true;
    },
  );
});

test('billing webhook storage aborts a stalled Redis request', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.PROMPTLAB_REDIS_TIMEOUT_MS = '5';
  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const {
    buildStripeConfig,
    persistStripeWebhookRecord,
  } = await loadModule(stripeBillingUrl);
  await assert.rejects(
    () => persistStripeWebhookRecord({
      type: 'invoice.paid',
      occurredAt: new Date().toISOString(),
      customerId: 'cus_test',
      customerEmail: '',
      customerName: '',
      subscriptionId: 'sub_test',
      status: 'active',
      billingPeriod: 'monthly',
      priceId: 'price_test',
      rawType: 'invoice.paid',
    }, buildStripeConfig()),
    /Redis request timed out/i,
  );
});
