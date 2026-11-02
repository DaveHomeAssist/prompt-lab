import { notifyLocalWrite, storageKeys } from './storage.js';

// Append-only, content-free keys prevent concurrent tabs from replacing another
// tab's deletion metadata. Keep them until a replica-expiry policy exists.
export const LIBRARY_DELETED_PREFIX = 'pl2-library-deleted:';
export const LIBRARY_DELETED_BATCH_PREFIX = 'pl2-library-deleted-batch:';
export const LIBRARY_CLEAR_PREFIX = 'pl2-library-clear:';

export function isLibraryDeletionKey(key) {
  return key?.startsWith(LIBRARY_DELETED_PREFIX) || key?.startsWith(LIBRARY_DELETED_BATCH_PREFIX)
    || key?.startsWith(LIBRARY_CLEAR_PREFIX);
}

export function readLibraryDeletionState(storage = localStorage) {
  const deletedIds = new Set();
  let generation = '0';
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LIBRARY_DELETED_PREFIX)) deletedIds.add(key.slice(LIBRARY_DELETED_PREFIX.length));
    if (key?.startsWith(LIBRARY_DELETED_BATCH_PREFIX)) {
      try {
        const ids = JSON.parse(storage.getItem(key));
        if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) {
          for (const id of ids) deletedIds.add(id);
        }
      } catch {
        // Invalid metadata must not delete unrelated records or prevent loading.
      }
    }
    if (key?.startsWith(LIBRARY_CLEAR_PREFIX)) {
      const candidate = key.slice(LIBRARY_CLEAR_PREFIX.length);
      if (/^\d{16}:[\da-f-]+$/.test(candidate) && candidate > generation) generation = candidate;
    }
  }
  return { deletedIds, generation };
}

export function stampLibraryGeneration(records, generation) {
  return records.map((entry) => entry.metadata?.libraryGeneration != null ? entry : {
    ...entry, metadata: { ...entry.metadata, libraryGeneration: generation },
  });
}

export function filterDeletedLibraryRecords(records, state = readLibraryDeletionState()) {
  return records.filter((entry) => !state.deletedIds.has(entry.id)
    && (entry.metadata?.libraryGeneration || '0') === state.generation);
}

export function markLibraryDeleted(ids, storage = localStorage) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return;
  // One setItem is atomic on quota failure. Never expose a partial batch to
  // other tabs or the desktop journal, even briefly before a rollback.
  // Unique append-only keys also keep concurrent batches from replacing peers.
  const key = uniqueIds.length === 1
    ? `${LIBRARY_DELETED_PREFIX}${uniqueIds[0]}`
    : `${LIBRARY_DELETED_BATCH_PREFIX}${crypto.randomUUID()}`;
  storage.setItem(key, uniqueIds.length === 1 ? '1' : JSON.stringify(uniqueIds));
  notifyLocalWrite(key);
}

const storedIds = (storage, key) => {
  try {
    const rows = JSON.parse(storage.getItem(key));
    return Array.isArray(rows) ? rows.map((row) => row?.id).filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

// Only the desktop shell's Library journal reads marker ids (the same test as
// libraryJournalSupported in libraryJournal.js, kept here to avoid an import
// cycle). The web app and the extension write the time alone (R-38).
const durableJournalShell = () => typeof window !== 'undefined'
  && Boolean(window.__TAURI_INTERNALS__)
  && typeof indexedDB !== 'undefined';

// R-38: markers past the newest few keep only their time. Ids matter only when
// a Local Storage rollback crosses a Clear and the next journal boot read
// fails; WebView2 loses at most the last unflushed writes, so a rollback that
// crosses more than a few Clears is not expected, and an older marker still
// falls back to its time. 3 bounds the id lists to three Library-sized lists
// in Local Storage and in every journal commit.
export const CLEAR_MARKER_IDS_KEPT = 3;

// The marker value records what the Clear removed: its time (R-30) and, on
// desktop, the ids of the prompts and trash it cleared (R-34), so the desktop
// journal can tell cleared rows from later ones without comparing device
// clocks. Readers use only the key. If the id list does not fit, the time
// alone is kept.
export function markLibraryCleared(storage = localStorage, ids = [], { withIds = durableJournalShell() } = {}) {
  const { generation } = readLibraryDeletionState(storage);
  const counter = Number(generation.split(':')[0]) + 1;
  if (!Number.isSafeInteger(counter)) throw new Error('Library generation limit reached.');
  const next = `${String(counter).padStart(16, '0')}:${crypto.randomUUID()}`;
  const key = `${LIBRARY_CLEAR_PREFIX}${next}`;
  const at = new Date().toISOString();
  if (withIds) {
    const cleared = [...new Set([
      ...storedIds(storage, storageKeys.library), ...storedIds(storage, storageKeys.trash),
      ...ids.filter((id) => typeof id === 'string'),
    ])];
    try {
      storage.setItem(key, JSON.stringify({ at, ids: cleared }));
    } catch {
      storage.setItem(key, at);
    }
  } else {
    storage.setItem(key, JSON.stringify({ at }));
  }
  notifyLocalWrite(key);
  return next;
}

// R-38: drop the id lists from all but the newest `keep` Clear markers. The
// desktop journal calls this once its boot read has reconciled. Returns the
// keys it rewrote.
export function pruneClearMarkerIds(storage = localStorage, keep = CLEAR_MARKER_IDS_KEPT) {
  const markers = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(LIBRARY_CLEAR_PREFIX)) continue;
    if (/^\d{16}:[\da-f-]+$/.test(key.slice(LIBRARY_CLEAR_PREFIX.length))) markers.push(key);
  }
  markers.sort().reverse();
  const rewritten = [];
  for (const key of markers.slice(keep)) {
    let value = null;
    try { value = JSON.parse(storage.getItem(key)); } catch { value = null; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'ids')) continue;
    storage.setItem(key, JSON.stringify(typeof value.at === 'string' ? { at: value.at } : {}));
    rewritten.push(key);
  }
  return rewritten;
}
