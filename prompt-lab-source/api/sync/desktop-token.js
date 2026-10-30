// Desktop account-sync bridge: Clerk OAuth access token (from the desktop
// app's PKCE sign-in) -> one-time Clerk sign-in ticket for that same user.
//
// Off (503) unless all of these server env vars are set:
//   PL_ACCOUNT_SYNC_DESKTOP=on
//   CLERK_SECRET_KEY              (Backend API key; Sensitive, never VITE_)
//   PL_DESKTOP_OAUTH_CLIENT_ID    (client_id of the Prompt Lab Desktop OAuth app)
// Optional:
//   PL_DESKTOP_OAUTH_SCOPES       (space-separated scopes the token must carry;
//                                  default "profile email")
//   KV_REST_API_URL/KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_*) for a shared
//                                  rate limit; otherwise per-instance memory.
//
// The token is checked with Clerk's Backend API ("verify OAuth access token"),
// which returns the token's client_id, subject, scopes and revoked/expired
// state. A token minted for any other OAuth app on the Clerk instance (a
// different client_id) is refused, so it cannot be traded for a session.
// CORS: only the Tauri webview origins.
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';

const CLERK_API = 'https://api.clerk.com/v1';
const TAURI_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
const USER_ID = /^user_[A-Za-z0-9]{1,64}$/;
const DEFAULT_SCOPES = 'profile email';
export const RATE_LIMITS = Object.freeze({
  ip: { limit: 10, windowSeconds: 60 },     // per client IP
  user: { limit: 5, windowSeconds: 600 },   // tickets per Clerk user
});

function respond(request, body, status = 200, extra = {}) {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...extra };
  if (TAURI_ORIGINS.has(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization' });
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

/**
 * Fixed-window counter. Upstash/Vercel KV REST when configured (shared across
 * instances), otherwise an in-memory map (per instance, best effort).
 */
export function createRateLimiter({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const memory = new Map();
  const redisUrl = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
  const redisToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || '';
  return async function hit(key, { limit, windowSeconds }) {
    const bucket = Math.floor(now() / 1000 / windowSeconds);
    const name = `promptlab:desktop-token:${key}:${bucket}`;
    let count;
    if (redisUrl && redisToken) {
      try {
        const response = await fetchImpl(`${redisUrl}/incr/${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${redisToken}` } });
        count = Number((await response.json())?.result);
        if (count === 1) await fetchImpl(`${redisUrl}/expire/${encodeURIComponent(name)}/${windowSeconds * 2}`, { headers: { Authorization: `Bearer ${redisToken}` } });
      } catch { count = NaN; }
    }
    if (!Number.isFinite(count)) {
      for (const [k, v] of memory) if (Math.floor(now() / 1000 / v.windowSeconds) !== v.bucket) memory.delete(k);
      const entry = memory.get(name) || { bucket, windowSeconds, count: 0 };
      entry.count += 1;
      memory.set(name, entry);
      count = entry.count;
    }
    return { limited: count > limit, retryAfterSeconds: windowSeconds };
  };
}

const defaultLimiter = createRateLimiter();

function clientIp(request) {
  return String(request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown').slice(0, 64);
}

export async function desktopTokenHandler(request, { env = process.env, fetchImpl = fetch, rateLimit = defaultLimiter } = {}) {
  const origin = request.headers.get('Origin');
  if (origin && !TAURI_ORIGINS.has(origin)) return respond(request, { error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return respond(request, null, 204);
  if (request.method !== 'POST') return respond(request, { error: 'Method not allowed.' }, 405);
  const expectedClientId = String(env.PL_DESKTOP_OAUTH_CLIENT_ID || '').trim();
  if (env.PL_ACCOUNT_SYNC_DESKTOP !== 'on' || !env.CLERK_SECRET_KEY || !expectedClientId) {
    return respond(request, { error: 'Desktop sync sign-in is not enabled.' }, 503);
  }
  const requiredScopes = String(env.PL_DESKTOP_OAUTH_SCOPES || DEFAULT_SCOPES).split(/\s+/).filter(Boolean);

  const ipHit = await rateLimit(`ip:${clientIp(request)}`, RATE_LIMITS.ip);
  if (ipHit.limited) return respond(request, { error: 'Too many sign-in attempts. Try again shortly.' }, 429, { 'Retry-After': String(ipHit.retryAfterSeconds) });

  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!accessToken || accessToken.length > 4096) return respond(request, { error: 'Sign in again.' }, 401);

  let token;
  try {
    const verified = await fetchImpl(`${CLERK_API}/oauth_applications/access_tokens/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken }),
    });
    if (verified.status >= 500) return respond(request, { error: 'Sign-in service unavailable.', retryable: true }, 502);
    if (!verified.ok) return respond(request, { error: 'Sign in again.' }, 401);
    token = await verified.json();
  } catch {
    return respond(request, { error: 'Sign-in service unavailable.', retryable: true }, 502);
  }
  const userId = String(token?.subject || '');
  const scopes = Array.isArray(token?.scopes) ? token.scopes : String(token?.scopes || '').split(/\s+/);
  const expired = token?.expired === true || (Number.isFinite(token?.expiration) && token.expiration * (token.expiration < 1e12 ? 1000 : 1) <= Date.now());
  if (token?.revoked === true || expired
      || token?.client_id !== expectedClientId
      || !requiredScopes.every((scope) => scopes.includes(scope))
      || !USER_ID.test(userId)) {
    return respond(request, { error: 'Sign in again.' }, 401);
  }

  const userHit = await rateLimit(`user:${userId}`, RATE_LIMITS.user);
  if (userHit.limited) return respond(request, { error: 'Too many sign-in attempts. Try again shortly.' }, 429, { 'Retry-After': String(userHit.retryAfterSeconds) });

  try {
    const created = await fetchImpl(`${CLERK_API}/sign_in_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    if (!created.ok) return respond(request, { error: 'Could not start a sync session.', retryable: true }, 502);
    const { token: ticket } = await created.json();
    if (!ticket) return respond(request, { error: 'Could not start a sync session.', retryable: true }, 502);
    return respond(request, { ticket });
  } catch {
    return respond(request, { error: 'Sign-in service unavailable.', retryable: true }, 502);
  }
}

export default createNodeCompatibleHandler((request) => desktopTokenHandler(request));
