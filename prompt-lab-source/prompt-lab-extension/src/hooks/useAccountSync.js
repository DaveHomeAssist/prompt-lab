// Runs account sync while a user is signed in and the build enables it.
// With VITE_PL_ACCOUNT_SYNC unset (the default) this hook does nothing.
import { useCallback, useEffect, useRef, useState } from 'react';
import { notifyLocalWrite, onLocalWrite } from '../lib/storage.js';
import { readSyncConfig } from '../lib/sync/syncConfig.js';
import { readAccountAuth, subscribeAccountAuth } from '../lib/sync/accountAuthBridge.js';
import { createSyncEngine } from '../lib/sync/syncEngine.js';
import { createSupabaseTransport } from '../lib/sync/supabaseTransport.js';
import { backoffDelay } from '../lib/sync/syncQueue.js';
import { addUnseenConflicts, clearUnseenConflicts, readRestoredConflictIds, readUnseenConflicts, restoreConflictCopy } from '../lib/sync/syncConflicts.js';

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
  // Which account the current token getter belongs to. A run started for one
  // account must never send another account's token (#277 review).
  const tokenUserRef = useRef(userId);
  tokenUserRef.current = userId;

  const runRef = useRef(null);
  const transportRef = useRef(null);

  useEffect(() => {
    runRef.current = null; transportRef.current = null;
    if (!config.enabled || typeof window === 'undefined') { setSyncState(IDLE); return undefined; }
    // Flag on but nobody signed in on this surface: the UI shows the sign-in prompt.
    if (!userId) { setSyncState({ ...IDLE, status: 'signed-out', needsReopen: Boolean(bridged.needsReopen) }); return undefined; }
    let stopped = false;
    // Bound to this effect's account: after sign-out or an account switch (or
    // cleanup), the in-flight engine gets no token, its requests fail as
    // "auth" and nothing more is read or written under the wrong identity.
    const runUserId = userId;
    const transport = createSupabaseTransport({
      url: config.url,
      publishableKey: config.publishableKey,
      getToken: async () => {
        if (stopped || tokenUserRef.current !== runUserId) return null;
        const token = await tokenRef.current?.();
        return stopped || tokenUserRef.current !== runUserId ? null : token;
      },
    });
    let engineWriting = false;
    const engine = createSyncEngine({
      storage: window.localStorage,
      transport,
      userId,
      // Engine writes feed the desktop journal like any other Library write,
      // then the open Library adopts them through its storage-event path.
      notifyWrite: notifyLocalWrite,
    });
    let timer = 0; let failures = 0;
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
      const unseen = result.conflicts > 0 ? addUnseenConflicts(window.localStorage, runUserId, result.conflicts) : readUnseenConflicts(window.localStorage, runUserId);
      setSyncState({ status: result.status, pending: result.pending, conflicts: result.conflicts, unseenConflicts: unseen, tooLarge: result.tooLarge || 0, error: result.error, at: Date.now(), needsReopen: Boolean(bridged.needsReopen) });
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
    setSyncState({ status: 'syncing', pending: engine.pendingCount(), unseenConflicts: readUnseenConflicts(window.localStorage, runUserId) });
    runRef.current = run;
    transportRef.current = transport;
    run();
    return () => {
      stopped = true;
      runRef.current = null; transportRef.current = null;
      window.clearTimeout(timer); window.clearTimeout(debounce);
      stopWrites();
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [config.enabled, config.url, config.publishableKey, userId, bridged.needsReopen]);

  const syncNow = useCallback(() => { runRef.current?.(); }, []);
  // Conflict copies: the losing side of each conflict, kept by the server.
  const listConflicts = useCallback(async () => {
    const transport = transportRef.current;
    if (!transport) return [];
    const rows = await transport.listConflicts();
    const restored = readRestoredConflictIds(window.localStorage, userId);
    return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, restored: restored.has(String(row.id)) }));
  }, [userId]);
  // Opening the conflict list counts as having seen the copies.
  const markConflictsSeen = useCallback(() => {
    if (!userId) return;
    clearUnseenConflicts(window.localStorage, userId);
    setSyncState((prev) => (prev.unseenConflicts ? { ...prev, unseenConflicts: 0 } : prev));
  }, [userId]);
  // Restoring a copy is a normal local edit; the next sync uploads it.
  const restoreConflict = useCallback((copy) => {
    const result = restoreConflictCopy(window.localStorage, userId, copy, { notifyWrite: notifyLocalWrite });
    for (const key of result.written) window.dispatchEvent(new StorageEvent('storage', { key }));
    return result;
  }, [userId]);

  return {
    ...syncState,
    enabled: config.enabled,
    signedIn: Boolean(userId),
    surface: clerkUser ? 'web' : bridged.surface || '',
    // Extension and desktop sign-out (for example desktopAuth's keychain sign-out),
    // published through the bridge. Web passes Clerk's own sign-out to the panel.
    signOut: !clerkUser && typeof bridged.signOut === 'function' ? bridged.signOut : undefined,
    syncNow,
    listConflicts,
    markConflictsSeen,
    restoreConflict,
  };
}
