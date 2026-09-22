import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';

import {
  ErrorCategory,
  HostedLimitCode,
  normalizeError,
} from '../prompt-lab-extension/src/lib/errorTaxonomy.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const proxyModuleUrl = pathToFileURL(
  path.join(sourceDir, 'api', 'proxy.js'),
).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV',
  'ANTHROPIC_API_KEY',
  'HOSTED_PROXY_ENABLED',
  'HOSTED_SHARED_KEY_ENABLED',
  'PROMPTLAB_WEB_ORIGIN',
  'VITE_PROMPTLAB_WEB_ORIGIN',
  'PROMPTLAB_PROXY_ALLOWED_ORIGINS',
  'HOSTED_ALLOWED_ANTHROPIC_MODELS',
  'HOSTED_MAX_TOKENS',
  'HOSTED_MAX_INPUT_CHARS',
  'PROMPTLAB_ANTHROPIC_TIMEOUT_MS',
  'PROMPTLAB_REDIS_TIMEOUT_MS',
  'HOSTED_DEMO_DAILY_LIMIT',
  'HOSTED_GLOBAL_DAILY_LIMIT',
  'HOSTED_BURST_LIMIT',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'CLERK_JWT_ISSUER',
  'CLERK_JWT_AUDIENCE',
  'CLERK_AUTHORIZED_PARTIES',
  'PROMPTLAB_PRO_OWNER_CLERK_USER_IDS',
  'PROMPTLAB_OWNER_CLERK_USER_IDS',
  'PROMPTLAB_PRO_OWNER_USER_IDS',
  'PROMPTLAB_OWNER_USER_IDS',
];
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function resetEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') {
      delete process.env[key];
    } else {
      process.env[key] = ORIGINAL_ENV[key];
    }
  }
}

async function loadHandler() {
  const mod = await import(`${proxyModuleUrl}?t=${Date.now()}-${Math.random()}`);
  return mod.default;
}

function makeRequest({
  targetUrl = 'https://api.anthropic.com/v1/messages',
  headers = {},
  requestOrigin = 'https://promptlab.tools',
  clientIp = '203.0.113.10',
  outerHeaders = {},
  body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
    messages: [{ role: 'user', content: 'hello' }],
  },
} = {}) {
  return new Request('https://promptlab.tools/api/proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(requestOrigin ? { Origin: requestOrigin } : {}),
      ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
      ...outerHeaders,
    },
    body: JSON.stringify({
      targetUrl,
      headers,
      body: JSON.stringify(body),
    }),
  });
}

test.afterEach(() => {
  resetEnv();
  globalThis.fetch = ORIGINAL_FETCH;
});

test('production defaults the whole proxy route off, including BYOK requests', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ANTHROPIC_API_KEY = 'server-key';
  delete process.env.HOSTED_PROXY_ENABLED;
  delete process.env.HOSTED_SHARED_KEY_ENABLED;
  globalThis.fetch = assert.fail;

  const handler = await loadHandler();
  const byokResponse = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
  }));
  assert.equal(byokResponse.status, 503);
  assert.match(await byokResponse.text(), /proxy is disabled/i);

  const sharedResponse = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(sharedResponse.status, 503);
  assert.match(await sharedResponse.text(), /proxy is disabled/i);
});

test('an enabled production proxy preserves BYOK while shared-key injection stays separately disabled', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'false';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(init.headers);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const byokResponse = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
  }));
  assert.equal(byokResponse.status, 200);
  assert.equal(captured[0]['x-api-key'], 'user-key');

  const sharedResponse = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(sharedResponse.status, 403);
  assert.match(await sharedResponse.text(), /shared-key access is disabled/i);
  assert.equal(captured.length, 1);
});

test('production shared-key mode requires both hosted feature flags', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'redis-token';

  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://redis.example.test/')) {
      const result = String(url).includes('/pttl/') ? 60_000 : 1;
      return new Response(JSON.stringify({ result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    assert.equal(init.headers['x-api-key'], 'server-key');
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(response.status, 200);
});

test('proxy preserves user auth and only injects the shared key when auth is missing', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push({
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();

  const userKeyResponse = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
  }));
  assert.equal(userKeyResponse.status, 200);
  assert.equal(captured[0].headers['x-api-key'], 'user-key');

  const sharedKeyResponse = await handler(makeRequest({
    headers: {
      'x-api-key': '__plb_hosted_shared_key__',
      'anthropic-version': '2023-06-01',
    },
  }));
  assert.equal(sharedKeyResponse.status, 200);
  assert.equal(captured[1].headers['x-api-key'], 'server-key');
});

test('proxy accepts only exact configured web or extension origins', async () => {
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'false';
  process.env.PROMPTLAB_PROXY_ALLOWED_ORIGINS = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

  const capturedOrigins = [];
  globalThis.fetch = async (_url, init) => {
    capturedOrigins.push(init.headers['x-api-key']);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const webResponse = await handler(makeRequest({
    headers: { 'x-api-key': 'web-key' },
  }));
  assert.equal(webResponse.status, 200);
  assert.equal(webResponse.headers.get('Access-Control-Allow-Origin'), 'https://promptlab.tools');
  assert.equal(webResponse.headers.get('Vary'), 'Origin');

  const extensionResponse = await handler(makeRequest({
    requestOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    headers: { 'x-api-key': 'extension-key' },
  }));
  assert.equal(extensionResponse.status, 200);
  assert.equal(
    extensionResponse.headers.get('Access-Control-Allow-Origin'),
    'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  );

  // vercel.json routes mobile.promptlab.tools -> /mobile/index.html; that host
  // must reach the proxy without extra env configuration.
  const mobileResponse = await handler(makeRequest({
    requestOrigin: 'https://mobile.promptlab.tools',
    headers: { 'x-api-key': 'mobile-key' },
  }));
  assert.equal(mobileResponse.status, 200);
  assert.equal(mobileResponse.headers.get('Access-Control-Allow-Origin'), 'https://mobile.promptlab.tools');

  const evilResponse = await handler(makeRequest({
    requestOrigin: 'https://evil.example',
    headers: { 'x-api-key': 'evil-key' },
  }));
  assert.equal(evilResponse.status, 403);
  assert.equal(evilResponse.headers.get('Access-Control-Allow-Origin'), null);

  const missingOriginResponse = await handler(makeRequest({
    requestOrigin: '',
    headers: { 'x-api-key': 'missing-origin-key' },
  }));
  assert.equal(missingOriginResponse.status, 403);
  assert.deepEqual(capturedOrigins, ['web-key', 'extension-key', 'mobile-key']);
});

test('proxy preflight is origin-specific and fails closed when the route is disabled', async () => {
  process.env.NODE_ENV = 'production';
  process.env.HOSTED_PROXY_ENABLED = 'true';

  const handler = await loadHandler();
  const allowed = await handler(new Request('https://promptlab.tools/api/proxy', {
    method: 'OPTIONS',
    headers: { Origin: 'https://promptlab.tools' },
  }));
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), 'https://promptlab.tools');
  assert.doesNotMatch(allowed.headers.get('Access-Control-Allow-Origin'), /\*/);

  const rejected = await handler(new Request('https://promptlab.tools/api/proxy', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example' },
  }));
  assert.equal(rejected.status, 403);

  process.env.HOSTED_PROXY_ENABLED = 'false';
  const disabled = await handler(new Request('https://promptlab.tools/api/proxy', {
    method: 'OPTIONS',
    headers: { Origin: 'https://promptlab.tools' },
  }));
  assert.equal(disabled.status, 503);
  assert.match(await disabled.text(), /proxy is disabled/i);
});

test('proxy locks traffic to the exact Anthropic Messages endpoint and clamps models and token budgets', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_ALLOWED_ANTHROPIC_MODELS = 'claude-sonnet-4-6';
  process.env.HOSTED_MAX_TOKENS = '1024';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';

  const captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();

  const blocked = await handler(makeRequest({
    targetUrl: 'https://api.openai.com/v1/chat/completions',
  }));
  assert.equal(blocked.status, 403);
  assert.match(await blocked.text(), /Anthropic Messages endpoint/i);

  for (const targetUrl of [
    'https://api.anthropic.com/v1/organizations',
    'https://api.anthropic.com/v1/messages?beta=true',
    'https://api.anthropic.com/v1/messages/extra',
    'https://api.anthropic.com.evil.example/v1/messages',
  ]) {
    const response = await handler(makeRequest({ targetUrl }));
    assert.equal(response.status, 403, targetUrl);
  }

  const allowed = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
    body: {
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hello' }],
    },
  }));
  assert.equal(allowed.status, 200);
  assert.equal(captured[0].model, 'claude-sonnet-4-6');
  assert.equal(captured[0].max_tokens, 1024);
});

test('proxy rejects oversized hosted provider inputs before the provider call', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_MAX_INPUT_CHARS = '100';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';
  globalThis.fetch = assert.fail;

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
    body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'x'.repeat(200) }],
    },
  }));

  assert.equal(response.status, 400);
  assert.match(await response.text(), /100-character limit/i);
});

test('proxy forwards only the provider header allowlist', async () => {
  let capturedHeaders;
  globalThis.fetch = async (_url, init) => {
    capturedHeaders = init.headers;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
      cookie: 'session=do-not-forward',
      host: 'internal.example',
      origin: 'https://evil.example',
      'x-forwarded-for': '127.0.0.1',
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(capturedHeaders['x-api-key'], 'user-key');
  assert.equal(capturedHeaders['anthropic-version'], '2023-06-01');
  assert.equal(capturedHeaders['content-type'], 'application/json');
  assert.equal(capturedHeaders.cookie, undefined);
  assert.equal(capturedHeaders.host, undefined);
  assert.equal(capturedHeaders.origin, undefined);
  assert.equal(capturedHeaders['x-forwarded-for'], undefined);
});

test('proxy enforces the shared-key daily limit', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '1';

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const handler = await loadHandler();

  const first = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(first.status, 200);

  const second = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(second.status, 429);
  assert.match(await second.text(), /daily hosted demo limit reached/i);
});

test('proxy enforces a shared global daily limit across client IPs', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';
  process.env.HOSTED_GLOBAL_DAILY_LIMIT = '1';

  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const handler = await loadHandler();
  const first = await handler(makeRequest({
    clientIp: '203.0.113.10',
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('X-Global-Remaining'), '0');

  const second = await handler(makeRequest({
    clientIp: '203.0.113.11',
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));
  assert.equal(second.status, 429);
  assert.match(await second.text(), /service daily budget reached/i);
  assert.equal(second.headers.get('X-Global-Remaining'), '0');
  assert.equal(providerCalls, 1);
});

// Mirrors providers.js: the client rebuilds the proxy 429 into an Error that
// carries the body's code, limit, and reset time before classification.
async function classifyProxy429(response) {
  const data = await response.clone().json();
  const error = new Error(data.error);
  error.status = response.status;
  error.code = data.code;
  error.limit = data.limit;
  error.resetAt = data.reset_at;
  return normalizeError(error, 'anthropic');
}

test('proxy 429s carry a code, limit, and reset time the client attributes to Prompt Lab', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  const cases = [
    {
      code: HostedLimitCode.BURST,
      env: { HOSTED_BURST_LIMIT: '1' },
      limit: 1,
      request: (clientIp) => makeRequest({ clientIp, headers: { 'x-api-key': 'user-key' } }),
      secondIp: '203.0.113.10',
      action: 'retry',
    },
    {
      code: HostedLimitCode.DEMO,
      env: { HOSTED_DEMO_DAILY_LIMIT: '1' },
      limit: 1,
      request: (clientIp) => makeRequest({ clientIp, headers: { 'x-api-key': '__plb_hosted_shared_key__' } }),
      secondIp: '203.0.113.10',
      action: 'open_provider_settings',
    },
    {
      code: HostedLimitCode.GLOBAL,
      env: { HOSTED_DEMO_DAILY_LIMIT: '10', HOSTED_GLOBAL_DAILY_LIMIT: '1' },
      limit: 1,
      request: (clientIp) => makeRequest({ clientIp, headers: { 'x-api-key': '__plb_hosted_shared_key__' } }),
      secondIp: '203.0.113.11',
      action: 'open_provider_settings',
    },
  ];

  for (const entry of cases) {
    resetEnv();
    process.env.ANTHROPIC_API_KEY = 'server-key';
    Object.assign(process.env, entry.env);
    const handler = await loadHandler();

    assert.equal((await handler(entry.request('203.0.113.10'))).status, 200, entry.code);
    const limited = await handler(entry.request(entry.secondIp));
    assert.equal(limited.status, 429, entry.code);

    const body = await limited.clone().json();
    assert.equal(body.code, entry.code);
    assert.equal(body.limit, entry.limit);
    assert.ok(Date.parse(body.reset_at) > Date.now(), `${entry.code} reset_at is a future ISO time`);
    assert.equal(typeof body.error, 'string');

    const appError = await classifyProxy429(limited);
    assert.equal(appError.category, ErrorCategory.RATE_LIMIT, entry.code);
    assert.equal(appError.code, entry.code);
    assert.equal(appError.source, 'prompt-lab');
    assert.equal(appError.retryable, false, `${entry.code} must not auto-retry`);
    assert.match(appError.userMessage, /Prompt Lab limit, not an Anthropic one/);
    assert.doesNotMatch(appError.userMessage, /anthropic rate limit hit/i);
    assert.deepEqual(appError.actions, [entry.action]);
  }
});

test('production shared-key requests fail closed when durable rate limiting is unavailable', async () => {
  process.env.NODE_ENV = 'production';
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  globalThis.fetch = assert.fail;

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));

  assert.equal(response.status, 503);
  assert.match(await response.text(), /usage protection is unavailable/i);
});

test('proxy returns upstream streaming bodies without buffering them first', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';

  const encoder = new TextEncoder();
  let upstreamAborted = false;
  globalThis.fetch = async (_url, init) => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"content_block_delta","delta":{"text":"Copy-ready"}}\n\n'));
        init.signal.addEventListener('abort', () => {
          upstreamAborted = true;
        }, { once: true });
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );

  const handler = await loadHandler();
  const response = await Promise.race([
    handler(makeRequest({
      headers: { 'x-api-key': '__plb_hosted_shared_key__' },
      body: {
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        stream: true,
        messages: [{ role: 'user', content: 'hello' }],
      },
    })),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
  ]);

  assert.notEqual(response, 'timeout');
  assert.equal(response.headers.get('Content-Type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  assert.equal(new TextDecoder().decode(first.value), 'data: {"type":"content_block_delta","delta":{"text":"Copy-ready"}}\n\n');
  assert.equal(upstreamAborted, true);
});

test('proxy aborts a stalled Anthropic request within the configured safety timeout', async () => {
  process.env.PROMPTLAB_ANTHROPIC_TIMEOUT_MS = '5';

  globalThis.fetch = async (_url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
  }));

  assert.equal(response.status, 504);
  assert.match(await response.text(), /Anthropic request timed out/i);
});

test('proxy allows an active Anthropic stream to complete beyond the legacy timeout ceiling', async () => {
  process.env.PROMPTLAB_ANTHROPIC_TIMEOUT_MS = '40';
  const encoder = new TextEncoder();

  globalThis.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'));
        setTimeout(() => {
          controller.enqueue(encoder.encode('data: second\n\n'));
          controller.close();
        }, 25);
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
  }));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'data: first\n\ndata: second\n\n');
});

test('proxy keeps the Anthropic timeout active after streaming headers arrive', async () => {
  process.env.PROMPTLAB_ANTHROPIC_TIMEOUT_MS = '10';
  let upstreamAborted = false;
  const encoder = new TextEncoder();

  globalThis.fetch = async (_url, init) => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"message_start"}\n\n'));
        init.signal.addEventListener('abort', () => {
          upstreamAborted = true;
          // Deliberately leave the mock stream open. The timeout wrapper must
          // still fail the downstream read even if the upstream ignores abort.
        }, { once: true });
      },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    },
  );

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: {
      'x-api-key': 'user-key',
      'anthropic-version': '2023-06-01',
    },
    body: {
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    },
  }));

  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'data: {"type":"message_start"}\n\n');
  await assert.rejects(
    () => reader.read(),
    (error) => {
      assert.equal(error?.code, 'EXTERNAL_FETCH_TIMEOUT');
      assert.match(error?.message || '', /Anthropic request timed out/i);
      return true;
    },
  );
  assert.equal(upstreamAborted, true);
});

const ownerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ownerJwk = { ...ownerKeys.publicKey.export({ format: 'jwk' }), kid: 'owner-test-key', alg: 'RS256' };
const ownerIssuer = 'https://clerk.owner.example.test';

function ownerToken(claims = {}, privateKey = ownerKeys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: ownerJwk.kid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_owner', sid: 'sess_owner', iss: process.env.CLERK_JWT_ISSUER,
    azp: 'https://promptlab.tools', iat: now, nbf: now - 1, exp: now + 300, ...claims,
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function setupOwnerProxy() {
  process.env.NODE_ENV = 'test';
  process.env.CLERK_JWT_ISSUER = ownerIssuer;
  delete process.env.CLERK_JWT_AUDIENCE;
  delete process.env.CLERK_AUTHORIZED_PARTIES;
  process.env.PROMPTLAB_PRO_OWNER_CLERK_USER_IDS = 'user_owner, user_second_owner';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';
  process.env.HOSTED_BURST_LIMIT = '1';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '1';
  process.env.HOSTED_GLOBAL_DAILY_LIMIT = '20';
  process.env.ANTHROPIC_API_KEY = 'fixture-shared-key';
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
    delete process.env[key];
  }
  let upstreamCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === `${process.env.CLERK_JWT_ISSUER}/.well-known/jwks.json`) {
      return new Response(JSON.stringify({ keys: [ownerJwk] }), { status: 200 });
    }
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers['x-api-key'], 'fixture-shared-key');
    upstreamCalls += 1;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  return () => upstreamCalls;
}

test('both verified owners bypass exhausted shared-IP limits without consuming the visitor quota', async () => {
  const calls = setupOwnerProxy();
  const handler = await loadHandler();
  assert.equal((await handler(makeRequest())).status, 200);
  assert.equal((await handler(makeRequest())).status, 429);
  for (const sub of ['user_owner', 'user_second_owner', 'user_owner', 'user_second_owner']) {
    const response = await handler(makeRequest({ outerHeaders: { cookie: `other=value; __session=${ownerToken({ sub })}` } }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Hosted-Access'), 'owner');
    assert.equal(response.headers.get('X-Demo-Remaining'), null);
  }
  assert.equal(calls(), 5);
  assert.equal((await handler(makeRequest())).status, 429);
});

test('verified owners remain subject to the shared service budget', async () => {
  const calls = setupOwnerProxy();
  process.env.HOSTED_GLOBAL_DAILY_LIMIT = '1';
  const handler = await loadHandler();
  const outerHeaders = { authorization: `Bearer ${ownerToken()}` };
  assert.equal((await handler(makeRequest({ outerHeaders }))).status, 200);
  const blocked = await handler(makeRequest({ outerHeaders }));
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /service daily budget reached/i);
  assert.equal(calls(), 1);
});

test('owner access fails closed when the production global budget store is unavailable', async () => {
  const calls = setupOwnerProxy();
  process.env.NODE_ENV = 'production';
  const handler = await loadHandler();
  const response = await handler(makeRequest({ outerHeaders: { cookie: `__session=${ownerToken()}` } }));
  assert.equal(response.status, 503);
  assert.match(await response.text(), /global usage protection is unavailable/i);
  assert.equal(calls(), 0);
});

test('owner access preserves shared-key disablement and body validation', async () => {
  const calls = setupOwnerProxy();
  const handler = await loadHandler();
  const outerHeaders = { cookie: `__session=${ownerToken()}` };
  process.env.HOSTED_SHARED_KEY_ENABLED = 'false';
  assert.equal((await handler(makeRequest({ outerHeaders }))).status, 403);
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';
  assert.equal((await handler(makeRequest({ outerHeaders, body: null }))).status, 400);
  assert.equal((await handler(makeRequest({ outerHeaders, targetUrl: 'https://attacker.example/v1/messages' }))).status, 403);
  assert.equal(calls(), 0);
});

test('invalid, non-owner and spoofed identities cannot escape the daily demo limit', async () => {
  setupOwnerProxy();
  process.env.HOSTED_BURST_LIMIT = '0';
  const forgedKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const attempts = [
    { cookie: `__session=${ownerToken({ sub: 'user_visitor', email: 'owner@example.test', owner: true })}` },
    { cookie: `__session=${ownerToken({ exp: 1 })}` },
    { cookie: `__session=${ownerToken({ nbf: Math.floor(Date.now() / 1000) + 600 })}` },
    { cookie: `__session=${ownerToken({ iss: 'https://attacker.example' })}` },
    { cookie: `__session=${ownerToken({ azp: 'https://attacker.example' })}` },
    { cookie: `__session=${ownerToken({ sid: '' })}` },
    { cookie: `__session=${ownerToken({}, forgedKey)}` },
    { cookie: '__session=malformed' },
    { cookie: '__session=%invalid' },
    { 'x-clerk-user-id': 'user_owner', 'x-owner': 'true' },
    { authorization: 'Bearer invalid', cookie: `__session=${ownerToken()}` },
  ];
  for (const outerHeaders of attempts) {
    const handler = await loadHandler();
    const first = await handler(makeRequest({ outerHeaders }));
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('X-Hosted-Access'), 'standard');
    const blocked = await handler(makeRequest({ outerHeaders }));
    assert.equal(blocked.status, 429);
    assert.match(await blocked.text(), /daily hosted demo limit/i);
  }
});

test('Clerk key lookup failure preserves visitor limits without an upstream call', async () => {
  setupOwnerProxy();
  process.env.CLERK_JWT_ISSUER = 'https://clerk.unavailable.example.test';
  process.env.HOSTED_BURST_LIMIT = '0';
  const handler = await loadHandler();
  assert.equal((await handler(makeRequest())).status, 200);
  globalThis.fetch = async (url) => {
    assert.equal(String(url), `${process.env.CLERK_JWT_ISSUER}/.well-known/jwks.json`);
    throw new Error('fixture key endpoint unavailable');
  };
  const response = await handler(makeRequest({ outerHeaders: { cookie: `__session=${ownerToken()}` } }));
  assert.equal(response.status, 429);
});
