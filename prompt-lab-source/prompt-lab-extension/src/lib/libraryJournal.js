import { logWarn } from './logger.js';
import { isLibraryDeletionKey } from './libraryDeletion.js';
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
// Everything Library rendering depends on, restored as one snapshot: rows are
// filtered by the newest clear marker, and packs track which starters loaded.
const RECORD_KEYS = [
  storageKeys.library, storageKeys.trash, storageKeys.collections, storageKeys.packs, storageKeys.loadedPacks,
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

export function readLocalRevision(storage) {
  const revision = Number(storage.getItem(LIBRARY_JOURNAL_REVISION_KEY));
  return Number.isSafeInteger(revision) && revision > 0 ? revision : 0;
}

function sameEntries(left, right) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && right[key] === left[key]);
}

// localStorage persists writes in order, and the revision is written after the
// data it covers. A higher journal revision therefore means localStorage lost
// writes; a higher local revision, or equal revisions with different contents,
// means the journal missed writes that localStorage kept.
export function planLibraryJournalBoot(local, record) {
  if (record && record.revision > local.revision) return 'restore';
  if (!record || record.revision < local.revision || !sameEntries(local.entries, record.entries)) return 'journal';
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
    request.onblocked = () => reject(new Error('Library journal open blocked.'));
  });
}

function readRecord(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readonly');
    const request = transaction.objectStore(LIBRARY_JOURNAL_STORE).get(LIBRARY_JOURNAL_RECORD);
    transaction.oncomplete = () => resolve(request.result || null);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Library journal read aborted.'));
  });
}

// Resolves with the committed revision only after the browser reports a strict
// (flushed) commit. The snapshot is read inside the transaction, so commits
// that IndexedDB serializes always carry the newest localStorage state, and the
// revision always moves past the journal's, so the journal never goes back.
function writeRecord(db, storage, wanted) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LIBRARY_JOURNAL_STORE, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(LIBRARY_JOURNAL_STORE);
    const current = store.get(LIBRARY_JOURNAL_RECORD);
    let revision = wanted;
    current.onsuccess = () => {
      revision = Math.max(wanted, (current.result?.revision || 0) + 1);
      store.put({ id: LIBRARY_JOURNAL_RECORD, revision, entries: readLibraryState(storage), savedAt: new Date().toISOString() });
    };
    transaction.oncomplete = () => resolve(revision);
    transaction.onerror = () => reject(transaction.error);
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

export function createLibraryJournal({ storage, idb, timeoutMs = BOOT_TIMEOUT_MS }) {
  let dbPromise = null;
  let queued = false;
  let chain = Promise.resolve();
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
      storage.setItem(LIBRARY_JOURNAL_REVISION_KEY, String(value));
    } catch (error) {
      logWarn('library journal revision', error);
    }
  };

  const commit = () => {
    queued = false;
    // Written after the data it covers. Another window may have advanced it.
    revision = Math.max(revision, readLocalRevision(storage)) + 1;
    const wanted = revision;
    setLocalRevision(wanted);
    const write = chain.then(() => database()).then((db) => writeRecord(db, storage, wanted)).then((committed) => {
      // The journal was ahead (for example after a boot read timed out), so
      // the commit took a higher revision. Keep localStorage in step with it.
      if (committed > revision) revision = committed;
      if (committed > readLocalRevision(storage)) setLocalRevision(committed);
      return committed;
    });
    // Settles with null on failure; localStorage still holds the write.
    chain = write.catch((error) => {
      logWarn('library journal write', error);
      return null;
    });
    return chain;
  };

  // Writes in one synchronous turn share one snapshot, taken after the turn.
  const note = (key) => {
    if (!isLibraryJournalKey(key) || queued) return;
    queued = true;
    queueMicrotask(commit);
  };

  const restore = async () => {
    const local = { revision: readLocalRevision(storage), entries: readLibraryState(storage) };
    revision = local.revision;
    const record = await withTimeout(database().then(readRecord), timeoutMs);
    const action = planLibraryJournalBoot(local, record);
    if (action === 'restore') {
      applyLibraryJournalRecord(storage, record);
      revision = record.revision;
    } else if (action === 'journal') {
      revision = Math.max(revision, record?.revision || 0);
      commit();
    }
    return { action, localRevision: local.revision, journalRevision: record?.revision ?? null };
  };

  return { note, restore, commit, flush: () => chain };
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
  const stop = onLocalWrite(journal.note);
  markBoot(outcome);
  return { journal, outcome, stop };
}
