// One Clerk session-token verifier for every API route that accepts one.
//
// Three implementations used to do this job:
//   - api/_lib/hostedOwner.js verified /api/proxy with jose against the issuer JWKS
//   - verifyClerkJwt() in verifyClerkToken.js verified billing with node:crypto
//     when CLERK_JWKS_URL was set, or when CLERK_SECRET_KEY was missing
//   - @clerk/backend verifyToken() verified billing when a secret key was set
//     and CLERK_JWKS_URL was not
//
// The route-facing results are unchanged. Proxy still fails closed to "not an
// owner". Billing still answers 401 with the same error strings. Issuer,
// audience, azp and clock rules stay on the profile that had them; they are
// not the same profile, and this module does not make them the same.

import {
  compactVerify,
  createRemoteJWKSet,
  decodeJwt,
  decodeProtectedHeader,
  importJWK,
  importSPKI,
  jwtVerify,
} from 'jose';
import { lookupOwnerEntitlement } from './ownerEntitlements.js';
import { DEFAULT_WEB_ORIGIN } from './allowedOrigins.js';
import { readListEnv } from './runtimeSafety.js';

const PROXY_DEFAULT_ISSUER = 'https://clerk.promptlab.tools';
const DEFAULT_AUTHORIZED_PARTIES = ['https://promptlab.tools'];
const MANUAL_JWKS_URL = 'https://api.clerk.com/v1/jwks';
const CLERK_BACKEND_JWKS_URL = 'https://api.clerk.com/v1/jwks';
// Matches SUPPORTED_BAPI_VERSION in @clerk/backend 3.8.4, the SDK this path replaced.
const CLERK_BACKEND_API_VERSION = '2026-05-12';
const SDK_IAT_SKEW_MS = 5 * 1000;
const MANUAL_JWKS_CACHE_MS = 10 * 60 * 1000;
const SDK_JWKS_CACHE_MS = 5 * 60 * 1000;
const MANUAL_JWKS_TIMEOUT_MS = 5000;
const SDK_ALGORITHMS = ['RS256', 'RS384', 'RS512'];

const manualJwksCache = new Map();
let sdkJwksCache = { fetchedAt: 0, keys: [] };
const pemKeyCache = new Map();
let proxySigningKeys = null;

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getHeader(request, name) {
  if (typeof request?.headers?.get === 'function') {
    return request.headers.get(name) || request.headers.get(name.toLowerCase()) || '';
  }
  const headers = request?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || '';
}

function readBillingBearer(request) {
  const header = String(getHeader(request, 'authorization') || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function readProxySessionToken(request) {
  const authorization = request.headers.get('authorization');
  if (authorization) return authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || '';

  // Same-origin proxy fetches already carry Clerk's short-lived session cookie.
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('__session='))?.slice('__session='.length);
  return value ? decodeURIComponent(value) : '';
}

function proxyIssuer() {
  return (process.env.CLERK_JWT_ISSUER || PROXY_DEFAULT_ISSUER).trim().replace(/\/$/, '');
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function billingAuthorizedParties(request) {
  const parties = new Set([
    ...DEFAULT_AUTHORIZED_PARTIES,
    ...splitCsv(readStringEnv('CLERK_AUTHORIZED_PARTIES')),
  ]);
  const requestOrigin = normalizeOrigin(request?.url);
  if (requestOrigin) parties.add(requestOrigin);
  return Array.from(parties);
}

function audienceMatches(claimAudience, expectedAudience) {
  if (!expectedAudience) return true;
  if (Array.isArray(claimAudience)) return claimAudience.includes(expectedAudience);
  return String(claimAudience || '') === expectedAudience;
}

function assertBillingClaims(claims) {
  // A valid signature can still represent unfinished MFA or recovery tasks.
  // Legacy active session tokens omit sts; an explicit status must be active.
  if (claims?.sts !== undefined && claims.sts !== 'active') {
    throw new Error('Clerk session has unfinished authentication tasks.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(claims?.exp)) || Number(claims.exp) <= now) {
    throw new Error('Clerk token is expired.');
  }
  if (Number.isFinite(Number(claims?.nbf)) && Number(claims.nbf) > now) {
    throw new Error('Clerk token is not active yet.');
  }

  const issuer = readStringEnv('CLERK_JWT_ISSUER');
  if (issuer && claims?.iss !== issuer) {
    throw new Error('Clerk token issuer is invalid.');
  }

  const audience = readStringEnv('CLERK_JWT_AUDIENCE');
  if (audience && !audienceMatches(claims?.aud, audience)) {
    throw new Error('Clerk token audience is invalid.');
  }
}

// The SDK allowed iat this far ahead and then the billing claim check did not
// look at iat again. exp and nbf are tightened to zero skew by assertBillingClaims.
function assertSdkIssuedAt(claims) {
  if (typeof claims?.sub !== 'string') {
    throw new Error('Subject claim (sub) is required and must be a string.');
  }
  if (typeof claims?.exp !== 'number') {
    throw new Error('Invalid JWT expiry date claim (exp).');
  }
  const nbf = claims?.nbf;
  if (typeof nbf !== 'undefined' && typeof nbf !== 'number') {
    throw new Error('Invalid JWT not before date claim (nbf).');
  }
  const iat = claims?.iat;
  if (typeof iat === 'undefined') return;
  if (typeof iat !== 'number') {
    throw new Error('Invalid JWT issued at date claim (iat).');
  }
  const issuedAtDate = new Date(0);
  issuedAtDate.setUTCSeconds(iat);
  if (issuedAtDate.getTime() > Date.now() + SDK_IAT_SKEW_MS) {
    throw new Error('JWT issued at date claim (iat) is in the future.');
  }
}

async function fetchJson(url, { headers = {}, timeoutMs = 0 } = {}) {
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response.ok) throw new Error(`JWKS request failed with ${response.status}.`);
    return await response.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function getManualJwks() {
  const jwksUri = readStringEnv('CLERK_JWKS_URL') || MANUAL_JWKS_URL;
  const cached = manualJwksCache.get(jwksUri);
  if (cached && (Date.now() - cached.fetchedAt) < MANUAL_JWKS_CACHE_MS) return cached.keys;
  const payload = await fetchJson(jwksUri, { timeoutMs: MANUAL_JWKS_TIMEOUT_MS });
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  manualJwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  return keys;
}

async function manualVerificationKey(header) {
  if (header?.alg !== 'RS256') throw new Error('Unsupported Clerk token algorithm.');
  if (!header?.kid) throw new Error('Missing Clerk token key id.');
  const keys = await getManualJwks();
  const jwk = keys.find((key) => String(key?.kid || '') === header.kid);
  if (!jwk) throw new Error('Clerk token key id was not found.');
  return importJWK(jwk, 'RS256');
}

async function retryClerkFetch(fetchKeys) {
  let iterations = 0;
  let delayMs = 125;
  while (true) {
    try {
      return await fetchKeys();
    } catch (error) {
      iterations += 1;
      if (iterations >= 5) throw error;
      const waited = delayMs * (1 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, waited));
      delayMs *= 2;
    }
  }
}

async function fetchSdkJwks(secretKey) {
  const payload = await retryClerkFetch(() => fetchJson(CLERK_BACKEND_JWKS_URL, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Clerk-API-Version': CLERK_BACKEND_API_VERSION,
      'Content-Type': 'application/json',
      'User-Agent': '@clerk/backend@3.8.4',
    },
  }));
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  if (!keys.length) throw new Error('The JWKS endpoint did not contain any signing keys.');
  sdkJwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

async function getSdkJwks(secretKey, kid) {
  const fresh = sdkJwksCache.keys.length > 0
    && (Date.now() - sdkJwksCache.fetchedAt) < SDK_JWKS_CACHE_MS;
  const cached = fresh
    ? sdkJwksCache.keys.find((key) => String(key?.kid || '') === kid)
    : null;
  if (cached) return sdkJwksCache.keys;
  // A kid Clerk has not cached yet is fetched again, which is how the SDK
  // picked up a rotated signing key without waiting out the cache.
  return fetchSdkJwks(secretKey);
}

async function sdkVerificationKey(header) {
  if (header?.typ !== undefined && header.typ !== 'JWT') {
    throw new Error('Invalid JWT type.');
  }
  if (!SDK_ALGORITHMS.includes(header?.alg)) {
    throw new Error('Unsupported Clerk token algorithm.');
  }
  const pem = readStringEnv('CLERK_JWT_KEY');
  if (pem) {
    const cacheKey = `${header.alg}:${pem}`;
    if (!pemKeyCache.has(cacheKey)) pemKeyCache.set(cacheKey, importSPKI(pem, header.alg));
    return pemKeyCache.get(cacheKey);
  }
  const secretKey = readStringEnv('CLERK_SECRET_KEY');
  const kid = String(header?.kid || '');
  const keys = await getSdkJwks(secretKey, kid);
  const jwk = keys.find((key) => String(key?.kid || '') === kid);
  if (!jwk) throw new Error('Clerk token key id was not found.');
  return importJWK(jwk, header.alg);
}

function usesManualBillingKeys() {
  return Boolean(readStringEnv('CLERK_JWKS_URL') || !readStringEnv('CLERK_SECRET_KEY'));
}

async function verifyBillingSessionToken(token, request) {
  const header = decodeProtectedHeader(token);
  const manual = usesManualBillingKeys();
  const key = manual
    ? await manualVerificationKey(header)
    : await sdkVerificationKey(header);
  await compactVerify(token, key);
  const claims = decodeJwt(token);
  if (!manual) assertSdkIssuedAt(claims);
  assertBillingClaims(claims);
  if (claims.azp && !billingAuthorizedParties(request).includes(claims.azp)) {
    throw new Error('Clerk token authorized party is invalid.');
  }
  return claims;
}

function proxyKeyResolver(issuer) {
  if (!proxySigningKeys || proxySigningKeys.issuer !== issuer) {
    proxySigningKeys = {
      issuer,
      resolve: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        timeoutDuration: 3000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1000,
      }),
    };
  }
  return proxySigningKeys.resolve;
}

async function verifyProxySessionToken(token, issuer) {
  const { payload } = await jwtVerify(token, proxyKeyResolver(issuer), {
    algorithms: ['RS256'],
    issuer,
    requiredClaims: ['sub', 'sid', 'exp', 'iat', 'nbf', 'azp'],
    ...(process.env.CLERK_JWT_AUDIENCE ? { audience: process.env.CLERK_JWT_AUDIENCE } : {}),
  });
  return payload;
}

export async function verifyClerkSession(request, profile) {
  if (profile === 'proxy') return isHostedOwner(request);
  const token = readBillingBearer(request);
  if (!token) {
    const error = new Error('Missing Clerk authorization.');
    error.code = 'missing-token';
    throw error;
  }
  return verifyBillingSessionToken(token, request);
}

export async function isHostedOwner(request) {
  try {
    const token = readProxySessionToken(request);
    if (!token || token.length > 16_384) return false;
    const candidate = decodeJwt(token);
    const issuer = proxyIssuer();
    // Unverified claims only reject candidates; privilege requires verification below.
    if (candidate.iss !== issuer || !candidate.sid
      || !lookupOwnerEntitlement({ clerkUserId: candidate.sub })) return false;

    const payload = await verifyProxySessionToken(token, issuer);
    const authorizedParties = [
      DEFAULT_WEB_ORIGIN,
      ...readListEnv('CLERK_AUTHORIZED_PARTIES', []),
    ];
    return (payload.sts === undefined || payload.sts === 'active')
      && authorizedParties.includes(payload.azp)
      && Boolean(lookupOwnerEntitlement({ clerkUserId: payload.sub }));
  } catch {
    // Missing, expired or unverifiable sessions retain ordinary usage protection.
    return false;
  }
}
