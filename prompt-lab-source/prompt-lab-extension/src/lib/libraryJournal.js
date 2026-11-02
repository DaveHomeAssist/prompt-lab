import { logWarn } from './logger.js';
import { LIBRARY_CLEAR_PREFIX, isLibraryDeletionKey } from './libraryDeletion.js';
import { onLocalWrite, storageKeys } from './storage.js';

// WebView2 batches localStorage commits in its storage service and can drop a
// pending batch when the desktop window closes, so a Library save the UI has
// already acknowledged may never reach disk. An IndexedDB transaction opened
// with durability "strict" is flushed before "complete" fires, so the desktop
// shell journals the whole Library state there after every Library write.
// localStorage stays the synchronous copy every existing reader uses; boot
// restores it from the journal when the journal holds a newer revision.
export const LIBRARY_JOURNAL_DB = 'prompt_lab_durable';
export const LIBRARY_JOURNAL_STORE = 'journal';
export const LIBRARY_JOURNAL_RECORD = 'library';
export const LIBRARY_JOURNAL_REVISION_KEY = 'pl2-library-journal-revision';
export const LIBRARY_JOURNAL_BOOT_MARK = 'prompt-lab:library-journal-boot';
const DB_VERSION = 1;
const BOOT_TIMEOUT_MS = 3000;
// A cold IndexedDB open can exceed one boot window on a loaded machine (seen on
// Windows CI). A timed-out boot read is retried, still bounded, before the app
// starts without the journal. Saves keep the single timeout.
const BOOT_RETRIES = 2;
const TIMEOUT_CODE = 'journal-timeout';
let activeJournal = null;

// Save callers must wait for the strict transaction, not the localStorage
// staging write. Missing/unavailable desktop storage must never mean Saved.
export function commitLibrarySave() {
  if (typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return null;
  if (!activeJournal) return Promise.reject(new Error('Durable Library storage is unavailable.'));
  activeJournal.commit();
  return activeJournal.flush();
}
// Everything Library rendering depends on, restored as one snapshot: rows are
// filtered by the newest clear marker, and packs track which starters loaded.
const RECORD_KEYS = [
  storageKeys.library, storageKeys.trash, storageKeys.collections, storageKeys.folders, storageKeys.packs, storageKeys.loadedPacks,
];

// R-21: account-sync state (shadow, cursor) and the outbox describe the
// Library, so they are journaled in the same record and transaction. A restore
// can then never pair a newer shadow with an older Library, which would make
// the engine push stale content (based on the current version) or deletes.
export const isSyncLibraryKey = (key) => typeof key === 'string'
  && (key.startsWith('pl2-sync-state:') || key.startsWith('pl2-sync-queue:'));
export const isLibraryJournalKey = (key) => RECORD_KEYS.includes(key) || isLibraryDeletionKey(key) || isSyncLibraryKey(key);

// Desktop only. The extension's storage is owned by the browser profile, and
// the web shell keeps its existing behavior.
export const libraryJournalSupported = () => typeof window !== 'undefined'
  && Boolean(window.__TAURI_INTERNALS__)
  && typeof indexedDB !== 'undefined';

export function readLibraryState(storage) {
  const entries = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (isLibraryJournalKey(key)) entries[key] = storage.getItem(key);
  }
  return entries;
}

export function readLocalRevision(storage, revisionKey = LIBRARY_JOURNAL_REVISION_KEY) {
  const revision = Number(storage.getItem(revisionKey));
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function sameEntries(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && right[key] === left[key]);
}

// A committed journal owns its revision. WebView2 can retain the revision but
// lose some mirror data at close, so equal counters do not prove equal content.
// A higher local revision still carries newer writes that need journaling.
export function planLibraryJournalBoot(local, record) {
  if (record && (record.revision > local.revision
    || (record.revision === local.revision && !sameEntries(local.entries, record.entries)))) return 'restore';
  if (!record || record.revision < local.revision) return 'journal';
  return 'current';
}

export function applyLibraryJournalRecord(storage, record) {
  // Deletion markers are append-only, so keep any the journal lacks rather
  // than let a deleted prompt return.
  for (const key of Object.keys(readLibraryState(storage))) {
    // Sync state the snapshot does not have belongs to a newer Library than the
    // one restored: drop it, so the engine re-merges from the account instead.
    if ((RECORD_KEYS.includes(key) || isSyncLibraryKey(key)) && !Object.hasOwn(record.entries, key)) storage.removeItem(key);
  }
  for (const [key, value] of Object.entries(record.entries)) storage.setItem(key, value);
  storage.setItem(LIBRARY_JOURNAL_REVISION_KEY, String(record.revision));
}

// Identity of one Library array element: a record id, or the value itself.
const elementKey = (item) => (item && typeof item === 'object' && typeof item.id === 'string')
  ? `id:${item.id}` : `v:${JSON.stringify(item)}`;
const elementClock = (item) => {
  const parsed = new Date(item?.updatedAt || item?.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};
const parseArray = (raw) => { try { const value = JSON.parse(raw); return Array.isArray(value) ? value : null; } catch { return null; } };

// Runs inside the write transaction while this device has not read the
// journal yet (its boot read failed or timed out), the Library counterpart of
// the settings journal's R-20 merge. Local Storage may have lost what the
// journal holds, so the write must not replace the record wholesale:
// - deletion and Clear Library markers are append-only and kept, so readers
//   still filter out what either side deleted;
// - array keys (prompts, trash, collections, folders, packs) are merged per
//   element: this device's copy wins unless the journal's is strictly newer,
//   and journal-only elements are kept, except structure entries (collections,
//   folders, packs) this device removed in this session (R-32);
// - a prompt that ends up in both the Library and the trash goes where its
//   newer move puts it (deletedAt/updatedAt), whichever side made it (R-31);
// - rows this device saved after the journal's newer Clear Library move to
//   that Clear's generation; older rows a rollback brought back stay hidden
//   (#293 Codex P1, R-30).
// When the journal contributed anything, the record leaves out the sync state
// and outbox: they describe this device's smaller Library, and pairing them
// with the merged one could push deletes (R-21). The next restore then drops
// them and the engine re-merges safely. The merged record differs from Local
// Storage, so the next boot restores it.
const CLEAR_GENERATION = /^\d{16}:[\da-f-]+$/;
// The newest Clear Library generation among a record's marker keys ('0' if none).
const clearGeneration = (entries) => Object.keys(entries).reduce((newest, key) => {
  if (!key.startsWith(LIBRARY_CLEAR_PREFIX)) return newest;
  const candidate = key.slice(LIBRARY_CLEAR_PREFIX.length);
  return CLEAR_GENERATION.test(candidate) && candidate > newest ? candidate : newest;
}, '0');
const timeOf = (value) => {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
// When the journal's Clear happened: the marker records it (R-30). Markers from
// before that hold '1'; then the journal's last commit time is the bound.
const clearTime = (entries, generation, savedAt) => timeOf(entries[`${LIBRARY_CLEAR_PREFIX}${generation}`]) ?? timeOf(savedAt);
const rowClock = (row) => Math.max(timeOf(row?.updatedAt) ?? 0, timeOf(row?.deletedAt) ?? 0, timeOf(row?.createdAt) ?? 0);
const generationOf = (row) => row?.metadata?.libraryGeneration || '0';
const STRUCTURE_KEYS = RECORD_KEYS.filter((key) => key !== storageKeys.library && key !== storageKeys.trash);

function mergeElements(local, journal, removed = new Set()) {
  const index = new Map(local.map((item, position) => [elementKey(item), position]));
  const result = [...local];
  let changed = false;
  for (const item of journal) {
    const id = elementKey(item);
    if (index.has(id)) {
      const position = index.get(id);
      if (elementClock(item) > elementClock(result[position])) { result[position] = item; changed = true; }
    } else if (!removed.has(id)) {
      index.set(id, result.length); result.push(item); changed = true;
    }
  }
  return { result, changed };
}

export function mergeLibraryEntries(stored, fresh, { savedAt = null, removed = {} } = {}) {
  const merged = { ...fresh };
  for (const [key, value] of Object.entries(stored)) {
    if (isLibraryDeletionKey(key) && !Object.hasOwn(fresh, key)) merged[key] = value;
  }
  // R-30: only rows saved after the journal's Clear join its generation.
  const mine = clearGeneration(fresh);
  const theirs = clearGeneration(stored);
  const after = theirs > mine ? clearTime(stored, theirs, savedAt) : null;
  const localRows = (key) => {
    if (!Object.hasOwn(fresh, key)) return [];
    const rows = parseArray(fresh[key]);
    if (!rows || after === null) return rows;
    return rows.map((row) => (row && typeof row === 'object' && generationOf(row) === mine && rowClock(row) > after)
      ? { ...row, metadata: { ...(row.metadata || {}), libraryGeneration: theirs } } : row);
  };
  const results = {};
  for (const key of RECORD_KEYS) {
    if (!Object.hasOwn(stored, key) && !Object.hasOwn(fresh, key)) continue;
    const journal = Object.hasOwn(stored, key) ? parseArray(stored[key]) : [];
    const local = key === storageKeys.library || key === storageKeys.trash
      ? localRows(key)
      : (Object.hasOwn(fresh, key) ? parseArray(fresh[key]) : []);
    if (!local || !journal) { if (!Object.hasOwn(fresh, key)) merged[key] = stored[key]; continue; }
    results[key] = mergeElements(local, journal, removed[key]).result;
  }
  // R-31: one place per prompt, decided by the newer move.
  const library = results[storageKeys.library];
  const trash = results[storageKeys.trash];
  if (library && trash) {
    const inFresh = (key) => new Set((parseArray(fresh[key]) || []).map(elementKey));
    const freshTrash = inFresh(storageKeys.trash);
    const trashed = new Map(trash.map((row) => [elementKey(row), row]));
    const dropFromLibrary = new Set();
    const dropFromTrash = new Set();
    for (const row of library) {
      const id = elementKey(row);
      if (!trashed.has(id)) continue;
      const binned = trashed.get(id);
      const movedOut = Math.max(timeOf(binned?.deletedAt) ?? 0, timeOf(binned?.updatedAt) ?? 0);
      const movedIn = timeOf(row?.updatedAt) ?? 0;
      const toTrash = movedOut === movedIn ? freshTrash.has(id) : movedOut > movedIn;
      (toTrash ? dropFromLibrary : dropFromTrash).add(id);
    }
    results[storageKeys.library] = library.filter((row) => !dropFromLibrary.has(elementKey(row)));
    results[storageKeys.trash] = trash.filter((row) => !dropFromTrash.has(elementKey(row)));
  }
  for (const [key, rows] of Object.entries(results)) {
    const text = JSON.stringify(rows);
    const freshText = Object.hasOwn(fresh, key) ? JSON.stringify(parseArray(fresh[key])) : null;
    if (text !== freshText) merged[key] = text;
    else if (Object.hasOwn(fresh, key)) merged[key] = fresh[key];
  }
  const adopted = [...new Set([...Object.keys(merged), ...Object.keys(fresh)])]
    .some((key) => !isSyncLibraryKey(key) && merged[key] !== fresh[key]);
  if (adopted) for (const key of Object.keys(merged)) if (isSyncLibraryKey(key)) delete merged[key];
  return merged;
}

function openJournal(idb) {
  return new Promise((resolve, reject) => {
    const request = idb.open(LIBRARY_JOURNAL_DB, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LIBRARY_JOURNAL_STORE)) {
        request.result.createObjectStore(LIBRARY_JOURNAL_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Library journal open blocked.'));
  });
}

function readRecord(db, recordId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readonly');
    const request = transaction.objectStore(LIBRARY_JOURNAL_STORE).get(recordId);
    transaction.oncomplete = () => resolve(request.result || null);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Library journal read aborted.'));
  });
}

// Resolves with the committed revision only after the browser reports a strict
// (flushed) commit. The snapshot is read inside the transaction, so commits
// that IndexedDB serializes always carry the newest localStorage state, and the
// revision always moves past the journal's, so the journal never goes back.
function writeRecord(db, storage, wanted, recordId, readState, merge) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(LIBRARY_JOURNAL_STORE);
    const current = store.get(recordId);
    let revision = wanted;
    current.onsuccess = () => {
      revision = Math.max(wanted, (current.result?.revision || 0) + 1);
      // mergeEntries (settings journal, R-20) folds the stored record in per key
      // inside this transaction, so a write after a failed boot read cannot
      // drop keys the journal holds and this device has not seen.
      const fresh = readState(storage);
      const entries = merge ? merge(current.result?.entries || {}, fresh, current.result || null) : fresh;
      store.put({ id: recordId, revision, entries, savedAt: new Date().toISOString() });
    };
    transaction.oncomplete = () => resolve(revision);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Library journal write aborted.'));
  });
}

function withTimeout(promise, timeoutMs, label = 'Library') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`${label} journal did not answer in time.`), { code: TIMEOUT_CODE })), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function markBoot(detail) {
  try {
    performance.mark(LIBRARY_JOURNAL_BOOT_MARK, { detail });
  } catch {
    // Diagnostics only.
  }
}

export function createLibraryJournal({
  storage, idb, timeoutMs = BOOT_TIMEOUT_MS, bootRetries = BOOT_RETRIES,
  recordId = LIBRARY_JOURNAL_RECORD,
  revisionKey = LIBRARY_JOURNAL_REVISION_KEY,
  readState = readLibraryState,
  applyRecord = applyLibraryJournalRecord,
  isKey = isLibraryJournalKey,
  mergeEntries = null,
  // Used only until this device has read the record (see mergeLibraryEntries).
  mergeBeforeBoot = recordId === LIBRARY_JOURNAL_RECORD ? mergeLibraryEntries : null,
}) {
  const label = recordId.charAt(0).toUpperCase() + recordId.slice(1);
  let dbPromise = null;
  let queued = false;
  let chain = Promise.resolve();
  let pending = chain;
  let revision = 0;
  // True once a boot read has seen the record, so a write knows what it replaces.
  let reconciled = false;
  // R-32: structure entries this device removed while unreconciled, so the
  // pre-boot merge does not bring them back from the journal.
  let lastSeen = null;
  const removed = {};
  const trackRemovals = (fresh) => {
    if (lastSeen) {
      for (const key of STRUCTURE_KEYS) {
        const before = (parseArray(lastSeen[key]) || []).map(elementKey);
        const now = new Set((parseArray(fresh[key]) || []).map(elementKey));
        const gone = (removed[key] ||= new Set());
        for (const id of before) if (!now.has(id)) gone.add(id);
        for (const id of now) gone.delete(id);
      }
    }
    lastSeen = fresh;
  };
  // #294 Codex P2: the fallback Clear cutoff for markers without a time is the
  // journal's last commit before this session's first write. Later commits in
  // the session advance savedAt, so it is taken once and kept; otherwise a
  // prompt re-stamped by the first merge would fall behind the moving cutoff
  // and lose its generation on the second.
  let legacyCutoff;
  const preBootMerge = mergeBeforeBoot && ((storedEntries, fresh, record) => {
    trackRemovals(fresh);
    if (legacyCutoff === undefined) legacyCutoff = record?.savedAt ?? null;
    return mergeBeforeBoot(storedEntries, fresh, { savedAt: legacyCutoff, removed });
  });
  const database = () => {
    // A failed open is retried by the next write instead of being cached.
    dbPromise ||= openJournal(idb).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  };

  const setLocalRevision = (value) => {
    try {
      storage.setItem(revisionKey, String(value));
    } catch (error) {
      logWarn('library journal revision', error);
    }
  };

  const commit = () => {
    queued = false;
    // Written after the data it covers. Another window may have advanced it.
    revision = Math.max(revision, readLocalRevision(storage, revisionKey)) + 1;
    const wanted = revision;
    setLocalRevision(wanted);
    const write = chain.then(() => database()).then((db) => writeRecord(db, storage, wanted, recordId, readState, mergeEntries || (reconciled ? null : preBootMerge))).then((committed) => {
      // The journal was ahead (for example after a boot read timed out), so
      // the commit took a higher revision. Keep localStorage in step with it.
      if (committed > revision) revision = committed;
      if (committed > readLocalRevision(storage, revisionKey)) setLocalRevision(committed);
      return committed;
    });
    pending = write;
    // Settles with null on failure; localStorage still holds the write.
    chain = write.catch((error) => {
      logWarn('library journal write', error);
      return null;
    });
    return chain;
  };

  // Writes in one synchronous turn share one snapshot, taken after the turn.
  const note = (key) => {
    if (!isKey(key) || queued) return;
    queued = true;
    queueMicrotask(() => { if (queued) commit(); });
  };

  const restore = async () => {
    const local = { revision: readLocalRevision(storage, revisionKey), entries: readState(storage) };
    lastSeen = local.entries;
    revision = local.revision;
    let record;
    let attempts = 0;
    for (;;) {
      attempts += 1;
      try {
        // The open is not cancelled on timeout, so a retry keeps waiting on it.
        record = await withTimeout(database().then(db => readRecord(db, recordId)), timeoutMs, label);
        reconciled = true;
        break;
      } catch (error) {
        if (error?.code !== TIMEOUT_CODE || attempts > bootRetries) { error.attempts = attempts; throw error; }
        logWarn(`${recordId} journal boot read attempt ${attempts}/${bootRetries + 1} timed out after ${timeoutMs} ms; retrying`, error);
      }
    }
    const action = planLibraryJournalBoot(local, record);
    if (action === 'restore') {
      applyRecord(storage, record);
      revision = record.revision;
    } else if (action === 'journal') {
      revision = Math.max(revision, record?.revision || 0);
      commit();
    }
    return { action, localRevision: local.revision, journalRevision: record?.revision ?? null, attempts };
  };

  return { note, restore, commit, flush: () => {
    if (queued) commit();
    return withTimeout(pending, timeoutMs, label);
  } };
}

// Runs before the first render so every synchronous reader sees the restored
// Library. A journal failure never blocks startup; localStorage is used as is.
export async function startLibraryJournal({ storage = localStorage, idb = indexedDB, timeoutMs } = {}) {
  const journal = createLibraryJournal({ storage, idb, timeoutMs });
  let outcome;
  try {
    outcome = await journal.restore();
  } catch (error) {
    logWarn('library journal restore', error);
    outcome = { action: 'unavailable', error: error?.message || String(error), attempts: error?.attempts ?? 1 };
  }
  activeJournal = journal;
  const unsubscribe = onLocalWrite(journal.note);
  const stop = () => {
    unsubscribe();
    if (activeJournal === journal) activeJournal = null;
  };
  markBoot(outcome);
  return { journal, outcome, stop };
}
