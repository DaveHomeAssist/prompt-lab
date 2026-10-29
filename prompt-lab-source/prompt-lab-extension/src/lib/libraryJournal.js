import { logWarn } from './logger.js';
import { isLibraryDeletionKey } from './libraryDeletion.js';
import { onLocalWrite, storageKeys } from './storage.js';
import { runLibraryWrite } from './libraryWriteCoordinator.js';

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

export const isLibraryJournalKey = (key) => RECORD_KEYS.includes(key) || isLibraryDeletionKey(key);

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
    if (RECORD_KEYS.includes(key) && !Object.hasOwn(record.entries, key)) storage.removeItem(key);
  }
  for (const [key, value] of Object.entries(record.entries)) storage.setItem(key, value);
  storage.setItem(LIBRARY_JOURNAL_REVISION_KEY, String(record.revision));
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
    // The caller has a bounded UI timeout, but the request can still create or
    // upgrade this database later. Keep tracking it until it actually settles.
  });
}

function readRecord(db, recordId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readonly');
    const request = transaction.objectStore(LIBRARY_JOURNAL_STORE).get(recordId);
    transaction.oncomplete = () => resolve(request.result || null);
    transaction.onabort = () => reject(transaction.error || new Error('Library journal read aborted.'));
  });
}

// Resolves with the committed revision only after the browser reports a strict
// (flushed) commit. The snapshot is read inside the transaction, so commits
// that IndexedDB serializes always carry the newest localStorage state, and the
// revision always moves past the journal's, so the journal never goes back.
function writeRecord(db, storage, wanted, recordId, readState) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(LIBRARY_JOURNAL_STORE);
    const current = store.get(recordId);
    let revision = wanted;
    current.onsuccess = () => {
      revision = Math.max(wanted, (current.result?.revision || 0) + 1);
      store.put({ id: recordId, revision, entries: readState(storage), savedAt: new Date().toISOString() });
    };
    transaction.oncomplete = () => resolve(revision);
    transaction.onabort = () => reject(transaction.error || new Error('Library journal write aborted.'));
  });
}

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Library journal did not answer in time.')), timeoutMs);
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
  storage, idb, timeoutMs = BOOT_TIMEOUT_MS,
  recordId = LIBRARY_JOURNAL_RECORD,
  revisionKey = LIBRARY_JOURNAL_REVISION_KEY,
  readState = readLibraryState,
  applyRecord = applyLibraryJournalRecord,
  isKey = isLibraryJournalKey,
}) {
  let dbPromise = null;
  let queued = false;
  let queuedPermit;
  let chain = Promise.resolve();
  let pending = chain;
  let revision = 0;
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

  const commit = (parent = queuedPermit) => {
    queued = false;
    queuedPermit = undefined;
    const write = runLibraryWrite(() => {
      // Written after the data it covers. Another window may have advanced it.
      revision = Math.max(revision, readLocalRevision(storage, revisionKey)) + 1;
      const wanted = revision;
      setLocalRevision(wanted);
      return chain.then(() => database()).then((db) => writeRecord(db, storage, wanted, recordId, readState)).then((committed) => {
        // The journal was ahead (for example after a boot read timed out), so
        // the commit took a higher revision. Keep localStorage in step with it.
        if (committed > revision) revision = committed;
        if (committed > readLocalRevision(storage, revisionKey)) setLocalRevision(committed);
        return committed;
      });
    }, { parent, key: `journal:${recordId}` });
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
    // Register now, not when the microtask starts. A capture called immediately
    // after saveJson must wait for this already-scheduled durable write.
    runLibraryWrite(permit => new Promise((resolve, reject) => {
      queued = true;
      queuedPermit = permit;
      queueMicrotask(() => {
        if (queued) commit(permit);
        pending.then(resolve, reject);
      });
    })).catch(error => { logWarn('library journal scheduled write', error); });
  };

  const restore = () => runLibraryWrite(async permit => {
    const local = { revision: readLocalRevision(storage, revisionKey), entries: readState(storage) };
    revision = local.revision;
    const record = await withTimeout(runLibraryWrite(() => database().then(db => readRecord(db, recordId)), { parent: permit }), timeoutMs);
    const action = planLibraryJournalBoot(local, record);
    if (action === 'restore') {
      applyRecord(storage, record);
      revision = record.revision;
    } else if (action === 'journal') {
      revision = Math.max(revision, record?.revision || 0);
      commit(permit);
    }
    return { action, localRevision: local.revision, journalRevision: record?.revision ?? null };
  }, { key: `journal-boot:${recordId}` });

  return { note, restore, commit, flush: () => {
    if (queued) commit();
    return withTimeout(pending, timeoutMs);
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
    outcome = { action: 'unavailable', error: error?.message || String(error) };
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
