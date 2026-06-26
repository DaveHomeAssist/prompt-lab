import { createPublicKey, createVerify } from 'node:crypto';

const DEFAULT_CLERK_JWKS_URL = 'https://api.clerk.com/v1/jwks';
const DEFAULT_AUTHORIZED_PARTIES = ['https://promptlab.tools'];
const JWKS_CACHE_MS = 10 * 60 * 1000;
const CLERK_PROFILE_CACHE_MS = 5 * 60 * 1000;
const jwksCache = new Map();
const clerkProfileCache = new Map();

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

function base64UrlToBuffer(value) {
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = input.padEnd(input.length + ((4 - (input.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64');
}

function parseBase64UrlJson(value) {
  return JSON.parse(base64UrlToBuffer(value).toString('utf8'));
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

function buildAuthorizedParties(request) {
  const parties = new Set([
    ...DEFAULT_AUTHORIZED_PARTIES,
    ...splitCsv(readStringEnv('CLERK_AUTHORIZED_PARTIES')),
  ]);
  const requestOrigin = normalizeOrigin(request?.url);
  if (requestOrigin) parties.add(requestOrigin);
  return Array.from(parties);
}

async function fetchJson(url, { headers = {}, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`JWKS request failed with ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getJwks() {
  const jwksUri = readStringEnv('CLERK_JWKS_URL') || DEFAULT_CLERK_JWKS_URL;
  const cached = jwksCache.get(jwksUri);
  if (cached && (Date.now() - cached.fetchedAt) < JWKS_CACHE_MS) {
    return cached.keys;
  }
  const payload = await fetchJson(jwksUri);
  const keys = Array.isArray(payload?.keys) ? payload.keys : [];
  jwksCache.set(jwksUri, { keys, fetchedAt: Date.now() });
  return keys;
}

async function getSigningKey(header) {
  if (header?.alg !== 'RS256') {
    throw new Error('Unsupported Clerk token algorithm.');
  }
  if (!header?.kid) {
    throw new Error('Missing Clerk token key id.');
  }
  const keys = await getJwks();
  const jwk = keys.find((key) => String(key?.kid || '') === header.kid);
  if (!jwk) throw new Error('Clerk token key id was not found.');
  return createPublicKey({ key: jwk, format: 'jwk' });
}

function audienceMatches(claimAudience, expectedAudience) {
  if (!expectedAudience) return true;
  if (Array.isArray(claimAudience)) return claimAudience.includes(expectedAudience);
  return String(claimAudience || '') === expectedAudience;
}

function assertValidClaims(claims) {
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

async function verifyClerkJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed Clerk token.');

  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = parseBase64UrlJson(encodedHeader);
  const claims = parseBase64UrlJson(encodedClaims);
  const publicKey = await getSigningKey(header);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedClaims}`);
  verifier.end();
  const valid = verifier.verify(publicKey, base64UrlToBuffer(encodedSignature));
  if (!valid) throw new Error('Invalid Clerk token signature.');
  assertValidClaims(claims);
  return claims;
}

async function verifyClerkToken(token, request) {
  if (readStringEnv('CLERK_JWKS_URL') || !readStringEnv('CLERK_SECRET_KEY')) {
    return verifyClerkJwt(token);
  }

  const { verifyToken } = await import('@clerk/backend');
  return verifyToken(token, {
    secretKey: readStringEnv('CLERK_SECRET_KEY'),
    ...(readStringEnv('CLERK_JWT_KEY') ? { jwtKey: readStringEnv('CLERK_JWT_KEY') } : {}),
    authorizedParties: buildAuthorizedParties(request),
  });
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

function buildClaimsFromClerkProfile(payload) {
  const primaryEmailId = String(payload?.primary_email_address_id || '');
  const addresses = Array.isArray(payload?.email_addresses) ? payload.email_addresses : [];
  const emailValues = addresses
    .map((entry) => String(entry?.email_address || '').trim().toLowerCase())
    .filter(Boolean);
  const primary = addresses.find((entry) => String(entry?.id || '') === primaryEmailId) || addresses[0];
  const primaryEmail = String(primary?.email_address || '').trim().toLowerCase();
  const usernames = [
    payload?.username,
    payload?.external_accounts?.find?.((entry) => entry?.username)?.username,
  ].map((value) => String(value || '').trim()).filter(Boolean);

  return {
    ...(primaryEmail ? {
      email: primaryEmail,
      email_address: primaryEmail,
      primary_email_address: primaryEmail,
    } : {}),
    ...(emailValues.length ? { emails: emailValues, email_addresses: emailValues } : {}),
    ...(usernames.length ? { username: usernames[0], usernames } : {}),
  };
}

async function fetchClerkProfile(clerkUserId) {
  const secretKey = readStringEnv('CLERK_SECRET_KEY');
  if (!secretKey || !clerkUserId) return {};

  const cached = clerkProfileCache.get(clerkUserId);
  if (cached && (Date.now() - cached.fetchedAt) < CLERK_PROFILE_CACHE_MS) {
    return cached.claims;
  }

  try {
    const payload = await fetchJson(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    const claims = buildClaimsFromClerkProfile(payload);
    clerkProfileCache.set(clerkUserId, { claims, fetchedAt: Date.now() });
    return claims;
  } catch {
    return {};
  }
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
    claims = await verifyClerkToken(token, request);
  } catch {
    throw new ClerkAuthError('Invalid or expired Clerk authorization.');
  }

  const clerkUserId = String(claims?.sub || '').trim();
  if (!clerkUserId) {
    throw new ClerkAuthError('Clerk authorization is missing a user id.');
  }

  const profileClaims = await fetchClerkProfile(clerkUserId);
  const clerkClaims = {
    ...profileClaims,
    ...claims,
    emails: [
      ...(Array.isArray(profileClaims.emails) ? profileClaims.emails : []),
      ...(Array.isArray(claims.emails) ? claims.emails : []),
    ],
    email_addresses: [
      ...(Array.isArray(profileClaims.email_addresses) ? profileClaims.email_addresses : []),
      ...(Array.isArray(claims.email_addresses) ? claims.email_addresses : []),
    ],
    usernames: [
      ...(Array.isArray(profileClaims.usernames) ? profileClaims.usernames : []),
      ...(Array.isArray(claims.usernames) ? claims.usernames : []),
    ],
  };
  const clerkEmail = extractEmailFromClaims(clerkClaims);
  return {
    clerkUserId,
    clerkEmail,
    clerkClaims,
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
