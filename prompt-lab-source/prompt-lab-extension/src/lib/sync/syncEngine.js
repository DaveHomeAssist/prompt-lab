// Account sync engine: capture local changes, pull since a cursor, push the
// outbox, and once a day compare a version manifest. Pure JS over an injected
// Storage and transport, so the same code runs in the web app, the extension
// and the Tauri webview, and in tests against a real Postgres.
// Protocol: docs/ACCOUNT_SYNC_DESIGN.md.
import { createSyncQueue } from './syncQueue.js';
import { hashValue } from './syncHash.js';
import { STRUCTURE_ID, applyRemoteRows, duplicateKey, itemKey, mergeStructure, readLocalItems } from './syncModel.js';
import { LIBRARY_DELETED_BATCH_PREFIX, readLibraryDeletionState } from '../libraryDeletion.js';
import { holdSyncWrites, storageKeys } from '../storage.js';
import { addSnapshotUndoKey, takeLocalSnapshot } from './syncBackup.js';

export const DEVICE_KEY = 'pl2-sync-device-id';
export const OWNER_KEY = 'pl2-sync-owner';
export const stateKey = (userId) => `pl2-sync-state:${userId}`;
export const queueKey = (userId) => `pl2-sync-queue:${userId}`;
const PULL_LIMIT = 500;
const PUSH_BATCH = 100;
// Server refuses a push over max_request_bytes (2 MiB) as a whole; stay under
// it with room for the JSON envelope (#277 review).
export const MAX_PUSH_BYTES = 2 * 1024 * 1024 - 64 * 1024;
const FETCH_BATCH = 500;
// The server ends a pull page at its byte cap (max_response_bytes) and marks
// the last row page_truncated; a full page (row limit) may also have more.
/** True when a pull page may have more rows behind it. */
export const pageMayContinue = (page, limit) => page.length >= limit || page.at(-1)?.page_truncated === true;
const MANIFEST_EVERY_MS = 24 * 60 * 60 * 1000;
const BULK_APPLY_SNAPSHOT = 50;
// Server cap is 256 KiB per item (sync_items_payload_size). Larger prompts
// (for example very long version histories) stay on this device and are
// reported, instead of failing every push that contains them.
export const MAX_ITEM_BYTES = 256 * 1024 - 1024;
const utf8Length = (text) => new TextEncoder().encode(text).length;
// The server measures sizes as octet_length(value::text) on jsonb, and jsonb
// prints a space after every ':' and ',' (R-12): {"a": 1, "b": [1, 2]}.
// JSON.stringify omits those spaces, so a member-heavy payload measured that
// way can be far smaller than what the server counts.
// jsonb prints numbers as numeric does, without an exponent: 1e21 is
// 1000000000000000000000 and 1e-7 is 0.0000001 (re-review 4, Low).
function numberLength(value) {
  const text = JSON.stringify(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text.length;
  const [, sign, whole, fraction = '', exp] = match;
  const digits = (whole + fraction).replace(/^0+(?=\d)/, '');
  const point = whole.length + Number(exp); // digits left of the decimal point
  const body = point <= 0 ? 2 - point + digits.length // 0.000ddd
    : point >= digits.length ? point // ddd000
    : digits.length + 1; // dd.dd
  return sign.length + body;
}
function jsonbLength(value) {
  if (typeof value === 'number') return numberLength(value);
  if (value === null || typeof value !== 'object') return utf8Length(JSON.stringify(value) ?? 'null');
  if (Array.isArray(value)) return 2 + value.reduce((sum, item, index) => sum + (index ? 2 : 0) + jsonbLength(item), 0);
  const entries = Object.entries(value);
  return 2 + entries.reduce((sum, [key, item], index) => sum + (index ? 2 : 0) + utf8Length(JSON.stringify(key)) + 2 + jsonbLength(item), 0);
}
/** Byte size of a JSON value as the server's jsonb::text counts it. */
export const jsonbTextBytes = (value) => (value === undefined ? 0 : jsonbLength(JSON.parse(JSON.stringify(value))));

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

const emptyState = () => ({ initialized: false, cursor: 0, clock: 0, lastManifestAt: 0, shadow: {}, oversize: {}, lost: {} });
const splitKey = (key) => { const at = key.indexOf(':'); return { kind: key.slice(0, at), item_id: key.slice(at + 1) }; };

/** Split queued changes into push batches of at most PUSH_BATCH items and MAX_PUSH_BYTES. */
export function batchesWithinBytes(items, { maxItems = PUSH_BATCH, maxBytes = MAX_PUSH_BYTES } = {}) {
  const batches = []; let current = []; let bytes = 0;
  for (const item of items) {
    const size = jsonbTextBytes(item.wire) + 2;
    if (current.length && (current.length >= maxItems || bytes + size > maxBytes)) { batches.push(current); current = []; bytes = 0; }
    current.push(item); bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

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
    if (!deleted && jsonbTextBytes(payload) > MAX_ITEM_BYTES) {
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

  // R-11 / #285 Codex P1: a push that lost a conflict leaves a pending record
  // { version, hash } until the winner's row is actually applied. The shadow
  // keeps the last applied version, so pulls and the manifest still deliver
  // the winner; the record marks the losing content as settled (it is saved as
  // a conflict copy) so it is not pushed again. A newer edit is still based on
  // the shadow's version (R-16), so it conflicts with the winner instead of
  // silently replacing it.
  const lostRecord = (key) => state.lost?.[key];
  const forgetLost = (key) => {
    if (state.lost?.[key]) { const { [key]: done, ...rest } = state.lost; state.lost = rest; }
  };
  const settleShadow = (key, value) => { state.shadow[key] = value; forgetLost(key); };

  function captureLocal() {
    const local = readLocalItems(storage);
    for (const [key, item] of local) {
      const lost = lostRecord(key);
      const settledHash = lost ? lost.hash : state.shadow[key]?.hash;
      // R-16: a newer edit stays based on the last version this device
      // applied (the shadow), not the winner it has not seen, so the server
      // treats it as a conflict and keeps the losing side as a conflict copy.
      if ((!lost && !state.shadow[key]) || settledHash !== hashValue(item.payload)) enqueue({ key, ...item });
    }
    for (const [key, shadow] of Object.entries(state.shadow)) {
      const lost = lostRecord(key);
      const settledHash = lost ? lost.hash : shadow.hash;
      if (settledHash !== null && !local.has(key) && key.startsWith('prompt:')) {
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
      if (!pageMayContinue(page, PULL_LIMIT)) return { rows, cursor };
    }
  }

  function applyRows(rows) {
    if (!rows.length) return [];
    const result = applyRemoteRows(storage, rows, { notifyWrite });
    for (const row of rows) {
      const key = itemKey(row.kind, row.item_id);
      settleShadow(key, { version: Number(row.version), hash: result.applied.has(key) ? result.applied.get(key) : null });
    }
    return result.written;
  }

  // Server rows newer than what this device has seen. Rows for items with a
  // pending local edit wait for the push result; a permanently deleted prompt
  // (local deletion marker) is answered with a tombstone, never resurrected.
  function applyServerRows(rows) {
    // An empty outbox does not prove the local copy is unchanged: the daily
    // manifest runs before the regular capture, and the user can save while a
    // pull is awaiting the network. Re-read local content against the shadow
    // first (synchronously, so nothing can land in between), so a local edit is
    // queued and its remote row deferred instead of overwritten (#277 review).
    captureLocal();
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
    for (let start = 0; start < keys.length; start += FETCH_BATCH) {
      // A response can stop at the server's byte cap: ask again for what is left.
      let pending = keys.slice(start, start + FETCH_BATCH);
      while (pending.length) {
        const got = await transport.fetchItems(pending.map(splitKey));
        if (!got.length) break;
        rows.push(...got);
        const gotKeys = new Set(got.map((row) => itemKey(row.kind, row.item_id)));
        const left = pending.filter((key) => !gotKeys.has(key));
        if (left.length === pending.length) break;
        pending = left;
      }
    }
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
    // R-17: a pending lost record for an item the account no longer has (for
    // example after "Delete my synced data") would keep it from re-uploading.
    for (const key of Object.keys(state.lost || {})) if (!server.has(key)) forgetLost(key);
    const result = applyServerRows(await fetchRows(behind));
    state.lastManifestAt = now();
    saveState();
    return result;
  }

  async function pushQueue(deferred = new Map()) {
    const outcome = { pushed: 0, conflicts: 0, written: [] };
    const toWire = ({ kind, item_id, base_version, lamport, payload, deleted, client_updated_at }) => ({ kind, item_id, base_version, lamport, payload, deleted, client_updated_at });
    const pending = batchesWithinBytes(queue.due(now()).map((entry) => ({ entry, wire: toWire(entry) })));
    while (pending.length) {
      const batch = pending.shift();
      let results;
      try {
        results = await transport.push(deviceId, batch.map(({ wire }) => wire));
      } catch (error) {
        // R-12: a request-size refusal splits the batch and retries the halves
        // instead of reporting a storage quota. A single item the server still
        // calls too large stays on this device, like any oversize item.
        if (Number(error?.status) === 413 && /too large/i.test(error?.message || '')) {
          if (batch.length > 1) { const half = Math.ceil(batch.length / 2); pending.unshift(batch.slice(0, half), batch.slice(half)); continue; }
          const [{ entry }] = batch;
          queue.acknowledge(entry.key, entry.lamport);
          state.oversize = { ...(state.oversize || {}), [entry.key]: true };
          saveState();
          continue;
        }
        queue.fail(batch.map(({ entry }) => entry.key), error?.message, now(), random);
        if (error && typeof error === 'object') error.queueBackedOff = true;
        throw error;
      }
      const lost = [];
      const localNow = readLocalItems(storage);
      for (const result of results) {
        const key = itemKey(result.kind, result.item_id);
        const sent = batch.find(({ entry }) => entry.key === key)?.entry;
        if (!sent) continue;
        queue.acknowledge(key, sent.lamport);
        if (result.status === 'conflict_lost') {
          outcome.conflicts += 1;
          lost.push({ key, version: Number(result.version) });
          // R-11: the server kept the other device's edit and saved ours as a
          // conflict copy, so the losing edit is settled: record it as pending
          // until the winner is applied (see lostRecord). Only an edit made
          // after this point differs from it and is queued again. The content
          // the device holds now counts as settled when it is what was sent or
          // what the shadow already had (the first-run merge applied the
          // account's row before pushing the local copy as the loser).
          const current = localNow.get(key);
          const currentHash = current && !current.deleted ? hashValue(current.payload) : null;
          const settled = currentHash !== null && currentHash === state.shadow[key]?.hash ? currentHash : sent.hash;
          state.lost = { ...(state.lost || {}), [key]: { version: Number(result.version), hash: settled } };
          continue;
        }
        if (result.status === 'conflict_won') outcome.conflicts += 1;
        settleShadow(key, { version: Number(result.version), hash: sent.hash });
        outcome.pushed += 1;
      }
      if (lost.length) {
        // The account kept another device's edit; ours is saved as a conflict copy.
        const known = lost.map(({ key, version }) => (deferred.get(key)?.version >= version ? deferred.get(key) : null));
        // Saved first: if this fetch fails, the pending records survive and
        // the next sync fetches the winners before anything else.
        saveState();
        const fetched = await fetchRows(lost.filter((item, index) => !known[index]).map((item) => item.key));
        // Only an edit made after the push answered is queued again and kept
        // locally; everything else takes the winner's content.
        captureLocal();
        outcome.written.push(...applyRows([...known.filter(Boolean), ...fetched].filter((row) => !queue.get(itemKey(row.kind, row.item_id)))));
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

  // R-28/R-29: the sync state and outbox are journaled with the Library on
  // desktop. Their saves are held back while the sync runs and announced
  // once, after the last save, rather than on every save (each commit rewrites
  // the whole Library record). The engine announces them itself, so this never
  // depends on another module watching Storage. A sync that never finishes
  // (the app closed) leaves the journal at its last commit, which always pairs
  // the Library with the sync state that describes it.
  async function syncOnce(options) {
    const release = holdSyncWrites();
    try {
      return await runSync(options);
    } finally {
      release();
      announceSyncWrites();
    }
  }

  function announceSyncWrites() {
    notifyWrite?.(stateKey(userId));
    notifyWrite?.(queueKey(userId));
  }

  async function runSync({ allowOwnerChange = false } = {}) {
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
        const lostKeys = Object.keys(state.lost || {});
        if (lostKeys.length) {
          // Winners a lost push could not fetch last time (#285 Codex P1).
          const winners = await fetchRows(lostKeys);
          // R-17: no row on the account any more (erased): drop the record and
          // the shadow, so the local copy uploads again as a new item.
          const found = new Set(winners.map((row) => itemKey(row.kind, row.item_id)));
          for (const key of lostKeys) if (!found.has(key)) { forgetLost(key); delete state.shadow[key]; }
          const recovered = applyServerRows(winners);
          add(recovered.written); summary.pulled += recovered.pulled;
          for (const [key, row] of recovered.deferred) deferred.set(key, row);
          saveState();
        }
        captureLocal();
        saveState();
        const pulled = await pullAndApply(state.cursor);
        add(pulled.written);
        summary.pulled += pulled.pulled;
        for (const [key, row] of pulled.deferred) deferred.set(key, row);
      }
      const pushed = await pushQueue(deferred);
      // R-33: the push is applied on the account; journal the settled state
      // and outbox now, not only at the end, so a crash during the follow-up
      // pull does not restore the pre-push pair and re-push the same changes.
      if (pushed.pushed || pushed.conflicts) { saveState(); announceSyncWrites(); }
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
