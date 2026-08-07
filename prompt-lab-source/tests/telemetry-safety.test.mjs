import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const telemetryUrl = pathToFileURL(path.join(sourceDir, 'api', 'telemetry.js')).href;
const telemetryStoreUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'telemetryStore.js')).href;
const clientTelemetryUrl = pathToFileURL(path.join(
  sourceDir,
  'prompt-lab-extension',
  'src',
  'lib',
  'telemetry.js',
)).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV',
  'PROMPTLAB_TELEMETRY_ENABLED',
  'PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK',
  'PROMPTLAB_TELEMETRY_RATE_LIMIT',
  'PROMPTLAB_TELEMETRY_MAX_BODY_BYTES',
  'PROMPTLAB_REDIS_TIMEOUT_MS',
  'KV_URL',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
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

function telemetryRequest(body, ip = '203.0.113.10') {
  return new Request('https://promptlab.tools/api/telemetry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
    },
    body: JSON.stringify(body),
  });
}

function validEvent(overrides = {}) {
  return {
    event: 'landing.cta_clicked',
    surface: 'web',
    deviceId: 'device-1',
    sessionId: 'session-1',
    telemetryEnabled: true,
    context: {
      attributionVersion: 1,
      placement: 'hero',
      intent: 'free',
      destination: 'app',
      timestamp: Date.now(),
    },
    ...overrides,
  };
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('production telemetry defaults off without reading or persisting the payload', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.PROMPTLAB_TELEMETRY_ENABLED;
  globalThis.fetch = assert.fail;

  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent()));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Telemetry is disabled/i);
});

test('production telemetry enablement fails closed without durable storage', async () => {
  process.env.NODE_ENV = 'production';
  process.env.PROMPTLAB_TELEMETRY_ENABLED = 'true';
  delete process.env.KV_URL;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent()));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /storage is not configured/i);
});

test('telemetry rejects an explicit opt-out payload', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent({ telemetryEnabled: false })));
  assert.equal(response.status, 400);
  assert.match(await response.text(), /consent is required/i);
});

test('telemetry requires an explicit opt-in marker', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const { default: handler } = await loadModule(telemetryUrl);
  const event = validEvent();
  delete event.telemetryEnabled;
  const response = await handler(telemetryRequest(event));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /consent is required/i);
});

test('a real client envelope carries granted consent through the API handler without landing email', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const [{ buildTelemetryEnvelope }, { default: handler }] = await Promise.all([
    loadModule(clientTelemetryUrl),
    loadModule(telemetryUrl),
  ]);
  const envelope = buildTelemetryEnvelope({
    deviceId: 'client-device-1',
    contactEmail: 'private@example.com',
    telemetryEnabled: true,
  }, 'client-session-1', 'landing.cta_clicked', {
    attributionVersion: 1,
    placement: 'hero',
    intent: 'free',
    destination: 'app',
    timestamp: Date.now(),
    promptText: 'must not cross the boundary',
  });

  assert.equal(envelope.telemetryEnabled, true);
  assert.equal(Object.hasOwn(envelope, 'contactEmail'), false);
  assert.equal(Object.hasOwn(envelope.context, 'promptText'), false);

  const response = await handler(telemetryRequest(envelope, '203.0.113.31'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, mode: 'noop' });
});

test('telemetry rejects unsupported event names before persistence', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent({ event: 'landing.attacker_key' })));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /supported telemetry event/i);
});

test('telemetry applies a bounded per-client request rate without storing request content', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  process.env.PROMPTLAB_TELEMETRY_RATE_LIMIT = '1';

  const { default: handler } = await loadModule(telemetryUrl);
  const rateLimitIp = '203.0.113.20';
  const first = await handler(telemetryRequest(validEvent(), rateLimitIp));
  const second = await handler(telemetryRequest(
    validEvent({ event: 'landing.demo_completed' }),
    rateLimitIp,
  ));

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('X-RateLimit-Remaining'), '0');
  assert.match(await second.text(), /rate limit exceeded/i);
});

test('telemetry rejects oversized payloads before persistence', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  process.env.PROMPTLAB_TELEMETRY_MAX_BODY_BYTES = '1024';

  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent({
    context: { safe: 'x'.repeat(1200) },
  })));
  assert.equal(response.status, 413);
  assert.match(await response.text(), /payload is too large/i);
});

test('telemetry context strips prompt, output, search, credential, and email fields', async () => {
  const { normalizeTelemetryEvent } = await loadModule(telemetryStoreUrl);
  const event = normalizeTelemetryEvent(validEvent({
    context: {
      attributionVersion: 1,
      placement: 'pricing_pro',
      intent: 'free',
      destination: 'app',
      promptText: 'private prompt',
      output: 'private output',
      searchQuery: 'private search',
      apiKey: 'private key',
      contactEmail: 'private@example.com',
    },
  }));

  assert.deepEqual(event.context, {
    attributionVersion: 1,
    placement: 'pricing_pro',
    intent: 'free',
    destination: 'app',
  });
  assert.equal(Object.hasOwn(event, 'contactEmail'), false);
});

test('Redis abuse counters abort stalled external requests', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.PROMPTLAB_REDIS_TIMEOUT_MS = '5';
  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const {
    buildTelemetryConfig,
    enforceTelemetryRateLimit,
  } = await loadModule(telemetryStoreUrl);
  await assert.rejects(
    () => enforceTelemetryRateLimit(telemetryRequest(validEvent()), buildTelemetryConfig()),
    /Redis request timed out/i,
  );
});
