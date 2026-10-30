// Desktop account-sync bridge: Clerk OAuth access token (from the desktop
// app's PKCE sign-in) -> one-time Clerk sign-in ticket for that same user.
// Off unless PL_ACCOUNT_SYNC_DESKTOP=on and CLERK_SECRET_KEY is set.
// CORS: only the Tauri webview origins.
import { createNodeCompatibleHandler } from '../_lib/nodeHandler.js';

const CLERK_ORIGIN = 'https://clerk.promptlab.tools';
const CLERK_API = 'https://api.clerk.com/v1';
const TAURI_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);
const USER_ID = /^user_[A-Za-z0-9]{1,64}$/;

function respond(request, body, status = 200) {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (TAURI_ORIGINS.has(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization' });
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

export async function desktopTokenHandler(request, { env = process.env, fetchImpl = fetch } = {}) {
  const origin = request.headers.get('Origin');
  if (origin && !TAURI_ORIGINS.has(origin)) return respond(request, { error: 'Origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return respond(request, null, 204);
  if (request.method !== 'POST') return respond(request, { error: 'Method not allowed.' }, 405);
  if (env.PL_ACCOUNT_SYNC_DESKTOP !== 'on' || !env.CLERK_SECRET_KEY) return respond(request, { error: 'Desktop sync sign-in is not enabled.' }, 503);
  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!accessToken || accessToken.length > 4096) return respond(request, { error: 'Sign in again.' }, 401);

  let user;
  try {
    const info = await fetchImpl(`${CLERK_ORIGIN}/oauth/userinfo`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!info.ok) return respond(request, { error: 'Sign in again.' }, 401);
    user = await info.json();
  } catch {
    return respond(request, { error: 'Sign-in service unavailable.', retryable: true }, 502);
  }
  const userId = String(user?.sub || user?.user_id || '');
  if (!USER_ID.test(userId)) return respond(request, { error: 'Sign in again.' }, 401);

  try {
    const created = await fetchImpl(`${CLERK_API}/sign_in_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    if (!created.ok) return respond(request, { error: 'Could not start a sync session.', retryable: true }, 502);
    const { token } = await created.json();
    if (!token) return respond(request, { error: 'Could not start a sync session.', retryable: true }, 502);
    return respond(request, { ticket: token });
  } catch {
    return respond(request, { error: 'Sign-in service unavailable.', retryable: true }, 502);
  }
}

export default createNodeCompatibleHandler((request) => desktopTokenHandler(request));
