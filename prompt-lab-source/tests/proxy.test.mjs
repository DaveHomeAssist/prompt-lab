import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(testDir, '..');
const proxyModuleUrl = pathToFileURL(path.join(sourceDir, 'api', 'proxy.js')).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'HOSTED_ALLOWED_ANTHROPIC_MODELS',
  'HOSTED_MAX_TOKENS',
  'HOSTED_DEMO_DAILY_LIMIT',
  'HOSTED_BURST_LIMIT',
  'HOSTED_PROXY_ENABLED',
  'HOSTED_SHARED_KEY_ENABLED',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
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
  body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{ role: 'user', content: 'hello' }],
  },
} = {}) {
  return new Request('https://promptlab.tools/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

test('proxy preserves user auth and only injects the shared key when auth is missing', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';

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

test('proxy locks hosted traffic to Anthropic and clamps models and token budgets', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_ALLOWED_ANTHROPIC_MODELS = 'claude-sonnet-4-20250514';
  process.env.HOSTED_MAX_TOKENS = '1024';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '10';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';

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
  assert.match(await blocked.text(), /Anthropic only/i);

  const allowed = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
    body: {
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'hello' }],
    },
  }));
  assert.equal(allowed.status, 200);
  assert.equal(captured[0].model, 'claude-sonnet-4-20250514');
  assert.equal(captured[0].max_tokens, 1024);
});

test('proxy enforces the shared-key daily limit', async () => {
  process.env.ANTHROPIC_API_KEY = 'server-key';
  process.env.HOSTED_DEMO_DAILY_LIMIT = '1';
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'true';

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

test('proxy is closed by default', async () => {
  globalThis.fetch = async () => {
    throw new Error('upstream should not run while proxy is disabled');
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: { 'x-api-key': 'user-key' },
  }));

  assert.equal(response.status, 503);
  assert.match(await response.text(), /proxy is disabled/i);
});

test('proxy rejects shared-key traffic unless shared access is explicitly enabled', async () => {
  process.env.HOSTED_PROXY_ENABLED = 'true';
  process.env.HOSTED_SHARED_KEY_ENABLED = 'false';

  globalThis.fetch = async () => {
    throw new Error('upstream should not run for shared-key traffic');
  };

  const handler = await loadHandler();
  const response = await handler(makeRequest({
    headers: { 'x-api-key': '__plb_hosted_shared_key__' },
  }));

  assert.equal(response.status, 401);
  assert.match(await response.text(), /own Anthropic key/i);
});
