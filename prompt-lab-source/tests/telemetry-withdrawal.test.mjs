// PRIV-02: withdrawing insights consent deletes the device profile, the contact
// record written by that device, and that device's entries in the event list.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const telemetryUrl = pathToFileURL(path.join(sourceDir, 'api', 'telemetry.js')).href;
const telemetryStoreUrl = pathToFileURL(path.join(sourceDir, 'api', '_lib', 'telemetryStore.js')).href;
const clientTelemetryUrl = pathToFileURL(path.join(
  sourceDir, 'prompt-lab-extension', 'src', 'lib', 'telemetry.js',
)).href;

const ORIGINAL_FETCH = globalThis.fetch;
const ENV_KEYS = [
  'NODE_ENV', 'VERCEL_ENV', 'PROMPTLAB_TELEMETRY_PREFIX', 'PROMPTLAB_TELEMETRY_ENABLED',
  'PROMPTLAB_TELEMETRY_RATE_LIMIT', 'KV_REST_API_URL', 'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

test.beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

async function load(url) {
  return import(`${url}?t=${Date.now()}-${Math.random()}`);
}

// Stateful Upstash REST fake covering the commands telemetry uses.
function redisStore() {
  const strings = new Map();
  const lists = new Map();
  const commands = [];
  const fetch = async (url, init = {}) => {
    const parts = new URL(String(url)).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (init.body != null) parts.push(String(init.body));
    commands.push(parts);
    const [command, key, ...rest] = parts;
    let result = 'OK';
    switch (command) {
      case 'set': strings.set(key, rest[0]); break;
      case 'get': result = strings.has(key) ? strings.get(key) : null; break;
      case 'del': result = strings.delete(key) ? 1 : 0; break;
      case 'incr': strings.set(key, String(Number(strings.get(key) || 0) + 1)); result = Number(strings.get(key)); break;
      case 'expire': result = 1; break;
      case 'rpush': { const list = lists.get(key) || []; list.push(rest[0]); lists.set(key, list); result = list.length; break; }
      case 'ltrim': break;
      case 'lrange': result = [...(lists.get(key) || [])]; break;
      case 'lrem': {
        const list = lists.get(key) || [];
        const kept = list.filter((entry) => entry !== rest[1]);
        lists.set(key, kept);
        result = list.length - kept.length;
        break;
      }
      default: throw new Error(`unexpected redis command ${command}`);
    }
    return Response.json({ result });
  };
  return { strings, lists, commands, fetch };
}

function config() {
  return {
    redisUrl: 'https://redis.example.test',
    redisToken: 'test-token',
    prefix: 'promptlab',
    eventListLimit: 2000,
    recordTtlSeconds: 180 * 86_400,
    redisTimeoutMs: 2000,
  };
}

const PROFILE = (id) => `promptlab:telemetry:profile:${id}`;
const CONTACT = (email) => `promptlab:telemetry:contact:${email}`;
const EVENTS = 'promptlab:telemetry:telemetry:events';

async function seed(store, { normalizeTelemetryEvent, persistTelemetryEvent }, deviceId, email) {
  globalThis.fetch = store.fetch;
  await persistTelemetryEvent(normalizeTelemetryEvent({
    event: 'identity.updated', deviceId, telemetryEnabled: true, contactEmail: email,
    context: { source: 'preferences', telemetryEnabled: true },
  }), config());
  await persistTelemetryEvent(normalizeTelemetryEvent({
    event: 'billing.modal_opened', deviceId, telemetryEnabled: true,
  }), config());
}

test('withdrawal deletes the device profile, its contact record and its events', async () => {
  const store = redisStore();
  const mod = await load(telemetryStoreUrl);
  await seed(store, mod, 'pldev-a', 'a@example.com');
  await seed(store, mod, 'pldev-b', 'b@example.com');
  assert.ok(store.strings.has(PROFILE('pldev-a')));
  assert.ok(store.strings.has(CONTACT('a@example.com')));
  assert.equal(store.lists.get(EVENTS).length, 4);

  // Ordinary events rewrite the profile without the email (AN-07), so the
  // client sends the email it holds as a lookup hint.
  const result = await mod.deleteTelemetryRecords({ deviceId: 'pldev-a', contactEmail: 'a@example.com' }, config());

  assert.deepEqual(result.deleted, { profile: true, contact: true, events: 2 });
  assert.equal(store.strings.has(PROFILE('pldev-a')), false);
  assert.equal(store.strings.has(CONTACT('a@example.com')), false);
  assert.ok(store.lists.get(EVENTS).every((entry) => JSON.parse(entry).deviceId === 'pldev-b'));
  // Other devices are untouched.
  assert.ok(store.strings.has(PROFILE('pldev-b')));
  assert.ok(store.strings.has(CONTACT('b@example.com')));
  assert.equal(store.lists.get(EVENTS).length, 2);
});

test('an email alone cannot delete a contact record written by another device', async () => {
  const store = redisStore();
  const mod = await load(telemetryStoreUrl);
  await seed(store, mod, 'pldev-victim', 'victim@example.com');

  const result = await mod.deleteTelemetryRecords({
    deviceId: 'pldev-attacker', contactEmail: 'victim@example.com',
  }, config());

  assert.deepEqual(result.deleted, { profile: false, contact: false, events: 0 });
  assert.ok(store.strings.has(CONTACT('victim@example.com')));
  assert.ok(store.strings.has(PROFILE('pldev-victim')));
});

test('the client email hint finds a contact record the current profile no longer names', async () => {
  const store = redisStore();
  const mod = await load(telemetryStoreUrl);
  await seed(store, mod, 'pldev-a', 'old@example.com');
  // Profile-only lookup misses it once a later event drops the email.
  // A later identify without an email overwrites the profile, leaving the old contact key.
  await mod.persistTelemetryEvent(mod.normalizeTelemetryEvent({
    event: 'identity.updated', deviceId: 'pldev-a', telemetryEnabled: true,
    context: { source: 'preferences', telemetryEnabled: true },
  }), config());
  assert.equal(JSON.parse(store.strings.get(PROFILE('pldev-a'))).contactEmail, undefined);

  const result = await mod.deleteTelemetryRecords({ deviceId: 'pldev-a', contactEmail: 'OLD@example.com' }, config());
  assert.equal(result.deleted.contact, true);
  assert.equal(store.strings.has(CONTACT('old@example.com')), false);
});

test('withdrawal without a device id is rejected and without Redis is a no-op', async () => {
  const mod = await load(telemetryStoreUrl);
  await assert.rejects(() => mod.deleteTelemetryRecords({}, config()), /device id is required/);
  globalThis.fetch = assert.fail;
  const result = await mod.deleteTelemetryRecords({ deviceId: 'pldev-a' }, { ...config(), redisUrl: '', redisToken: '' });
  assert.equal(result.mode, 'noop');
});

function withdrawRequest(body, ip = '203.0.113.77') {
  return new Request('https://promptlab.tools/api/telemetry?action=withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://promptlab.tools', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
}

test('the API deletes records on withdrawal even when telemetry collection is switched off', async () => {
  process.env.NODE_ENV = 'production';
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  delete process.env.PROMPTLAB_TELEMETRY_ENABLED;
  const store = redisStore();
  const mod = await load(telemetryStoreUrl);
  await seed(store, mod, 'pldev-a', 'a@example.com');

  const { default: handler } = await load(telemetryUrl);
  const response = await handler(withdrawRequest({
    kind: 'withdraw', deviceId: 'pldev-a', contactEmail: 'a@example.com', telemetryEnabled: false,
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.withdrawn, true);
  assert.deepEqual(payload.deleted, { profile: true, contact: true, events: 2 });
  assert.equal(store.strings.has(PROFILE('pldev-a')), false);
  assert.equal(store.strings.has(CONTACT('a@example.com')), false);
  assert.equal(JSON.stringify(payload).includes('a@example.com'), false);
});

test('the API withdrawal path stores nothing and needs no consent flag', async () => {
  process.env.KV_REST_API_URL = 'https://redis.example.test';
  process.env.KV_REST_API_TOKEN = 'test-token';
  process.env.PROMPTLAB_TELEMETRY_ENABLED = 'true';
  const store = redisStore();
  globalThis.fetch = store.fetch;

  const { default: handler } = await load(telemetryUrl);
  const response = await handler(withdrawRequest({ kind: 'withdraw', deviceId: 'pldev-new' }));
  assert.equal(response.status, 200);
  const writes = store.commands.filter(([command]) => ['set', 'rpush'].includes(command));
  assert.deepEqual(writes, []);
});

test('the API rejects a withdrawal without a device id', async () => {
  const { default: handler } = await load(telemetryUrl);
  const response = await handler(withdrawRequest({ kind: 'withdraw' }));
  assert.equal(response.status, 400);
});

test('the client withdrawal payload carries the device id and a normalized email only', async () => {
  const { buildTelemetryWithdrawalPayload } = await load(clientTelemetryUrl);
  assert.deepEqual(
    { ...buildTelemetryWithdrawalPayload({ deviceId: 'pldev-a', contactEmail: ' A@Example.com ' }), surface: 'x' },
    { kind: 'withdraw', surface: 'x', deviceId: 'pldev-a', telemetryEnabled: false, contactEmail: 'a@example.com' },
  );
  assert.equal('contactEmail' in buildTelemetryWithdrawalPayload({ deviceId: 'pldev-a', contactEmail: '' }), false);
});

test('records keep the 180-day default expiry the policy states', async () => {
  const { buildTelemetryConfig } = await load(telemetryStoreUrl);
  assert.equal(buildTelemetryConfig().recordTtlSeconds, 180 * 86_400);
});
