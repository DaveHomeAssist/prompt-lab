// Desktop (Tauri) sign-in for account sync: OAuth 2.0 authorization code with
// PKCE (S256) in the system browser, redirected to a one-shot 127.0.0.1
// loopback listener (RFC 8252). The refresh token lives only in the OS
// keychain through Tauri commands (src-tauri/src/account_auth.rs), never in
// localStorage; access tokens stay in memory.
//
// Clerk OAuth access tokens are not Clerk session tokens, and Supabase's Clerk
// integration expects session tokens (role "authenticated"). So the access
// token is exchanged at /api/sync/desktop-token for a one-time Clerk sign-in
// ticket, which clerk-js (non-browser mode) turns into a real session. That
// last step is designed but not built yet; see docs/ACCOUNT_SYNC_DESIGN.md.
export const CLERK_ORIGIN = 'https://clerk.promptlab.tools';
export const BRIDGE_URL = 'https://promptlab.tools/api/sync/desktop-token';
export const REFRESH_SECRET = 'clerk_refresh_token';
const SCOPE = 'openid profile email offline_access';

const base64Url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function createPkcePair(cryptoImpl = globalThis.crypto) {
  const verifier = base64Url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = base64Url(cryptoImpl.getRandomValues(new Uint8Array(16)));
  return { verifier, challenge, state };
}

export function loopbackRedirectUri(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port.');
  return `http://127.0.0.1:${port}/callback`;
}

export function buildAuthorizeUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL('/oauth/authorize', CLERK_ORIGIN);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state }).toString();
  return url.toString();
}

/** Parse the loopback callback query. Rejects a state mismatch (CSRF) and provider errors. */
export function parseCallback(query, expectedState) {
  const params = new URLSearchParams(String(query || '').replace(/^\?/, ''));
  if (params.get('error')) throw new Error('Sign-in was cancelled or refused.');
  if (!expectedState || params.get('state') !== expectedState) throw new Error('Sign-in response did not match this request.');
  const code = params.get('code');
  if (!code) throw new Error('Sign-in response had no code.');
  return code;
}

async function tokenRequest(body, fetchImpl) {
  const response = await fetchImpl(`${CLERK_ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  if (!response.ok) throw Object.assign(new Error('Sign-in token request failed.'), { status: response.status });
  const tokens = await response.json();
  if (!tokens?.access_token) throw new Error('Sign-in returned no access token.');
  return tokens;
}

export const exchangeCode = ({ code, verifier, clientId, redirectUri, fetchImpl = fetch }) =>
  tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri }, fetchImpl);

export const refreshTokens = ({ refreshToken, clientId, fetchImpl = fetch }) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, fetchImpl);

/** OS keychain through Tauri. There is deliberately no web-storage fallback. */
export function createKeychain(invoke) {
  if (typeof invoke !== 'function') throw new Error('Desktop keychain is unavailable.');
  return {
    get: (name) => invoke('account_secret_get', { name }),
    set: (name, value) => invoke('account_secret_set', { name, value }),
    delete: (name) => invoke('account_secret_delete', { name }),
  };
}

/**
 * Full browser sign-in. `invoke` is Tauri's core invoke; `openUrl` opens the
 * system browser (shell plugin, scoped to the Clerk authorize URL in sync builds).
 */
export async function signInWithBrowser({ invoke, openUrl, clientId, fetchImpl = fetch, cryptoImpl = globalThis.crypto, timeoutSeconds = 300 }) {
  const keychain = createKeychain(invoke);
  const { verifier, challenge, state } = await createPkcePair(cryptoImpl);
  const port = await invoke('account_oauth_listen');
  const redirectUri = loopbackRedirectUri(port);
  await openUrl(buildAuthorizeUrl({ clientId, redirectUri, challenge, state }));
  const query = await invoke('account_oauth_wait', { timeoutSeconds });
  const code = parseCallback(query, state);
  const tokens = await exchangeCode({ code, verifier, clientId, redirectUri, fetchImpl });
  if (tokens.refresh_token) await keychain.set(REFRESH_SECRET, tokens.refresh_token);
  return { accessToken: tokens.access_token, expiresIn: Number(tokens.expires_in) || 0 };
}

/** Refresh from the keychain on launch; null when the user must sign in again. */
export async function resumeDesktopSession({ invoke, clientId, fetchImpl = fetch }) {
  const keychain = createKeychain(invoke);
  const refreshToken = await keychain.get(REFRESH_SECRET);
  if (!refreshToken) return null;
  try {
    const tokens = await refreshTokens({ refreshToken, clientId, fetchImpl });
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) await keychain.set(REFRESH_SECRET, tokens.refresh_token);
    return { accessToken: tokens.access_token, expiresIn: Number(tokens.expires_in) || 0 };
  } catch (error) {
    if (error?.status === 400 || error?.status === 401) await keychain.delete(REFRESH_SECRET);
    return null;
  }
}

/** Sign out: forget the keychain secret. Local Library data stays on the device. */
export async function signOutDesktop({ invoke }) {
  await createKeychain(invoke).delete(REFRESH_SECRET);
}

/** Exchange an OAuth access token for a one-time Clerk sign-in ticket. */
export async function requestSignInTicket({ accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(BRIDGE_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw Object.assign(new Error('Could not start a sync session.'), { status: response.status });
  const { ticket } = await response.json();
  if (!ticket) throw new Error('Could not start a sync session.');
  return ticket;
}
