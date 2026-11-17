// SDK remote-JWKS mode: CLERK_SECRET_KEY is set and CLERK_JWT_KEY is not, so
// verification fetches https://api.clerk.com/v1/jwks. These cases mock fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const verifierHref = pathToFileURL(path.join(sourceDir, 'api/_lib/clerkJwtVerifier.js')).href;
const JWKS_URL = 'https://api.clerk.com/v1/jwks';
const ISSUER = 'https://clerk.remote-jwks.example.test';
const WEB_ORIGIN = 'https://promptlab.tools';
const SECRET = 'sk_test_clerk_remote';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const kid = 'remote-jwks-key';
const signingJwk = { ...publicJwk, kid, alg: 'RS256', use: 'sig' };

const ENV_KEYS = [
  'CLERK_SECRET_KEY',
  'CLERK_JWKS_URL',
  'CLERK_JWT_KEY',
  'CLERK_JWT_ISSUER',
  'CLERK_JWT_AUDIENCE',
  'CLERK_AUTHORIZED_PARTIES',
];
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (typeof ORIGINAL_ENV[key] === 'undefined') delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
  globalThis.fetch = ORIGINAL_FETCH;
}

function useRemoteJwksEnv() {
  process.env.CLERK_SECRET_KEY = SECRET;
  process.env.CLERK_JWT_ISSUER = ISSUER;
  delete process.env.CLERK_JWKS_URL;
  delete process.env.CLERK_JWT_KEY;
  delete process.env.CLERK_JWT_AUDIENCE;
  delete process.env.CLERK_AUTHORIZED_PARTIES;
}

function signToken(tokenKid, claims = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: tokenKid })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_remote',
    iss: ISSUER,
    azp: WEB_ORIGIN,
    iat: now - 1,
    nbf: now - 1,
    exp: now + 300,
    ...claims,
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function billingRequest(token) {
  return new Request('https://promptlab.tools/api/billing/license', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function loadVerifier() {
  return import(`${verifierHref}?remote=${Date.now()}-${Math.random()}`);
}

test.describe('SDK remote JWKS', { concurrency: false }, () => {
  test.afterEach(() => {
    restoreEnv();
  });

  test('accepts a token whose kid is in the fetched JWKS', async () => {
    useRemoteJwksEnv();
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      assert.equal(String(url), JWKS_URL);
      return Response.json({ keys: [signingJwk] });
    };
    const { verifyClerkSession } = await loadVerifier();
    const claims = await verifyClerkSession(billingRequest(signToken(kid)), 'billing');
    assert.equal(claims.sub, 'user_remote');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers['User-Agent'], 'prompt-lab-api');
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
    assert.equal(calls[0].init.headers['Clerk-API-Version'], '2026-05-12');
    assert.ok(calls[0].init.signal instanceof AbortSignal);
    assert.equal(calls[0].init.headers['User-Agent'].includes('@clerk/backend'), false);

    const again = await verifyClerkSession(billingRequest(signToken(kid)), 'billing');
    assert.equal(again.sub, 'user_remote');
    assert.equal(calls.length, 1);
  });

  test('does not fetch again for an unknown kid inside the cooldown', async () => {
    useRemoteJwksEnv();
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json({ keys: [{ ...signingJwk, kid: 'some-other-key' }] });
    };
    const { verifyClerkSession } = await loadVerifier();
    const token = signToken('missing-kid');
    await assert.rejects(
      () => verifyClerkSession(billingRequest(token), 'billing'),
      /Clerk token key id was not found/,
    );
    assert.equal(calls.length, 1);
    await assert.rejects(
      () => verifyClerkSession(billingRequest(token), 'billing'),
      /Clerk token key id was not found/,
    );
    assert.equal(calls.length, 1);
  });

  test('aborts a hung JWKS fetch at 5 seconds and fails closed', async () => {
    useRemoteJwksEnv();
    const calls = [];
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      calls.push(String(url));
      const timer = setTimeout(() => reject(new Error('JWKS fetch was not aborted')), 8000);
      init.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal.reason);
      });
    });
    const { verifyClerkSession } = await loadVerifier();
    const started = Date.now();
    await assert.rejects(
      () => verifyClerkSession(billingRequest(signToken(kid)), 'billing'),
      (error) => error?.name === 'AbortError',
    );
    const elapsed = Date.now() - started;
    assert.equal(calls.length, 1);
    assert.ok(elapsed >= 4500 && elapsed < 7500, `elapsed ${elapsed}ms`);
    await assert.rejects(
      () => verifyClerkSession(billingRequest(signToken(kid)), 'billing'),
      /Clerk token key id was not found/,
    );
    assert.equal(calls.length, 1);
  });

  test('retries an HTTP 5xx once, then fails closed without another fetch', async () => {
    useRemoteJwksEnv();
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), userAgent: init.headers['User-Agent'] });
      return new Response('unavailable', { status: 503 });
    };
    const { verifyClerkSession } = await loadVerifier();
    await assert.rejects(
      () => verifyClerkSession(billingRequest(signToken(kid)), 'billing'),
      /JWKS request failed with 503/,
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.userAgent), ['prompt-lab-api', 'prompt-lab-api']);
    await assert.rejects(
      () => verifyClerkSession(billingRequest(signToken(kid)), 'billing'),
      /Clerk token key id was not found/,
    );
    assert.equal(calls.length, 2);
  });
});
