// Account sync engine: capture local changes, pull since a cursor, push the
// outbox, and once a day compare a version manifest. Pure JS over an injected
// Storage and transport, so the same code runs in the web app, the extension
// and the Tauri webview, and in tests against a real Postgres.
// Protocol: docs/ACCOUNT_SYNC_DESIGN.md.
import { createSyncQueue } from './syncQueue.js';
import { hashValue } from './syncHash.js';
import { STRUCTURE_ID, applyRemoteRows, duplicateKey, itemKey, mergeStructure, readLocalItems } from './syncModel.js';
import { LIBRARY_DELETED_BATCH_PREFIX, readLibraryDeletionState } from '../libraryDeletion.js';
import { storageKeys } from '../storage.js';
import { addSnapshotUndoKey, takeLocalSnapshot } from './syncBackup.js';

export const DEVICE_KEY = 'pl2-sync-device-id';
export const OWNER_KEY = 'pl2-sync-owner';
export const stateKey = (userId) => `pl2-sync-state:${userId}`;
export const queueKey = (userId) => `pl2-sync-queue:${userId}`;
const PULL_LIMIT = 500;
const PUSH_BATCH = 100;
const FETCH_BATCH = 500;
const MANIFEST_EVERY_MS = 24 * 60 * 60 * 1000;
const BULK_APPLY_SNAPSHOT = 50;
// Server cap is 256 KiB per item (sync_items_payload_size). Larger prompts
// (for example very long version histories) stay on this device and are
// reported, instead of failing every push that contains them.
export const MAX_ITEM_BYTES = 256 * 1024 - 1024;
const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

export class SyncHttpError extends Error {
  constructor(status, message) { super(message || `Sync request failed (${status})`); this.status = status; }
}

/** Map a transport failure to a user-facing sync status. */
export function statusForError(error) {
  const status = Number(error?.status);
  if (status === 401 || status === 403) return 'auth';
  if (status === 413 || status === 507) return 'quota';
  if (status === 429) return 'throttled';
  if (status === 503) return 'paused';
  if (status >= 400 && status < 500) return 'error';
  return 'offline';
}

export function getDeviceId(storage, makeId = () => crypto.randomUUID()) {
  let id = storage.getItem(DEVICE_KEY);
  if (!id) { id = makeId(); storage.setItem(DEVICE_KEY, id); }
  return id;
}

const emptyState = () => ({ initialized: false, cursor: 0, clock: 0, lastManifestAt: 0, shadow: {}, oversize: {} });
const splitKey = (key) => { const at = key.indexOf(':'); return { kind: key.slice(0, at), item_id: key.slice(at + 1) }; };

export function createSyncEngine({ storage, transport, userId, deviceId = getDeviceId(storage), notifyWrite, now = () => Date.now(), random = Math.random, makeId = () => crypto.randomUUID() }) {
  if (!userId) throw new Error('Account sync needs a signed-in user.');
  const queue = createSyncQueue(storage, queueKey(userId));
  const loadState = () => {
    try { return { ...emptyState(), ...JSON.parse(storage.getItem(stateKey(userId)) || '{}') }; } catch { return emptyState(); }
  };
  let state = loadState();
  const saveState = () => storage.setItem(stateKey(userId), JSON.stringify(state));
  const tick = () => { state.clock += 1; return state.clock; };
  const seen = (lamport) => { state.clock = Math.max(state.clock, Number(lamport) || 0); };

  const enqueue = ({ key, kind, item_id, payload, deleted = false, baseVersion, lamport }) => {
    if (!deleted && byteLength(payload) > MAX_ITEM_BYTES) {
      state.oversize = { ...(state.oversize || {}), [key]: true };
      return;
    }
    if (state.oversize?.[key]) { const { [key]: dropped, ...rest } = state.oversize; state.oversize = rest; }
    const previous = queue.get(key);
    const hash = deleted ? null : hashValue(payload);
    if (previous && previous.hash === hash && previous.deleted === deleted) return;
    queue.put({
      key, kind, item_id, payload: deleted ? null : payload, deleted, hash,
      // Keep the version the first pending edit was based on, so a concurrent
      // remote edit is detected as a conflict instead of being overwritten.
      base_version: previous ? previous.base_version : (baseVersion ?? state.shadow[key]?.version ?? 0),
      lamport: lamport ?? tick(),
      client_updated_at: new Date(now()).toISOString(),
    });
  };

  function captureLocal() {
    const local = readLocalItems(storage);
    for (const [key, item] of local) {
      const shadow = state.shadow[key];
      if (!shadow || shadow.hash !== hashValue(item.payload)) enqueue({ key, ...item });
    }
    for (const [key, shadow] of Object.entries(state.shadow)) {
      if (shadow.hash !== null && !local.has(key) && key.startsWith('prompt:')) {
        enqueue({ key, kind: 'prompt', item_id: key.slice('prompt:'.length), payload: null, deleted: true });
      }
    }
  }

  async function pullAll(fromCursor) {
    const rows = [];
    let cursor = fromCursor;
    for (;;) {
      const page = await transport.pull(cursor, PULL_LIMIT);
      rows.push(...page);
      if (page.length) cursor = Math.max(cursor, ...page.map((row) => Number(row.change_seq)));
      if (page.length < PULL_LIMIT) return { rows, cursor };
    }
  }

  function applyRows(rows) {
    if (!rows.length) return [];
    const result = applyRemoteRows(storage, rows, { notifyWrite });
    for (const row of rows) {
      const key = itemKey(row.kind, row.item_id);
      state.shadow[key] = { version: Number(row.version), hash: result.applied.has(key) ? result.applied.get(key) : null };
    }
    return result.written;
  }

  // Server rows newer than what this device has seen. Rows for items with a
  // pending local edit wait for the push result; a permanently deleted prompt
  // (local deletion marker) is answered with a tombstone, never resurrected.
  function applyServerRows(rows) {
    rows.forEach((row) => seen(row.lamport));
    const fresh = rows.filter((row) => (state.shadow[itemKey(row.kind, row.item_id)]?.version || 0) < Number(row.version));
    const { deletedIds } = readLibraryDeletionState(storage);
    const deferred = new Map();
    const applyNow = [];
    for (const row of fresh) {
      const key = itemKey(row.kind, row.item_id);
      if (row.kind === 'prompt' && !row.deleted && deletedIds.has(row.item_id)) {
        if (!queue.get(key)) enqueue({ key, kind: 'prompt', item_id: row.item_id, payload: null, deleted: true, baseVersion: Number(row.version) });
      } else if (queue.get(key)) deferred.set(key, row);
      else applyNow.push(row);
    }
    if (applyNow.length >= BULK_APPLY_SNAPSHOT) takeLocalSnapshot(storage, userId, { reason: 'bulk-apply', at: now() });
    return { pulled: applyNow.length, written: applyRows(applyNow), deferred };
  }

  async function pullAndApply(fromCursor) {
    const { rows, cursor } = await pullAll(fromCursor);
    const result = applyServerRows(rows);
    state.cursor = Math.max(state.cursor, cursor);
    saveState();
    return result;
  }

  async function fetchRows(keys) {
    const rows = [];
    for (let start = 0; start < keys.length; start += FETCH_BATCH) rows.push(...await transport.fetchItems(keys.slice(start, start + FETCH_BATCH).map(splitKey)));
    return rows;
  }

  // Daily consistency check: versions only, then fetch just the rows that
  // differ. Items the account no longer has (for example after a restore from
  // an older backup) are re-uploaded from this device.
  async function reconcileManifest() {
    const manifest = await transport.manifest();
    const server = new Map(manifest.map((row) => [itemKey(row.kind, row.item_id), row]));
    const behind = [];
    for (const [key, row] of server) {
      const shadow = state.shadow[key];
      if (!shadow || shadow.version < Number(row.version)) behind.push(key);
      else if (shadow.version > Number(row.version)) delete state.shadow[key]; // server went back in time: re-upload ours
    }
    for (const key of Object.keys(state.shadow)) if (!server.has(key)) delete state.shadow[key];
    const result = applyServerRows(await fetchRows(behind));
    state.lastManifestAt = now();
    saveState();
    return result;
  }

  async function pushQueue(deferred = new Map()) {
    const outcome = { pushed: 0, conflicts: 0, written: [] };
    const due = queue.due(now());
    for (let start = 0; start < due.length; start += PUSH_BATCH) {
      const batch = due.slice(start, start + PUSH_BATCH);
      let results;
      try {
        results = await transport.push(deviceId, batch.map(({ kind, item_id, base_version, lamport, payload, deleted, client_updated_at }) => ({ kind, item_id, base_version, lamport, payload, deleted, client_updated_at })));
      } catch (error) {
        queue.fail(batch.map((entry) => entry.key), error?.message, now(), random);
        if (error && typeof error === 'object') error.queueBackedOff = true;
        throw error;
      }
      const lost = [];
      for (const result of results) {
        const key = itemKey(result.kind, result.item_id);
        const sent = batch.find((entry) => entry.key === key);
        if (!sent) continue;
        queue.acknowledge(key, sent.lamport);
        if (result.status === 'conflict_lost') { outcome.conflicts += 1; lost.push({ key, version: Number(result.version) }); continue; }
        if (result.status === 'conflict_won') outcome.conflicts += 1;
        state.shadow[key] = { version: Number(result.version), hash: sent.hash };
        outcome.pushed += 1;
      }
      if (lost.length) {
        // The account kept another device's edit; ours is saved as a conflict copy.
        const known = lost.map(({ key, version }) => (deferred.get(key)?.version >= version ? deferred.get(key) : null));
        const fetched = await fetchRows(lost.filter((item, index) => !known[index]).map((item) => item.key));
        outcome.written.push(...applyRows([...known.filter(Boolean), ...fetched]));
      }
      saveState();
    }
    return outcome;
  }

  async function firstRun() {
    const { rows, cursor } = await pullAll(0);
    rows.forEach((row) => seen(row.lamport));
    const remote = new Map(rows.map((row) => [itemKey(row.kind, row.item_id), row]));
    const local = readLocalItems(storage);
    // Safety net before anything destructive. Without it, keep every local
    // prompt (duplicates are uploaded rather than dropped).
    const snapshot = takeLocalSnapshot(storage, userId, { reason: 'first-sync', at: now() });
    const remoteDuplicates = new Set(rows.filter((row) => row.kind === 'prompt' && !row.deleted && row.payload?.entry).map((row) => duplicateKey(row.payload.entry)));
    const toApply = []; const dropped = [];
    let conflicts = 0;
    for (const [key, item] of local) {
      const row = remote.get(key);
      if (item.kind === 'structure') continue;
      if (!row) {
        if (snapshot && remoteDuplicates.has(duplicateKey(item.payload.entry))) dropped.push(item.item_id);
        else enqueue({ key, ...item, baseVersion: 0 });
        continue;
      }
      if (row.deleted) { toApply.push(row); continue; }
      if (hashValue(row.payload) === hashValue(item.payload)) { state.shadow[key] = { version: Number(row.version), hash: hashValue(item.payload) }; continue; }
      conflicts += 1;
      const localClock = new Date(item.payload.entry?.updatedAt || 0).getTime() || 0;
      const remoteClock = new Date(row.payload?.entry?.updatedAt || 0).getTime() || 0;
      // Both copies survive: the newer one is live, the other a conflict copy.
      if (localClock > remoteClock) enqueue({ key, ...item, baseVersion: 0, lamport: tick() });
      else { toApply.push(row); enqueue({ key, ...item, baseVersion: 0, lamport: 0 }); }
    }
    const { deletedIds } = readLibraryDeletionState(storage);
    for (const [key, row] of remote) {
      if (local.has(key) || row.kind !== 'prompt') continue;
      if (!row.deleted && deletedIds.has(row.item_id)) enqueue({ key, kind: 'prompt', item_id: row.item_id, payload: null, deleted: true, baseVersion: Number(row.version) });
      else toApply.push(row);
    }
    if (dropped.length) {
      // Exact duplicates of prompts already in the account (for example the same
      // starter pack on two devices) are removed here, never uploaded. The
      // snapshot above holds them, and restoring it removes this marker.
      const keep = (list) => list.filter((entry) => !dropped.includes(entry.id));
      const read = (name) => { try { return JSON.parse(storage.getItem(name) || '[]'); } catch { return []; } };
      storage.setItem(storageKeys.library, JSON.stringify(keep(read(storageKeys.library)))); notifyWrite?.(storageKeys.library);
      storage.setItem(storageKeys.trash, JSON.stringify(keep(read(storageKeys.trash)))); notifyWrite?.(storageKeys.trash);
      const markerKey = `${LIBRARY_DELETED_BATCH_PREFIX}${makeId()}`;
      storage.setItem(markerKey, JSON.stringify(dropped)); notifyWrite?.(markerKey);
      addSnapshotUndoKey(storage, userId, markerKey);
    }
    // Pending local edits keep their local copy; the account copy waits for the push result.
    const written = applyRows(toApply.filter((row) => !queue.get(itemKey(row.kind, row.item_id)) || queue.get(itemKey(row.kind, row.item_id)).lamport === 0));
    const structureKey = itemKey('structure', STRUCTURE_ID);
    const remoteStructure = remote.get(structureKey);
    const merged = mergeStructure(local.get(structureKey)?.payload, remoteStructure?.deleted ? {} : remoteStructure?.payload);
    written.push(...applyRows([{ kind: 'structure', item_id: STRUCTURE_ID, payload: merged, deleted: false, version: remoteStructure ? Number(remoteStructure.version) : 0 }]));
    if (!remoteStructure) delete state.shadow[structureKey];
    enqueue({ key: structureKey, kind: 'structure', item_id: STRUCTURE_ID, payload: merged, baseVersion: remoteStructure ? Number(remoteStructure.version) : 0 });
    Object.assign(state, { initialized: true, cursor, lastManifestAt: now() });
    storage.setItem(OWNER_KEY, userId);
    saveState();
    return { pulled: toApply.length, written, dropped: dropped.length, conflicts };
  }

  async function syncOnce({ allowOwnerChange = false } = {}) {
    const owner = storage.getItem(OWNER_KEY);
    if (owner && owner !== userId && !allowOwnerChange) {
      return { status: 'owner-mismatch', pending: queue.size() };
    }
    state = loadState();
    const written = new Set();
    const add = (keys) => keys.forEach((key) => written.add(key));
    const summary = { status: 'synced', pulled: 0, pushed: 0, conflicts: 0, dropped: 0 };
    try {
      let deferred = new Map();
      if (!state.initialized) {
        const first = await firstRun();
        add(first.written);
        Object.assign(summary, { pulled: first.pulled, dropped: first.dropped, conflicts: first.conflicts, firstRun: true });
      } else {
        if (now() - (state.lastManifestAt || 0) > MANIFEST_EVERY_MS) {
          const checked = await reconcileManifest();
          add(checked.written); summary.pulled += checked.pulled; deferred = checked.deferred;
        }
        captureLocal();
        saveState();
        const pulled = await pullAndApply(state.cursor);
        add(pulled.written);
        summary.pulled += pulled.pulled;
        for (const [key, row] of pulled.deferred) deferred.set(key, row);
      }
      const pushed = await pushQueue(deferred);
      add(pushed.written);
      summary.pushed = pushed.pushed; summary.conflicts += pushed.conflicts;
      if (summary.pushed) add((await pullAndApply(state.cursor)).written);
    } catch (error) {
      saveState();
      // Any failure before the push still backs the outbox off.
      if (!error?.queueBackedOff) queue.fail(queue.due(now()).map((entry) => entry.key), error?.message, now(), random);
      summary.status = statusForError(error);
      summary.error = String(error?.message || error).slice(0, 200);
    }
    summary.pending = queue.size();
    summary.tooLarge = Object.keys(state.oversize || {}).length;
    summary.written = [...written];
    return summary;
  }

  return { syncOnce, pendingCount: () => queue.size(), deviceId, readState: () => loadState() };
}
