// Extension only, and only in builds with VITE_PL_ACCOUNT_SYNC=on (injected
// into panel.html by scripts/account-sync-build.mjs). Uses Clerk's Chrome
// extension SDK with Sync Host: the user signs in on https://promptlab.tools
// and the extension reads that session through the `cookies` permission.
//
// Side panel: Clerk documents Sync Host as not fully supported in side panels.
// We (1) enable the SDK's cookie listener, which reloads the user or the page
// when the promptlab.tools session cookie changes, (2) re-check the session
// whenever the panel becomes visible, and (3) if there is still no session,
// publish needsReopen so the UI can say "close and reopen the panel".
import { createClerkClient } from '@clerk/chrome-extension/client';
import { publishAccountAuth } from './lib/sync/accountAuthBridge.js';

const SYNC_HOST = 'https://clerk.promptlab.tools';
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

async function start() {
  if (!publishableKey || typeof chrome === 'undefined' || !chrome.runtime?.id) return;
  const clerk = createClerkClient({ publishableKey, syncHost: SYNC_HOST, __experimental_syncHostListener: true });
  const publish = () => publishAccountAuth({
    surface: 'extension',
    userId: clerk.user?.id || '',
    getToken: clerk.session ? () => clerk.session.getToken() : null,
    needsReopen: !clerk.user,
  });
  try {
    await clerk.load();
  } catch {
    publishAccountAuth({ surface: 'extension', userId: '', getToken: null, needsReopen: true });
    return;
  }
  clerk.addListener(publish);
  publish();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    try { await clerk.load(); } catch { /* offline: keep last state */ }
    publish();
  });
}

start();
