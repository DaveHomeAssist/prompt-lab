import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { clerkWebhookHandler, verifySvixSignature } from '../api/sync/clerk-webhook.js';

const SECRET = `whsec_${Buffer.from('local-test-signing-key-0123456789').toString('base64')}`;
const SERVICE_KEY = 'sb_secret_local_test_only';
const env = { CLERK_WEBHOOK_SIGNING_SECRET: SECRET, SUPABASE_URL: 'https://abcd.supabase.co', SUPABASE_SECRET_KEY: SERVICE_KEY };
const NOW = 1793360000;

function signed(event, { timestamp = NOW, secret = SECRET, id = 'msg_1' } = {}) {
  const body = JSON.stringify(event);
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return new Request('https://promptlab.tools/api/sync/clerk-webhook', {
    method: 'POST',
    headers: { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` },
    body,
  });
}

function recorder(response = { items: 3, conflicts: 1 }, ok = true) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok, json: async () => response }; } };
}

test('user.deleted with a valid signature erases that user through the service-role RPC', async () => {
  const { calls, fetchImpl } = recorder();
  const response = await clerkWebhookHandler(signed({ type: 'user.deleted', data: { id: 'user_2abcDEF', deleted: true } }), { env, fetchImpl, nowSeconds: NOW });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, deleted: { items: 3, conflicts: 1 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://abcd.supabase.co/rest/v1/rpc/sync_admin_delete_user');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_user_id: 'user_2abcDEF' });
  assert.equal(calls[0].init.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('bad, missing, replayed or wrong-secret signatures are rejected before any call', async () => {
  const { calls, fetchImpl } = recorder();
  const event = { type: 'user.deleted', data: { id: 'user_2abcDEF' } };
  const tampered = signed(event);
  const forged = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: JSON.stringify({ type: 'user.deleted', data: { id: 'user_victim' } }) });
  const cases = [
    forged,
    signed(event, { timestamp: NOW - 600 }),
    signed(event, { secret: `whsec_${Buffer.from('another-key').toString('base64')}` }),
    new Request('https://promptlab.tools/api/sync/clerk-webhook', { method: 'POST', body: JSON.stringify(event) }),
  ];
  for (const request of cases) {
    const response = await clerkWebhookHandler(request, { env, fetchImpl, nowSeconds: NOW });
    assert.equal(response.status, 401);
    assert.doesNotMatch(await response.text(), /sb_secret|whsec_/);
  }
  assert.equal(calls.length, 0);
});

test('other events are acknowledged and ignored; bad user ids are refused', async () => {
  const { calls, fetchImpl } = recorder();
  const ignored = await clerkWebhookHandler(signed({ type: 'user.updated', data: { id: 'user_2abcDEF' } }), { env, fetchImpl, nowSeconds: NOW });
  assert.equal(ignored.status, 200);
  const bad = await clerkWebhookHandler(signed({ type: 'user.deleted', data: { id: "user_x' or 1=1" } }), { env, fetchImpl, nowSeconds: NOW });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 0);
});

test('off (503) until all server env vars exist; database failures ask Clerk to retry', async () => {
  const off = await clerkWebhookHandler(signed({ type: 'user.deleted', data: { id: 'user_1' } }), { env: {}, nowSeconds: NOW });
  assert.equal(off.status, 503);
  const notSupabase = await clerkWebhookHandler(signed({ type: 'user.deleted', data: { id: 'user_1' } }), { env: { ...env, SUPABASE_URL: 'https://evil.example.com' }, nowSeconds: NOW });
  assert.equal(notSupabase.status, 503);
  const failing = recorder({}, false);
  const retry = await clerkWebhookHandler(signed({ type: 'user.deleted', data: { id: 'user_1' } }), { env, fetchImpl: failing.fetchImpl, nowSeconds: NOW });
  assert.equal(retry.status, 502);
  assert.equal((await clerkWebhookHandler(new Request('https://promptlab.tools/x', { method: 'GET' }), { env })).status, 405);
});

test('signature helper accepts any listed v1 signature', () => {
  const body = '{}';
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const good = createHmac('sha256', key).update(`m.${NOW}.${body}`).digest('base64');
  assert.equal(verifySvixSignature({ id: 'm', timestamp: String(NOW), signatures: `v1,AAAA v1,${good}`, body, secret: SECRET, nowSeconds: NOW }), true);
  assert.equal(verifySvixSignature({ id: 'm', timestamp: String(NOW), signatures: `v2,${good}`, body, secret: SECRET, nowSeconds: NOW }), false);
});

// ---- R-07: the deployed (Node) entry point verifies the exact raw bytes ----
import http from 'node:http';
import { Readable } from 'node:stream';
import nodeWebhook, { config as webhookConfig, readRawNodeBody } from '../api/sync/clerk-webhook.js';

function sign(raw, { id = 'msg_raw', timestamp = NOW } = {}) {
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` };
}
// Whitespace, key order and a multi-byte character: any re-serialization changes these bytes.
const RAW = Buffer.from('{ "data" : {"id":"user_2abcDEF",  "note":"caf\u00e9 \u2713"},\n  "type":"user.deleted" }\n', 'utf8');

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = Buffer.from(b || '').toString('utf8'); } };
  return res;
}

test('R-07: a real Node HTTP request is verified over its raw bytes (chunked, split inside a UTF-8 character)', async (t) => {
  const { calls, fetchImpl } = recorder();
  const server = http.createServer((req, res) => nodeWebhook(req, res, { env, fetchImpl, nowSeconds: NOW }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const send = (body, headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/sync/clerk-webhook', headers }, (res) => {
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    const cut = RAW.indexOf(0xc3) + 1; // between the two bytes of "é"
    req.write(body.subarray(0, cut)); setTimeout(() => { req.end(body.subarray(cut)); }, 10);
  });
  const ok = await send(RAW, sign(RAW));
  assert.equal(ok.status, 200, ok.text);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_user_id: 'user_2abcDEF' });
  // The same event re-serialized (what a body parser would hand back) does not verify.
  const reserialized = Buffer.from(JSON.stringify(JSON.parse(RAW.toString('utf8'))));
  assert.notDeepEqual(reserialized, RAW);
  const bad = await send(RAW, sign(reserialized));
  assert.equal(bad.status, 401);
  assert.equal(calls.length, 1);
  const big = Buffer.alloc(300 * 1024, 0x20);
  assert.equal((await send(big, sign(big))).status, 413);
});

test('R-07: a pre-buffered raw body is accepted; a framework-parsed object is refused, never re-serialized', async () => {
  assert.deepEqual(webhookConfig, { api: { bodyParser: false } });
  const { calls, fetchImpl } = recorder();
  const drained = (body) => Object.assign(Readable.from([]), { method: 'POST', url: '/api/sync/clerk-webhook', headers: { host: 'promptlab.tools', ...sign(RAW) }, body });
  const emptyStream = drained(RAW);
  for await (const _ of emptyStream) { /* drain */ }
  const res1 = fakeRes();
  await nodeWebhook(emptyStream, res1, { env, fetchImpl, nowSeconds: NOW });
  assert.equal(res1.statusCode, 200, res1.body);
  const parsed = drained(JSON.parse(RAW.toString('utf8')));
  for await (const _ of parsed) { /* drain */ }
  const res2 = fakeRes();
  await nodeWebhook(parsed, res2, { env, fetchImpl, nowSeconds: NOW });
  assert.equal(res2.statusCode, 400);
  assert.match(res2.body, /Raw request body unavailable/);
  assert.equal(calls.length, 1);
  assert.deepEqual(await readRawNodeBody(Object.assign(Readable.from([Buffer.from('ab'), Buffer.from('c')]), {})), { raw: Buffer.from('abc') });
});
