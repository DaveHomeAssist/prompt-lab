// Device-side safety net. Supabase Free has no automatic backups, so before
// the first sync merge (which may drop exact duplicates) and before any bulk
// apply, the engine copies the raw Library keys into one snapshot key. The
// snapshot can be downloaded as a file and restored on this device.
import { storageKeys } from '../storage.js';

export const SNAPSHOT_KEYS = [storageKeys.library, storageKeys.trash, storageKeys.collections, storageKeys.folders, storageKeys.loadedPacks];
export const snapshotKey = (userId) => `pl2-sync-snapshot:${userId}`;

export function takeLocalSnapshot(storage, userId, { reason, at = Date.now(), undoKeys = [] } = {}) {
  const data = {};
  for (const key of SNAPSHOT_KEYS) data[key] = storage.getItem(key);
  const snapshot = { format: 'prompt-lab-local-snapshot', version: 1, reason: String(reason || 'manual'), takenAt: new Date(at).toISOString(), data, undoKeys };
  try {
    storage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
    return snapshot;
  } catch {
    return null; // quota: the caller must then avoid anything destructive
  }
}

export function addSnapshotUndoKey(storage, userId, key) {
  const snapshot = readLocalSnapshot(storage, userId);
  if (!snapshot) return;
  snapshot.undoKeys = [...new Set([...(snapshot.undoKeys || []), key])];
  try { storage.setItem(snapshotKey(userId), JSON.stringify(snapshot)); } catch { /* best effort */ }
}

export function readLocalSnapshot(storage, userId) {
  try {
    const snapshot = JSON.parse(storage.getItem(snapshotKey(userId)) || 'null');
    return snapshot?.format === 'prompt-lab-local-snapshot' ? snapshot : null;
  } catch { return null; }
}

/** JSON text for a "Download backup" button. */
export const snapshotFileText = (snapshot) => JSON.stringify(snapshot, null, 2);

/**
 * Bring a snapshot (from this device or a downloaded file) back by merging:
 * prompts missing now are added back, and a snapshot copy replaces a current
 * one only if it is newer. Nothing current is ever removed, because a removal
 * here would sync to every device as a delete. Restored prompts are ordinary
 * local edits, so the next sync uploads them. Deletion markers the first-sync
 * merge wrote (undoKeys) are removed so the restored prompts show.
 */
export function restoreLocalSnapshot(storage, snapshot, { notifyWrite } = {}) {
  if (snapshot?.format !== 'prompt-lab-local-snapshot' || !snapshot.data) throw new Error('Not a Prompt Lab backup.');
  const parse = (value) => { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed : []; };
  const saved = {};
  for (const key of SNAPSHOT_KEYS) saved[key] = parse(snapshot.data[key]); // refuse a corrupt file before writing
  const current = (key) => { try { return parse(storage.getItem(key)); } catch { return []; } };
  const clock = (entry) => Date.parse(entry?.updatedAt || entry?.createdAt || 0) || 0;
  const written = [];
  const write = (key, value) => { storage.setItem(key, JSON.stringify(value)); notifyWrite?.(key); written.push(key); };

  for (const key of snapshot.undoKeys || []) {
    if (typeof key === 'string' && key.startsWith('pl2-library-deleted-batch:')) { storage.removeItem(key); notifyWrite?.(key); }
  }
  const library = current(storageKeys.library);
  const trash = current(storageKeys.trash);
  const byId = new Map([...library, ...trash].map((entry) => [entry.id, entry]));
  const nextLibrary = [...library];
  const nextTrash = [...trash];
  for (const [key, target] of [[storageKeys.library, nextLibrary], [storageKeys.trash, nextTrash]]) {
    for (const entry of saved[key]) {
      if (!entry?.id) continue;
      const existing = byId.get(entry.id);
      if (!existing) { target.push(entry); byId.set(entry.id, entry); continue; }
      if (clock(entry) > clock(existing)) {
        for (const list of [nextLibrary, nextTrash]) { const at = list.findIndex((item) => item.id === entry.id); if (at >= 0) list.splice(at, 1); }
        target.push(entry); byId.set(entry.id, entry);
      }
    }
  }
  write(storageKeys.library, nextLibrary);
  write(storageKeys.trash, nextTrash);
  const union = (key, idOf) => {
    const list = current(key);
    const ids = new Set(list.map(idOf));
    for (const item of saved[key]) if (!ids.has(idOf(item))) { list.push(item); ids.add(idOf(item)); }
    write(key, list);
  };
  union(storageKeys.collections, (item) => item);
  union(storageKeys.loadedPacks, (item) => item);
  // Folders: add back only folders whose id and path are free and whose parent exists.
  const folders = current(storageKeys.folders);
  const ids = new Set(folders.map((folder) => folder?.id));
  const paths = new Set(folders.map((folder) => folder?.collection));
  let added = true;
  while (added) {
    added = false;
    for (const folder of saved[storageKeys.folders]) {
      if (!folder?.id || ids.has(folder.id) || paths.has(folder.collection)) continue;
      if (folder.parentId && !ids.has(folder.parentId)) continue;
      folders.push(folder); ids.add(folder.id); paths.add(folder.collection); added = true;
    }
  }
  write(storageKeys.folders, folders);
  return [...new Set(written)];
}
