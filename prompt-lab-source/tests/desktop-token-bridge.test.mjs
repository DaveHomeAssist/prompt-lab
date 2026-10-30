import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopTokenHandler } from '../api/sync/desktop-token.js';

const env = { PL_ACCOUNT_SYNC_DESKTOP: 'on', CLERK_SECRET_KEY: 'clerk-secret-placeholder' };
const req = (headers = {}, method = 'POST') => new Request('https://promptlab.tools/api/sync/desktop-token', { method, headers: { Origin: 'tauri://localhost', ...headers } });

function fakeClerk({ userinfo = { sub: 'user_2Desk' }, userinfoOk = true, ticketOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/userinfo')) return { ok: userinfoOk, json: async () => userinfo };
    if (url.endsWith('/sign_in_tokens')) return { ok: ticketOk, json: async () => ({ token: 'ticket_abc' }) };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test('valid OAuth access token -> one-time ticket for the same Clerk user', async () => {
  const { calls, fetchImpl } = fakeClerk();
  const response = await desktopTokenHandler(req({ Authorization: 'Bearer oauth-access' }), { env, fetchImpl });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ticket: 'ticket_abc' });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer oauth-access');
  assert.deepEqual(JSON.parse(calls[1].init.body), { user_id: 'user_2Desk', expires_in_seconds: 300 });
});

test('off by default, other origins refused, bad tokens refused, secret never echoed', async () => {
  const { calls, fetchImpl } = fakeClerk();
  assert.equal((await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env: {}, fetchImpl })).status, 503);
  assert.equal((await desktopTokenHandler(req({ Authorization: 'Bearer x', Origin: 'https://evil.example.com' }), { env, fetchImpl })).status, 403);
  assert.equal((await desktopTokenHandler(req(), { env, fetchImpl })).status, 401);
  const rejected = fakeClerk({ userinfoOk: false });
  const response = await desktopTokenHandler(req({ Authorization: 'Bearer stolen' }), { env, fetchImpl: rejected.fetchImpl });
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /clerk-secret-placeholder/);
  const weird = fakeClerk({ userinfo: { sub: 'not-a-clerk-user' } });
  assert.equal((await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env, fetchImpl: weird.fetchImpl })).status, 401);
  assert.equal(calls.length, 0);
});
