import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, desktopTokenHandler, RATE_LIMITS } from '../api/sync/desktop-token.js';

const CLIENT_ID = 'desktop_client_placeholder';
const env = { PL_ACCOUNT_SYNC_DESKTOP: 'on', CLERK_SECRET_KEY: 'clerk-secret-placeholder', PL_DESKTOP_OAUTH_CLIENT_ID: CLIENT_ID };
const req = (headers = {}, method = 'POST') => new Request('https://promptlab.tools/api/sync/desktop-token', { method, headers: { Origin: 'tauri://localhost', 'x-forwarded-for': '203.0.113.7', ...headers } });
const freshLimiter = () => createRateLimiter({ env: {} });
const verifiedToken = (extra = {}) => ({ object: 'clerk_idp_oauth_access_token', client_id: CLIENT_ID, subject: 'user_2Desk', scopes: ['openid', 'profile', 'email', 'offline_access'], revoked: false, expired: false, expiration: null, ...extra });

function fakeClerk({ verify = verifiedToken(), verifyStatus = 200, ticketOk = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth_applications/access_tokens/verify')) return { ok: verifyStatus < 300, status: verifyStatus, json: async () => verify };
    if (url.endsWith('/sign_in_tokens')) return { ok: ticketOk, status: ticketOk ? 200 : 500, json: async () => ({ token: 'ticket_abc' }) };
    throw new Error(`unexpected ${url}`);
  };
  return { calls, fetchImpl };
}

test('valid desktop OAuth token (right client_id and scopes) -> one-time ticket for the same Clerk user', async () => {
  const { calls, fetchImpl } = fakeClerk();
  const response = await desktopTokenHandler(req({ Authorization: 'Bearer oauth-access' }), { env, fetchImpl, rateLimit: freshLimiter() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ticket: 'ticket_abc' });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost');
  assert.equal(calls[0].url, 'https://api.clerk.com/v1/oauth_applications/access_tokens/verify');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer clerk-secret-placeholder');
  assert.deepEqual(JSON.parse(calls[0].init.body), { access_token: 'oauth-access' });
  assert.deepEqual(JSON.parse(calls[1].init.body), { user_id: 'user_2Desk', expires_in_seconds: 300 });
});

test('R-02: off (503) unless PL_ACCOUNT_SYNC_DESKTOP, CLERK_SECRET_KEY and PL_DESKTOP_OAUTH_CLIENT_ID are all set', async () => {
  const { calls, fetchImpl } = fakeClerk();
  for (const partial of [{}, { ...env, PL_ACCOUNT_SYNC_DESKTOP: 'off' }, { ...env, CLERK_SECRET_KEY: '' }, { ...env, PL_DESKTOP_OAUTH_CLIENT_ID: '' }, { ...env, PL_DESKTOP_OAUTH_CLIENT_ID: '  ' }]) {
    assert.equal((await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env: partial, fetchImpl, rateLimit: freshLimiter() })).status, 503);
  }
  assert.equal(calls.length, 0);
});

test('R-02: tokens from another OAuth app, missing scopes, revoked or expired tokens get no ticket', async () => {
  const cases = [
    verifiedToken({ client_id: 'some_other_oauth_app' }),
    verifiedToken({ client_id: undefined }),
    verifiedToken({ scopes: ['openid'] }),
    verifiedToken({ scopes: [] }),
    verifiedToken({ revoked: true }),
    verifiedToken({ expired: true }),
    verifiedToken({ expiration: Math.floor(Date.now() / 1000) - 10 }),
    verifiedToken({ subject: 'not-a-clerk-user' }),
  ];
  for (const verify of cases) {
    const { calls, fetchImpl } = fakeClerk({ verify });
    const response = await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env, fetchImpl, rateLimit: freshLimiter() });
    assert.equal(response.status, 401, JSON.stringify(verify));
    assert.ok(!calls.some((call) => call.url.endsWith('/sign_in_tokens')), 'no ticket minted');
  }
  const custom = fakeClerk({ verify: verifiedToken({ scopes: ['profile', 'email'] }) });
  const needsMore = await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env: { ...env, PL_DESKTOP_OAUTH_SCOPES: 'profile email sync' }, fetchImpl: custom.fetchImpl, rateLimit: freshLimiter() });
  assert.equal(needsMore.status, 401);
});

test('R-02: rate limited per IP and per user (429 with Retry-After)', async () => {
  const limiter = freshLimiter();
  const { fetchImpl } = fakeClerk();
  const statuses = [];
  for (let i = 0; i < RATE_LIMITS.user.limit + 1; i += 1) {
    statuses.push((await desktopTokenHandler(req({ Authorization: 'Bearer x', 'x-forwarded-for': `198.51.100.${i}` }), { env, fetchImpl, rateLimit: limiter })).status);
  }
  assert.deepEqual(statuses, [...Array(RATE_LIMITS.user.limit).fill(200), 429], 'per-user cap across IPs');
  const ipLimiter = freshLimiter();
  const bad = fakeClerk({ verifyStatus: 401 });
  const ipStatuses = [];
  for (let i = 0; i < RATE_LIMITS.ip.limit + 1; i += 1) ipStatuses.push((await desktopTokenHandler(req({ Authorization: `Bearer guess-${i}` }), { env, fetchImpl: bad.fetchImpl, rateLimit: ipLimiter })).status);
  assert.deepEqual(ipStatuses, [...Array(RATE_LIMITS.ip.limit).fill(401), 429], 'per-IP cap on token guessing');
  const limited = await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env, fetchImpl, rateLimit: ipLimiter });
  assert.equal(limited.headers.get('Retry-After'), String(RATE_LIMITS.ip.windowSeconds));
  assert.equal(bad.calls.length, RATE_LIMITS.ip.limit, 'no Clerk call once limited');
});

test('R-02: the shared limiter uses KV REST when configured and falls back to memory on errors', async () => {
  const seen = [];
  const kv = createRateLimiter({ env: { KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'kv-placeholder' }, fetchImpl: async (url) => { seen.push(url); return { json: async () => ({ result: 3 }) }; } });
  assert.deepEqual(await kv('ip:1', { limit: 2, windowSeconds: 60 }), { limited: true, retryAfterSeconds: 60 });
  assert.match(seen[0], /^https:\/\/kv\.example\.test\/incr\/promptlab%3Adesktop-token%3Aip%3A1%3A\d+$/);
  const broken = createRateLimiter({ env: { KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 't' }, fetchImpl: async () => { throw new Error('down'); } });
  assert.equal((await broken('ip:1', { limit: 1, windowSeconds: 60 })).limited, false);
  assert.equal((await broken('ip:1', { limit: 1, windowSeconds: 60 })).limited, true);
});

test('other origins refused, missing tokens refused, Clerk outage is retryable, secret never echoed', async () => {
  const { calls, fetchImpl } = fakeClerk();
  assert.equal((await desktopTokenHandler(req({ Authorization: 'Bearer x', Origin: 'https://evil.example.com' }), { env, fetchImpl, rateLimit: freshLimiter() })).status, 403);
  assert.equal((await desktopTokenHandler(req(), { env, fetchImpl, rateLimit: freshLimiter() })).status, 401);
  assert.equal(calls.length, 0);
  const down = fakeClerk({ verifyStatus: 503 });
  const response = await desktopTokenHandler(req({ Authorization: 'Bearer x' }), { env, fetchImpl: down.fetchImpl, rateLimit: freshLimiter() });
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /clerk-secret-placeholder/);
});
