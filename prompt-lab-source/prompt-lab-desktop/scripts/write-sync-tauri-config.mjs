// Writes src-tauri/tauri.sync.conf.json for `npm run tauri:build:sync`.
// Refuses to run unless VITE_PL_ACCOUNT_SYNC=on and VITE_SUPABASE_URL is a
// Supabase project URL; normal desktop builds never read this file.
import { readFileSync, writeFileSync } from 'node:fs';
import { desktopSyncOverlay } from '../../scripts/account-sync-build.mjs';

const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const overlay = desktopSyncOverlay(base);
if (!overlay) {
  console.error('Account sync is off: set VITE_PL_ACCOUNT_SYNC=on and VITE_SUPABASE_URL=https://<ref>.supabase.co');
  process.exit(1);
}
writeFileSync(new URL('../src-tauri/tauri.sync.conf.json', import.meta.url), `${JSON.stringify(overlay, null, 2)}\n`);
console.log('Wrote src-tauri/tauri.sync.conf.json');
