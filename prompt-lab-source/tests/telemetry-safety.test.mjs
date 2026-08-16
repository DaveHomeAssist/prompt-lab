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
  'PROMPTLAB_WEB_ORIGIN',
  'VITE_PROMPTLAB_WEB_ORIGIN',
  'PROMPTLAB_PROXY_ALLOWED_ORIGINS',
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

const ALLOWED_WEB_ORIGIN = 'https://promptlab.tools';
const FOREIGN_ORIGIN = 'https://evil.example';
const EXTENSION_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

// Browser clients always send Origin on POST; the default mirrors the
// production web app so the existing behaviour tests exercise the allowed path.
function telemetryRequest(body, ip = '203.0.113.10', { origin = ALLOWED_WEB_ORIGIN, method = 'POST' } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Forwarded-For': ip,
  };
  if (origin) headers.Origin = origin;
  return new Request('https://promptlab.tools/api/telemetry', {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function assertNoWildcardCors(response, label) {
  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), '*', `${label} must never allow '*'`);
  assert.equal(response.headers.get('Vary'), 'Origin', `${label} must vary on Origin`);
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

// Telemetry-off is a terminal contract: the client replays queued events until
// one is accepted, so a 5xx here means the queue never drains. A non-error
// status with retryable: false lets the client drop the event and move on.
async function assertTerminalDisabledResponse(response, label) {
  assert.ok(response.status < 400, `${label} status ${response.status} should be < 400`);
  assert.equal(response.headers.get('Retry-After'), null, `${label} must not send Retry-After`);
  const payload = await response.json();
  assert.equal(payload.retryable, false, `${label} must mark the response non-retryable`);
  assert.equal(payload.telemetryDisabled, true, `${label} must flag telemetry as disabled`);
  return payload;
}

test('production telemetry defaults off without reading or persisting the payload', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.PROMPTLAB_TELEMETRY_ENABLED;
  globalThis.fetch = assert.fail;

  const { default: handler } = await loadModule(telemetryUrl);
  const response = await handler(telemetryRequest(validEvent()));
  const payload = await assertTerminalDisabledResponse(response, 'telemetry (feature off)');
  assert.match(payload.error, /Telemetry is disabled/i);
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
  const payload = await assertTerminalDisabledResponse(response, 'telemetry (unconfigured)');
  assert.match(payload.error, /storage is not configured/i);
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

test('all landing funnel events persist through the API handler to Redis counters and the event list', async () => {
  process.env.NODE_ENV = 'production';
  process.env.PROMPTLAB_TELEMETRY_ENABLED = 'true';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';

  const now = Date.now();
  const events = [
    {
      event: 'landing.referral_opened',
      context: {
        attributionVersion: 1,
        placement: 'hero',
        intent: 'free',
        destination: 'app',
        timestamp: now,
      },
    },
    {
      event: 'landing.cta_clicked',
      context: {
        attributionVersion: 1,
        placement: 'privacy',
        intent: 'open',
        destination: 'privacy',
        timestamp: now,
      },
    },
    {
      event: 'landing.demo_completed',
      context: {
        attributionVersion: 1,
        placement: 'demo',
        intent: 'sample',
        destination: 'demo',
        demoMode: 'balanced',
        resultCount: 1,
        timestamp: now,
      },
    },
    {
      event: 'landing.surface_selected',
      context: {
        attributionVersion: 1,
        placement: 'surface_web',
        intent: 'open',
        destination: 'app',
        timestamp: now,
      },
    },
    {
      event: 'landing.pricing_period_selected',
      context: {
        attributionVersion: 1,
        placement: 'pricing_pro',
        intent: 'upgrade',
        period: 'annual',
        timestamp: now,
      },
    },
    {
      event: 'landing.docs_result_selected',
      context: {
        attributionVersion: 1,
        placement: 'docs_search',
        intent: 'open',
        destination: 'guide',
        resultCount: 1,
        timestamp: now,
      },
    },
  ];
  const writes = [];
  globalThis.fetch = async (url, init = {}) => {
    const parsed = new URL(url);
    writes.push({
      pathname: parsed.pathname,
      authorization: new Headers(init.headers).get('Authorization'),
      body: init.body,
    });
    const command = decodeURIComponent(parsed.pathname.split('/')[1] || '');
    const result = command === 'set' || command === 'ltrim' ? 'OK' : 1;
    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { default: handler } = await loadModule(telemetryUrl);
  for (const [index, event] of events.entries()) {
    const response = await handler(telemetryRequest({
      ...event,
      surface: 'web',
      deviceId: `landing-device-${index + 1}`,
      sessionId: `landing-session-${index + 1}`,
      telemetryEnabled: true,
      contactEmail: 'must-not-persist@example.com',
    }, `203.0.113.${40 + index}`));
    assert.equal(response.status, 200, event.event);
    assert.deepEqual(await response.json(), { ok: true, mode: 'redis' }, event.event);
  }

  assert.equal(writes.every(({ authorization }) => authorization === 'Bearer test-token'), true);
  for (const { event } of events) {
    assert.equal(
      writes.some(({ pathname }) => decodeURIComponent(pathname)
        === `/incr/promptlab:telemetry:count:${event}`),
      true,
      `${event} should increment its aggregate counter`,
    );
  }

  const eventWrites = writes
    .filter(({ pathname }) => decodeURIComponent(pathname)
      === '/rpush/promptlab:telemetry:telemetry:events');
  assert.equal(eventWrites.length, events.length);
  assert.deepEqual(
    eventWrites.map(({ body }) => {
      const payload = JSON.parse(body);
      assert.equal(payload.telemetryEnabled, true);
      assert.equal(Object.hasOwn(payload, 'contactEmail'), false);
      return payload.event;
    }),
    events.map(({ event }) => event),
  );
  assert.equal(
    writes.filter(({ pathname }) => decodeURIComponent(pathname)
      .startsWith('/ltrim/promptlab:telemetry:telemetry:events/')).length,
    events.length,
  );
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

test('telemetry echoes only the allowed production web origin and never a wildcard', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const { default: handler } = await loadModule(telemetryUrl);

  const response = await handler(telemetryRequest(validEvent()));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_WEB_ORIGIN);
  assertNoWildcardCors(response, 'allowed origin');
});

test('telemetry rejects foreign and missing origins with 403 before reading the body', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  const { default: handler } = await loadModule(telemetryUrl);

  const foreign = await handler(telemetryRequest(validEvent(), '203.0.113.40', { origin: FOREIGN_ORIGIN }));
  assert.equal(foreign.status, 403);
  assert.deepEqual(await foreign.json(), { error: 'Origin is not allowed.' });
  assert.equal(foreign.headers.get('Access-Control-Allow-Origin'), null, 'foreign origin must get no Allow-Origin');
  assertNoWildcardCors(foreign, 'foreign origin');

  const missing = await handler(telemetryRequest(validEvent(), '203.0.113.41', { origin: '' }));
  assert.equal(missing.status, 403);
  assert.equal(missing.headers.get('Access-Control-Allow-Origin'), null);

  // The origin gate runs ahead of the telemetry-off terminal response, so a
  // disallowed origin cannot even learn whether telemetry is enabled.
  process.env.PROMPTLAB_TELEMETRY_ENABLED = 'false';
  const disabledButForeign = await (await loadModule(telemetryUrl)).default(
    telemetryRequest(validEvent(), '203.0.113.42', { origin: FOREIGN_ORIGIN }),
  );
  assert.equal(disabledButForeign.status, 403);
});

test('telemetry accepts a configured chrome-extension origin and rejects unlisted extension ids', async () => {
  process.env.PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK = 'false';
  process.env.PROMPTLAB_PROXY_ALLOWED_ORIGINS = EXTENSION_ORIGIN;
  const { default: handler } = await loadModule(telemetryUrl);

  const allowed = await handler(telemetryRequest(validEvent(), '203.0.113.50', { origin: EXTENSION_ORIGIN }));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), EXTENSION_ORIGIN);
  assertNoWildcardCors(allowed, 'extension origin');

  const unlisted = await handler(telemetryRequest(validEvent(), '203.0.113.51', {
    origin: 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba',
  }));
  assert.equal(unlisted.status, 403);
  assert.equal(unlisted.headers.get('Access-Control-Allow-Origin'), null);
});

test('telemetry preflight is origin-specific', async () => {
  const { default: handler } = await loadModule(telemetryUrl);

  const preflight = await handler(telemetryRequest(null, '203.0.113.60', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ALLOWED_WEB_ORIGIN);
  assert.match(preflight.headers.get('Access-Control-Allow-Methods') || '', /\bPOST\b/);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers') || '', /Content-Type/);
  assertNoWildcardCors(preflight, 'preflight');

  const foreignPreflight = await handler(telemetryRequest(null, '203.0.113.61', {
    method: 'OPTIONS',
    origin: FOREIGN_ORIGIN,
  }));
  assert.equal(foreignPreflight.status, 403);
  assert.equal(foreignPreflight.headers.get('Access-Control-Allow-Origin'), null);
});
