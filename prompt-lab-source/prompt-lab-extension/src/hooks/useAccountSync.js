// Runs account sync while a user is signed in and the build enables it.
// With VITE_PL_ACCOUNT_SYNC unset (the default) this hook does nothing.
import { useEffect, useRef, useState } from 'react';
import { notifyLocalWrite, onLocalWrite } from '../lib/storage.js';
import { readSyncConfig } from '../lib/sync/syncConfig.js';
import { readAccountAuth, subscribeAccountAuth } from '../lib/sync/accountAuthBridge.js';
import { createSyncEngine } from '../lib/sync/syncEngine.js';
import { createSupabaseTransport } from '../lib/sync/supabaseTransport.js';
import { backoffDelay } from '../lib/sync/syncQueue.js';

const IDLE = { status: 'off', pending: 0 };
const LOCAL_DEBOUNCE_MS = 2000;
// Background poll is slow on purpose (free-tier egress, docs/ACCOUNT_SYNC_DESIGN.md);
// local edits, focus, visibility and coming back online sync right away.
const INTERVAL_MS = 5 * 60 * 1000;

export default function useAccountSync({ clerkUser, clerkGetToken, config = readSyncConfig() }) {
  const [syncState, setSyncState] = useState(IDLE);
  // Web passes Clerk props; the extension and desktop publish through the bridge.
  const [bridged, setBridged] = useState(readAccountAuth);
  useEffect(() => (config.enabled ? subscribeAccountAuth(setBridged) : undefined), [config.enabled]);
  const userId = clerkUser?.id || bridged.userId || '';
  const getToken = clerkUser ? clerkGetToken : bridged.getToken;
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  useEffect(() => {
    if (!config.enabled || !userId || typeof window === 'undefined') { setSyncState(config.enabled && bridged.needsReopen ? { ...IDLE, status: 'signed-out', needsReopen: true } : IDLE); return undefined; }
    const transport = createSupabaseTransport({ url: config.url, publishableKey: config.publishableKey, getToken: () => tokenRef.current?.() });
    let engineWriting = false;
    const engine = createSyncEngine({
      storage: window.localStorage,
      transport,
      userId,
      // Engine writes feed the desktop journal like any other Library write,
      // then the open Library adopts them through its storage-event path.
      notifyWrite: notifyLocalWrite,
    });
    let stopped = false; let timer = 0; let failures = 0;
    const run = async () => {
      if (stopped) return;
      window.clearTimeout(timer);
      const exec = async () => {
        engineWriting = true;
        try { return await engine.syncOnce(); } finally { engineWriting = false; }
      };
      const result = navigator.locks?.request ? await navigator.locks.request('pl-sync', exec) : await exec();
      if (stopped) return;
      for (const key of result.written || []) window.dispatchEvent(new StorageEvent('storage', { key }));
      setSyncState({ status: result.status, pending: result.pending, conflicts: result.conflicts, at: Date.now(), needsReopen: Boolean(bridged.needsReopen) });
      failures = result.status === 'synced' || result.status === 'owner-mismatch' ? 0 : failures + 1;
      // Signed out, another account's data on this device, or over quota:
      // wait for the next local change or sign-in instead of retrying.
      if (!['auth', 'owner-mismatch', 'quota'].includes(result.status)) {
        timer = window.setTimeout(() => { if (document.visibilityState !== 'hidden') run(); else timer = 0; }, failures ? backoffDelay(failures) : INTERVAL_MS);
      }
    };
    let debounce = 0;
    const stopWrites = onLocalWrite((key) => {
      if (engineWriting || !String(key).startsWith('pl2-') || String(key).startsWith('pl2-sync-')) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(run, LOCAL_DEBOUNCE_MS);
    });
    const wake = () => { if (document.visibilityState !== 'hidden') run(); };
    window.addEventListener('focus', wake);
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', wake);
    setSyncState({ status: 'syncing', pending: engine.pendingCount() });
    run();
    return () => {
      stopped = true;
      window.clearTimeout(timer); window.clearTimeout(debounce);
      stopWrites();
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [config.enabled, config.url, config.publishableKey, userId, bridged.needsReopen]);

  return syncState;
}
