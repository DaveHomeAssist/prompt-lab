import { decodeJwt, verifyJwt } from '@clerk/backend/jwt';
import { lookupOwnerEntitlement } from './ownerEntitlements.js';
import { DEFAULT_WEB_ORIGIN, MOBILE_WEB_ORIGIN } from './allowedOrigins.js';
import { fetchWithTimeout, readListEnv } from './runtimeSafety.js';

const DEFAULT_ISSUER = 'https://clerk.promptlab.tools';
const KEY_CACHE_MS = 10 * 60 * 1000;
const KEY_REFRESH_MS = 30_000;
let cachedKeys = null;

function sessionToken(request) {
  const authorization = request.headers.get('authorization');
  if (authorization) return authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || '';

  // Same-origin proxy fetches already carry Clerk's short-lived session cookie.
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('__session='))?.slice('__session='.length);
  return value ? decodeURIComponent(value) : '';
}

async function signingKey(kid, issuer, signal) {
  const url = `${issuer}/.well-known/jwks.json`;
  const now = Date.now();
  if (!cachedKeys || cachedKeys.url !== url || now >= cachedKeys.expiresAt
    || (!cachedKeys.keys.some((key) => key.kid === kid) && now >= cachedKeys.refreshAfter)) {
    const response = await fetchWithTimeout(url, { signal }, {
      service: 'Clerk signing keys',
      timeoutMs: 3000,
    });
    if (!response.ok) throw new Error('Clerk signing keys unavailable.');
    const payload = await response.json();
    cachedKeys = {
      url,
      keys: Array.isArray(payload?.keys) ? payload.keys : [],
      expiresAt: Date.now() + KEY_CACHE_MS,
      refreshAfter: Date.now() + KEY_REFRESH_MS,
    };
  }
  return cachedKeys.keys.find((key) => key.kid === kid && key.kty === 'RSA');
}

export async function isHostedOwner(request) {
  try {
    const token = sessionToken(request);
    if (!token || token.length > 16_384) return false;
    const { header, payload } = decodeJwt(token);
    const issuer = (process.env.CLERK_JWT_ISSUER || DEFAULT_ISSUER).trim().replace(/\/$/, '');
    // Unverified claims only reject candidates; privilege requires verification below.
    if (header.alg !== 'RS256' || payload.iss !== issuer || !payload.sid
      || !lookupOwnerEntitlement({ clerkUserId: payload.sub })) return false;

    const key = await signingKey(header.kid, issuer, request.signal);
    if (!key) return false;
    const claims = await verifyJwt(token, {
      key,
      authorizedParties: [
        DEFAULT_WEB_ORIGIN,
        MOBILE_WEB_ORIGIN,
        ...readListEnv('CLERK_AUTHORIZED_PARTIES', []),
      ],
      ...(process.env.CLERK_JWT_AUDIENCE ? { audience: process.env.CLERK_JWT_AUDIENCE } : {}),
      clockSkewInMs: 0,
    });
    return Boolean(lookupOwnerEntitlement({ clerkUserId: claims.sub }));
  } catch {
    // Missing, expired or unverifiable sessions retain ordinary usage protection.
    return false;
  }
}
