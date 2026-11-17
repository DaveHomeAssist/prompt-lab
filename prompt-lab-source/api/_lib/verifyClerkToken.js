import { verifyClerkSession } from './clerkJwtVerifier.js';

const CLERK_PROFILE_CACHE_MS = 5 * 60 * 1000;
const clerkProfileCache = new Map();

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
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
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
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
  const addresses = (Array.isArray(payload?.email_addresses) ? payload.email_addresses : [])
    .filter((entry) => entry?.verification?.status === 'verified');
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
      email_verified: true,
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
  let claims;
  try {
    claims = await verifyClerkSession(request, 'billing');
  } catch (error) {
    if (error?.code === 'missing-token') {
      throw new ClerkAuthError('Missing Clerk authorization.');
    }
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
  // A signed session may include unverified/custom email fields. Never use
  // those to claim an unbound legacy Stripe customer by email. Prefer the
  // current verified backend profile over potentially stale token claims.
  const clerkEmail = extractEmailFromClaims(profileClaims)
    || (claims.email_verified === true ? extractEmailFromClaims({
      email: claims.email,
      email_address: claims.email_address,
      primary_email_address: claims.primary_email_address,
    }) : '');
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
