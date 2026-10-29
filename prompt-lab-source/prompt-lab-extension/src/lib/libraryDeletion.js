import { writeLibraryLocalItem } from './libraryWriteCoordinator.js';
import { notifyLocalWrite } from './storage.js';

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
  writeLibraryLocalItem(storage, key, uniqueIds.length === 1 ? '1' : JSON.stringify(uniqueIds));
  notifyLocalWrite(key);
}

export function markLibraryCleared(storage = localStorage) {
  const { generation } = readLibraryDeletionState(storage);
  const counter = Number(generation.split(':')[0]) + 1;
  if (!Number.isSafeInteger(counter)) throw new Error('Library generation limit reached.');
  const next = `${String(counter).padStart(16, '0')}:${crypto.randomUUID()}`;
  writeLibraryLocalItem(storage, `${LIBRARY_CLEAR_PREFIX}${next}`, '1');
  notifyLocalWrite(`${LIBRARY_CLEAR_PREFIX}${next}`);
  return next;
}
