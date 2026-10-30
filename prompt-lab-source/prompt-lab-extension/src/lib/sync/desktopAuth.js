// Desktop (Tauri) sign-in for account sync: OAuth 2.0 authorization code with
// PKCE (S256) in the system browser, redirected to a 127.0.0.1 loopback
// listener (RFC 8252). The whole flow runs in Rust (src-tauri/src/account_auth.rs):
// the PKCE verifier, the authorization code and the refresh token never reach
// the webview, and no command can read the keychain. The webview only gets the
// authorize URL to open and short-lived access tokens, kept in memory.
//
// Clerk OAuth access tokens are not Clerk session tokens, and Supabase's Clerk
// integration expects session tokens (role "authenticated"). So the access
// token is exchanged at /api/sync/desktop-token for a one-time Clerk sign-in
// ticket, which clerk-js (non-browser mode) turns into a real session. That
// last step is designed but not built yet; see docs/ACCOUNT_SYNC_DESIGN.md.
export const BRIDGE_URL = 'https://promptlab.tools/api/sync/desktop-token';

const toSession = (token) => (token?.access_token
  ? { accessToken: token.access_token, expiresIn: Number(token.expires_in) || 0 }
  : null);

function requireInvoke(invoke) {
  if (typeof invoke !== 'function') throw new Error('Desktop sign-in is unavailable.');
  return invoke;
}

/**
 * Full browser sign-in. `invoke` is Tauri's core invoke; `openUrl` opens the
 * system browser (shell plugin, scoped to the Clerk authorize URL in sync builds).
 */
export async function signInWithBrowser({ invoke, openUrl, clientId, timeoutSeconds = 300 }) {
  requireInvoke(invoke);
  const authorizeUrl = await invoke('account_oauth_begin', { clientId });
  await openUrl(authorizeUrl);
  const session = toSession(await invoke('account_oauth_finish', { timeoutSeconds }));
  if (!session) throw new Error('Sign-in returned no access token.');
  return session;
}

/** Fresh access token from the keychain-held refresh token; null = sign in again. */
export async function resumeDesktopSession({ invoke, clientId }) {
  requireInvoke(invoke);
  try {
    return toSession(await invoke('account_access_token', { clientId }));
  } catch {
    return null;
  }
}

/** Sign out: forget the keychain secret. Local Library data stays on the device. */
export async function signOutDesktop({ invoke }) {
  await requireInvoke(invoke)('account_sign_out');
}

/** Exchange an OAuth access token for a one-time Clerk sign-in ticket. */
export async function requestSignInTicket({ accessToken, fetchImpl = fetch }) {
  const response = await fetchImpl(BRIDGE_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw Object.assign(new Error('Could not start a sync session.'), { status: response.status });
  const { ticket } = await response.json();
  if (!ticket) throw new Error('Could not start a sync session.');
  return ticket;
}
