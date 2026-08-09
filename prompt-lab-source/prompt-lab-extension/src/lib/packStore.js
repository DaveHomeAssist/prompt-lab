/**
 * Pack registry — makes packs first-class objects instead of anonymous imports.
 *
 * The registry (pl2-packs) tracks pack identity and provenance; entry membership
 * is derived from entry.metadata.packId so registries can always be rebuilt from
 * the library itself (reconcilePacks).
 */
import { loadJson, saveJson, storageKeys } from './storage.js';
import { ensureString } from './utils.js';

export function loadPackRegistry() {
  const stored = loadJson(storageKeys.packs, {});
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
}

export function savePackRegistry(registry) {
  saveJson(storageKeys.packs, registry && typeof registry === 'object' ? registry : {});
}

export function upsertPack({ id, title, version = '1.0.0', source = 'imported' }) {
  const packId = ensureString(id).trim();
  if (!packId) return null;
  const registry = loadPackRegistry();
  const existing = registry[packId] || {};
  const record = {
    id: packId,
    title: ensureString(title).trim() || existing.title || packId,
    version: ensureString(version).trim() || existing.version || '1.0.0',
    source: ['starter', 'imported', 'authored'].includes(source) ? source : (existing.source || 'imported'),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  registry[packId] = record;
  savePackRegistry(registry);
  return record;
}

export function removePack(packId) {
  const registry = loadPackRegistry();
  const id = ensureString(packId).trim();
  if (!id || !registry[id]) return false;
  delete registry[id];
  savePackRegistry(registry);
  return true;
}

/**
 * Derive the pack list shown in the studio: every registry row plus any pack id
 * present on library entries that the registry does not know yet (e.g. starter
 * packs loaded before the registry existed).
 */
export function reconcilePacks(entries) {
  const registry = loadPackRegistry();
  const counts = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const packId = ensureString(entry?.metadata?.packId).trim();
    if (!packId) return;
    counts.set(packId, (counts.get(packId) || 0) + 1);
  });

  const rows = [];
  counts.forEach((entryCount, packId) => {
    const known = registry[packId];
    rows.push({
      id: packId,
      title: known?.title || packId,
      version: known?.version || '',
      source: known?.source || 'starter',
      entryCount,
    });
  });
  // Registry rows whose entries were all deleted still appear with a zero count
  // so the user can clean them up explicitly.
  Object.values(registry).forEach((record) => {
    if (!counts.has(record.id)) {
      rows.push({ ...record, entryCount: 0 });
    }
  });
  return rows.sort((left, right) => left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
}
