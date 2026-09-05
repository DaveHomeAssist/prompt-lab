// Append-only, content-free keys prevent concurrent tabs from replacing another
// tab's deletion metadata. Keep them until a replica-expiry policy exists.
export const LIBRARY_DELETED_PREFIX = 'pl2-library-deleted:';
export const LIBRARY_CLEAR_PREFIX = 'pl2-library-clear:';

export function isLibraryDeletionKey(key) {
  return key?.startsWith(LIBRARY_DELETED_PREFIX) || key?.startsWith(LIBRARY_CLEAR_PREFIX);
}

export function readLibraryDeletionState(storage = localStorage) {
  const deletedIds = new Set();
  let generation = '0';
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LIBRARY_DELETED_PREFIX)) deletedIds.add(key.slice(LIBRARY_DELETED_PREFIX.length));
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
  for (const id of ids) storage.setItem(`${LIBRARY_DELETED_PREFIX}${id}`, '1');
}

export function markLibraryCleared(storage = localStorage) {
  const { generation } = readLibraryDeletionState(storage);
  const counter = Number(generation.split(':')[0]) + 1;
  if (!Number.isSafeInteger(counter)) throw new Error('Library generation limit reached.');
  const next = `${String(counter).padStart(16, '0')}:${crypto.randomUUID()}`;
  storage.setItem(`${LIBRARY_CLEAR_PREFIX}${next}`, '1');
  return next;
}
