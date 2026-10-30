// Surface-neutral hand-off of "who is signed in" to useAccountSync.
// The web app passes Clerk props directly. The extension's Clerk bootstrap
// (src/extensionAccountAuth.js) and the desktop sign-in (desktopAuth.js)
// publish here instead, so App never imports a surface-specific SDK.
const listeners = new Set();
let current = { userId: '', getToken: null, surface: '', needsReopen: false };

export function publishAccountAuth(next) {
  current = { ...current, ...next };
  for (const listener of listeners) {
    try { listener(current); } catch { /* listener errors must not break sign-in */ }
  }
}

export const readAccountAuth = () => current;

export function subscribeAccountAuth(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
