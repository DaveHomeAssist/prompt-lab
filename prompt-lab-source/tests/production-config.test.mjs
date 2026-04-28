import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const libDir = path.join(sourceDir, 'api', '_lib');
const stripeBillingUrl = pathToFileURL(path.join(libDir, 'stripeBilling.js')).href;
const telemetryStoreUrl = pathToFileURL(path.join(libDir, 'telemetryStore.js')).href;
const productionConfigUrl = pathToFileURL(path.join(libDir, 'assertProductionConfig.js')).href;

const ENV_KEYS = [
  'NODE_ENV',
  'STRIPE_SECRET_KEY',
  'CLERK_SECRET_KEY',
  'KV_URL',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'STRIPE_WEBHOOK_SECRET',
  'PROMPTLAB_BILLING_CONSOLE_FALLBACK',
  'PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

async function loadModule(moduleUrl) {
  return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`);
}

function setProductionEnvWithoutStorage() {
  process.env.NODE_ENV = 'production';
  process.env.STRIPE_SECRET_KEY = 'sk_live_123';
  process.env.CLERK_SECRET_KEY = 'sk_clerk_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_123';
  delete process.env.KV_URL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

test('production config throws when durable storage is missing', async () => {
  setProductionEnvWithoutStorage();
  const { assertProductionConfig } = await loadModule(productionConfigUrl);

  assert.throws(
    () => assertProductionConfig(),
    /KV_URL, KV_REST_API_URL\+KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL\+UPSTASH_REDIS_REST_TOKEN/i,
  );
});

test('production billing webhook persistence throws instead of using console fallback', async () => {
  setProductionEnvWithoutStorage();
  process.env.PROMPTLAB_BILLING_CONSOLE_FALLBACK = '1';
  const { buildStripeConfig, persistStripeWebhookRecord } = await loadModule(stripeBillingUrl);
  console.log = assert.fail;

  await assert.rejects(
    () => persistStripeWebhookRecord({
      type: 'invoice.paid',
      occurredAt: new Date().toISOString(),
      customerId: 'cus_123',
      customerEmail: 'user@example.com',
      customerName: '',
      subscriptionId: 'sub_123',
      status: 'active',
      billingPeriod: 'monthly',
      priceId: 'price_123',
      rawType: 'invoice.paid',
    }, buildStripeConfig()),
    /durable billing storage is required/i,
  );
});

test('production telemetry disables events when durable storage is missing', async () => {
  setProductionEnvWithoutStorage();
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = '1';
  const { buildTelemetryConfig, persistTelemetryEvent } = await loadModule(telemetryStoreUrl);
  console.log = assert.fail;

  const result = await persistTelemetryEvent({
    event: 'app.opened',
    deviceId: 'device-1',
    contactEmail: '',
    plan: 'free',
    surface: 'web',
    appVersion: '1.7.0',
    telemetryEnabled: true,
    occurredAt: new Date().toISOString(),
    context: null,
  }, buildTelemetryConfig());

  assert.deepEqual(result, { ok: true, mode: 'disabled' });
});
