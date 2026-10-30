// Maps the existing pl2-* Library storage to sync items and back.
// Items: prompt:<id> = { state: 'active' | 'trash', entry }, and one
// structure:main = { collections, folders, loadedPacks }. Folders are synced
// as one record because their paths and parent links are validated together.
import { filterDeletedLibraryRecords, markLibraryDeleted, readLibraryDeletionState } from '../libraryDeletion.js';
import { storageKeys } from '../storage.js';
import { hashValue } from './syncHash.js';

export const STRUCTURE_ID = 'main';
export const itemKey = (kind, id) => `${kind}:${id}`;

function readArray(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function writeJson(storage, key, value, notifyWrite) {
  storage.setItem(key, JSON.stringify(value));
  notifyWrite?.(key);
}

/** Current local items as Map<key, { kind, item_id, payload }>. */
export function readLocalItems(storage) {
  const deletion = readLibraryDeletionState(storage);
  const items = new Map();
  const add = (entry, state) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id) return;
    const key = itemKey('prompt', entry.id);
    // An active copy beats a stale trash copy with the same id.
    if (items.has(key) && state === 'trash') return;
    items.set(key, { kind: 'prompt', item_id: entry.id, payload: { state, entry: stripLocal(entry) } });
  };
  filterDeletedLibraryRecords(readArray(storage, storageKeys.library), deletion).forEach((entry) => add(entry, 'active'));
  filterDeletedLibraryRecords(readArray(storage, storageKeys.trash), deletion).forEach((entry) => add(entry, 'trash'));
  items.set(itemKey('structure', STRUCTURE_ID), {
    kind: 'structure',
    item_id: STRUCTURE_ID,
    payload: {
      collections: readArray(storage, storageKeys.collections),
      folders: readArray(storage, storageKeys.folders),
      loadedPacks: readArray(storage, storageKeys.loadedPacks),
    },
  });
  return items;
}

// libraryGeneration is a device-local "Clear Library" stamp, never synced.
function stripLocal(entry) {
  if (entry?.metadata?.libraryGeneration == null) return entry;
  const { libraryGeneration, ...metadata } = entry.metadata;
  return { ...entry, metadata };
}

const stampLocal = (entry, generation) => ({ ...entry, metadata: { ...(entry.metadata || {}), libraryGeneration: generation } });

const clockOf = (entry) => {
  const parsed = new Date(entry?.updatedAt || entry?.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Apply pulled rows to local storage. Returns the keys written and, for each
 * applied item, the hash of what is now stored locally (for the shadow).
 */
export function applyRemoteRows(storage, rows, { notifyWrite } = {}) {
  let library = readArray(storage, storageKeys.library);
  let trash = readArray(storage, storageKeys.trash);
  const { generation } = readLibraryDeletionState(storage);
  const deleted = [];
  const applied = new Map();
  let libraryChanged = false;
  const written = new Set();
  for (const row of rows) {
    const key = itemKey(row.kind, row.item_id);
    if (row.kind === 'structure') {
      if (row.deleted || !row.payload) continue;
      const { collections = [], folders = [], loadedPacks = [] } = row.payload;
      writeJson(storage, storageKeys.collections, collections, notifyWrite); written.add(storageKeys.collections);
      writeJson(storage, storageKeys.folders, folders, notifyWrite); written.add(storageKeys.folders);
      writeJson(storage, storageKeys.loadedPacks, loadedPacks, notifyWrite); written.add(storageKeys.loadedPacks);
      applied.set(key, hashValue({ collections, folders, loadedPacks }));
      continue;
    }
    if (row.kind !== 'prompt') continue;
    const local = library.find((entry) => entry.id === row.item_id) || trash.find((entry) => entry.id === row.item_id);
    library = library.filter((entry) => entry.id !== row.item_id);
    trash = trash.filter((entry) => entry.id !== row.item_id);
    libraryChanged = true;
    if (row.deleted || !row.payload?.entry) {
      deleted.push(row.item_id);
      applied.set(key, null);
      continue;
    }
    let entry = { ...row.payload.entry, id: row.item_id };
    // The open Library keeps whichever copy has the newer updatedAt, so a
    // synced winner must not look older than the copy it replaces.
    if (local && clockOf(local) >= clockOf(entry)) entry = { ...entry, updatedAt: new Date(clockOf(local) + 1).toISOString() };
    entry = stripLocal(entry);
    const stored = generation === '0' ? entry : stampLocal(entry, generation);
    if (row.payload.state === 'trash') trash.push(stored); else library.push(stored);
    applied.set(key, hashValue({ state: row.payload.state === 'trash' ? 'trash' : 'active', entry }));
  }
  if (libraryChanged) {
    writeJson(storage, storageKeys.library, library, notifyWrite); written.add(storageKeys.library);
    writeJson(storage, storageKeys.trash, trash, notifyWrite); written.add(storageKeys.trash);
  }
  if (deleted.length) markLibraryDeleted(deleted, storage);
  return { written: [...written], applied, deletedIds: deleted };
}

/** Content identity used to drop exact duplicates on the first upload. */
export function duplicateKey(entry) {
  const meta = entry?.metadata || {};
  if (meta.seedPromptId && meta.packId) return `seed:${meta.packId}:${meta.seedPromptId}`;
  return `content:${hashValue({
    title: String(entry?.title || '').trim(),
    original: entry?.original || '',
    enhanced: entry?.enhanced || '',
    collection: entry?.collection || '',
  })}`;
}

const union = (...lists) => [...new Set(lists.flat().filter((value) => typeof value === 'string' && value))];

/** First-run structure merge: keep every collection, folder and loaded pack. */
export function mergeStructure(local = {}, remote = {}) {
  const folders = [...(remote.folders || [])];
  const ids = new Set(folders.map((folder) => folder?.id));
  const paths = new Set(folders.map((folder) => folder?.collection));
  for (const folder of local.folders || []) {
    if (!folder?.id || ids.has(folder.id) || paths.has(folder.collection)) continue;
    folders.push(folder); ids.add(folder.id); paths.add(folder.collection);
  }
  // Drop any folder whose parent did not survive the merge, repeatedly.
  let kept = folders;
  for (let changed = true; changed;) {
    const present = new Set(kept.map((folder) => folder.id));
    const next = kept.filter((folder) => !folder.parentId || present.has(folder.parentId));
    changed = next.length !== kept.length; kept = next;
  }
  return {
    collections: union(remote.collections || [], local.collections || []),
    folders: kept,
    loadedPacks: union(remote.loadedPacks || [], local.loadedPacks || []),
  };
}
