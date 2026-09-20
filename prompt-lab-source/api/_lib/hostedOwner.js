import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { lookupOwnerEntitlement } from './ownerEntitlements.js';
import { DEFAULT_WEB_ORIGIN, MOBILE_WEB_ORIGIN } from './allowedOrigins.js';
import { readListEnv } from './runtimeSafety.js';

const DEFAULT_ISSUER = 'https://clerk.promptlab.tools';
let signingKeys = null;

function sessionToken(request) {
  const authorization = request.headers.get('authorization');
  if (authorization) return authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || '';

  // Same-origin proxy fetches already carry Clerk's short-lived session cookie.
  const cookie = request.headers.get('cookie') || '';
  const value = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('__session='))?.slice('__session='.length);
  return value ? decodeURIComponent(value) : '';
}

function getSigningKeys(issuer) {
  if (!signingKeys || signingKeys.issuer !== issuer) {
    signingKeys = {
      issuer,
      resolve: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        timeoutDuration: 3000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1000,
      }),
    };
  }
  return signingKeys.resolve;
}

export async function isHostedOwner(request) {
  try {
    const token = sessionToken(request);
    if (!token || token.length > 16_384) return false;
    const candidate = decodeJwt(token);
    const issuer = (process.env.CLERK_JWT_ISSUER || DEFAULT_ISSUER).trim().replace(/\/$/, '');
    // Unverified claims only reject candidates; privilege requires verification below.
    if (candidate.iss !== issuer || !candidate.sid
      || !lookupOwnerEntitlement({ clerkUserId: candidate.sub })) return false;

    const { payload } = await jwtVerify(token, getSigningKeys(issuer), {
      algorithms: ['RS256'],
      issuer,
      requiredClaims: ['sub', 'sid', 'exp', 'iat', 'nbf', 'azp'],
      ...(process.env.CLERK_JWT_AUDIENCE ? { audience: process.env.CLERK_JWT_AUDIENCE } : {}),
    });
    const authorizedParties = [
      DEFAULT_WEB_ORIGIN,
      MOBILE_WEB_ORIGIN,
      ...readListEnv('CLERK_AUTHORIZED_PARTIES', []),
    ];
    return authorizedParties.includes(payload.azp)
      && Boolean(lookupOwnerEntitlement({ clerkUserId: payload.sub }));
  } catch {
    // Missing, expired or unverifiable sessions retain ordinary usage protection.
    return false;
  }
}
