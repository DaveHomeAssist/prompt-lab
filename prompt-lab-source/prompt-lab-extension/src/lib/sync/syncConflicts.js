// Conflict copies (docs/ACCOUNT_SYNC_DESIGN.md section 4): the server keeps the
// losing side of every conflict in sync_conflicts. Restoring one is a normal
// local edit of the prompt, so the next sync uploads it as the new live copy
// and the copy it replaces is itself kept as a conflict copy on the server.
import { applyRemoteRows } from './syncModel.js';

export const restoredKey = (userId) => `pl2-sync-restored:${userId}`;

// Conflict copies kept by syncs since the user last opened the list. Counted
// on the device from each sync's result, so showing it costs no extra reads.
export const unseenConflictsKey = (userId) => `pl2-sync-conflicts-unseen:${userId}`;
export function readUnseenConflicts(storage, userId) {
  const n = Number(storage.getItem(unseenConflictsKey(userId)));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function addUnseenConflicts(storage, userId, count) {
  const next = readUnseenConflicts(storage, userId) + Math.max(0, Number(count) || 0);
  if (next > 0) storage.setItem(unseenConflictsKey(userId), String(next));
  return next;
}
export function clearUnseenConflicts(storage, userId) { storage.removeItem(unseenConflictsKey(userId)); }

export function readRestoredConflictIds(storage, userId) {
  try {
    const list = JSON.parse(storage.getItem(restoredKey(userId)) || '[]');
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch { return new Set(); }
}

/** Short, display-only summary of a conflict copy. */
export function describeConflictCopy(copy) {
  const entry = copy?.losing_payload?.entry;
  if (copy?.kind === 'structure') return { title: 'Folders and collections', detail: 'Folder and collection layout from another device', restorable: false };
  if (copy?.losing_deleted || !entry) return { title: `Deleted prompt (${String(copy?.item_id || '').slice(0, 8)})`, detail: 'Another device deleted this prompt', restorable: false };
  const text = String(entry.enhanced || entry.original || '').replace(/\s+/g, ' ').trim();
  return { title: String(entry.title || 'Untitled prompt'), detail: text.slice(0, 140), restorable: true };
}

/**
 * Put a conflict copy back as the live prompt on this device.
 * Returns { written: string[] } (the storage keys changed).
 */
export function restoreConflictCopy(storage, userId, copy, { notifyWrite, now = () => Date.now() } = {}) {
  const entry = copy?.losing_payload?.entry;
  if (copy?.kind !== 'prompt' || copy?.losing_deleted || !entry || !copy.item_id) return { written: [] };
  const restored = { ...entry, id: copy.item_id, updatedAt: new Date(now()).toISOString() };
  const { written } = applyRemoteRows(storage, [{ kind: 'prompt', item_id: copy.item_id, payload: { state: 'active', entry: restored }, deleted: false, version: 0 }], { notifyWrite });
  const ids = readRestoredConflictIds(storage, userId);
  ids.add(String(copy.id));
  try { storage.setItem(restoredKey(userId), JSON.stringify([...ids].slice(-500))); } catch { /* display hint only */ }
  return { written };
}
