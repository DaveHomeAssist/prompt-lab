// Account sync is off unless a build sets VITE_PL_ACCOUNT_SYNC=on and supplies
// the Supabase project URL and publishable key. With the flag off nothing in
// lib/sync runs, so existing users keep today's device-only storage.
const env = (() => {
  try { return import.meta.env || {}; } catch { return {}; }
})();

export function readSyncConfig(source = env) {
  const enabled = String(source.VITE_PL_ACCOUNT_SYNC || '').toLowerCase() === 'on';
  const url = String(source.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = String(source.VITE_SUPABASE_PUBLISHABLE_KEY || '');
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(url);
  return { enabled: enabled && valid && Boolean(publishableKey), url, publishableKey };
}

export const isAccountSyncEnabled = (source) => readSyncConfig(source).enabled;
