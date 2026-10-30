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
