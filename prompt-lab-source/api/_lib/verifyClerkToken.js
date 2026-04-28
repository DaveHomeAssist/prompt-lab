import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

const DEFAULT_CLERK_JWKS_URL = 'https://api.clerk.com/v1/jwks';
const VERIFY_JWT = promisify(jwt.verify);
const jwksClients = new Map();

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

function getBearerToken(request) {
  const header = String(getHeader(request, 'authorization') || '').trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

function getJwksClient() {
  const jwksUri = readStringEnv('CLERK_JWKS_URL') || DEFAULT_CLERK_JWKS_URL;
  if (!jwksClients.has(jwksUri)) {
    jwksClients.set(jwksUri, jwksRsa({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 1000,
      rateLimit: true,
      jwksRequestsPerMinute: 10,
      timeout: 5000,
    }));
  }
  return jwksClients.get(jwksUri);
}

function getSigningKey(header, callback) {
  if (header?.alg !== 'RS256') {
    callback(new Error('Unsupported Clerk token algorithm.'));
    return;
  }
  if (!header?.kid) {
    callback(new Error('Missing Clerk token key id.'));
    return;
  }
  getJwksClient().getSigningKey(header.kid)
    .then((key) => callback(null, key.getPublicKey()))
    .catch((error) => callback(error));
}

function extractEmailFromClaims(claims = {}) {
  const candidates = [
    claims.email,
    claims.email_address,
    claims.primary_email_address,
    claims?.public_metadata?.email,
  ];
  for (const value of candidates) {
    const email = String(value || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
  }
  return '';
}

async function fetchClerkEmail(clerkUserId) {
  const secretKey = readStringEnv('CLERK_SECRET_KEY');
  if (!secretKey || !clerkUserId) return '';

  const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) return '';

  const payload = await response.json().catch(() => null);
  const primaryEmailId = String(payload?.primary_email_address_id || '');
  const addresses = Array.isArray(payload?.email_addresses) ? payload.email_addresses : [];
  const primary = addresses.find((entry) => String(entry?.id || '') === primaryEmailId) || addresses[0];
  return extractEmailFromClaims({ email: primary?.email_address });
}

export class ClerkAuthError extends Error {
  constructor(message = 'A valid Clerk session is required.') {
    super(message);
    this.name = 'ClerkAuthError';
    this.status = 401;
  }
}

export async function verifyClerkRequest(request) {
  const token = getBearerToken(request);
  if (!token) {
    throw new ClerkAuthError('Missing Clerk authorization.');
  }

  let claims;
  try {
    claims = await VERIFY_JWT(token, getSigningKey, {
      algorithms: ['RS256'],
      ...(readStringEnv('CLERK_JWT_ISSUER') ? { issuer: readStringEnv('CLERK_JWT_ISSUER') } : {}),
      ...(readStringEnv('CLERK_JWT_AUDIENCE') ? { audience: readStringEnv('CLERK_JWT_AUDIENCE') } : {}),
    });
  } catch {
    throw new ClerkAuthError('Invalid or expired Clerk authorization.');
  }

  const clerkUserId = String(claims?.sub || '').trim();
  if (!clerkUserId) {
    throw new ClerkAuthError('Clerk authorization is missing a user id.');
  }

  const clerkEmail = extractEmailFromClaims(claims) || await fetchClerkEmail(clerkUserId);
  if (!clerkEmail) {
    throw new ClerkAuthError('Clerk authorization is missing a verified email.');
  }

  return {
    clerkUserId,
    clerkEmail,
    clerkClaims: claims,
  };
}

export async function requireAuth(req, res, next) {
  try {
    const identity = await verifyClerkRequest(req);
    Object.assign(req, identity);
    if (typeof next === 'function') return next();
    return identity;
  } catch (error) {
    const status = error instanceof ClerkAuthError ? error.status : 401;
    const body = { error: error.message || 'A valid Clerk session is required.' };
    if (res && typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(status).json(body);
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
