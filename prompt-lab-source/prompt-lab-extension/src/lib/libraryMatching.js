import { normalizeLibrary, updatePromptEntry, arePromptSnapshotsEqual } from './promptSchema.js';
import { ensureString } from './utils.js';

export function normalizePromptText(value) {
  return ensureString(value).replace(/\s+/g, ' ').trim();
}

function promptHash(value) {
  const text = normalizePromptText(value).toLowerCase();
  if (!text) return '';
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(16);
}

function getLibraryEntryBody(entry) {
  return ensureString(entry?.enhanced) || ensureString(entry?.original) || ensureString(entry?.prompt);
}

export function getLibraryEntryCanonicalBody(entry) {
  return normalizePromptText(getLibraryEntryBody(entry)).toLowerCase();
}

export function getLibraryEntrySignature(entry) {
  return promptHash(getLibraryEntryBody(entry));
}

export function mergeLibraryEntries(existingLibrary, incomingLibrary, options = {}) {
  const normalizedExisting = normalizeLibrary(existingLibrary);
  const normalizedIncoming = normalizeLibrary(incomingLibrary);
  const prepend = options?.prepend === true;
  const signatureToPromptId = new Map(
    normalizedExisting
      .map((entry) => [getLibraryEntryCanonicalBody(entry), entry.id])
      .filter(([signature, promptId]) => Boolean(signature && promptId)),
  );
  const promptIdMap = new Map();
  const imported = [];
  const replacedIds = new Set();
  const excludedIds = new Set();
  const usedIds = new Set([...normalizedExisting.map((entry) => entry.id), ...(options.blockedIds || [])]);

  normalizedIncoming.forEach((entry) => {
    // Confirm the whole canonical body; a short hash alone can collide.
    const signature = getLibraryEntryCanonicalBody(entry);
    if (!signature) return;
    const survivingPromptId = signatureToPromptId.get(signature);
    const decision = options.resolutions?.[entry.id];
    if (decision?.action === 'skip' && !survivingPromptId) {
      excludedIds.add(entry.id);
      return;
    }
    if (decision?.action === 'replace') {
      const targetId = decision.targetSource === 'incoming' ? promptIdMap.get(decision.existingId) : decision.existingId;
      const target = normalizedExisting.find(row => row.id === targetId)
        || imported.find(row => row.id === targetId);
      if (!target) throw new Error('The selected replacement target is no longer available.');
      if (replacedIds.has(target.id)) throw new Error('Choose only one incoming replacement for each existing prompt.');
      const updated = updatePromptEntry(target, { ...entry, tombstoneVersion: target.tombstoneVersion, deletedAt: target.deletedAt }, { source: 'workspace_import' });
      for (const version of entry.versions) {
        const sameId = updated.versions.find(row => row.id === version.id);
        if (sameId && arePromptSnapshotsEqual(sameId, version)) continue;
        updated.versions.push({ ...version, id: sameId || version.id === updated.currentVersionId ? crypto.randomUUID() : version.id });
      }
      const rows = normalizedExisting.includes(target) ? normalizedExisting : imported;
      rows[rows.indexOf(target)] = updated;
      signatureToPromptId.delete(getLibraryEntryCanonicalBody(target));
      signatureToPromptId.set(signature, target.id);
      promptIdMap.set(entry.id, target.id);
      replacedIds.add(target.id);
      return;
    }
    if (survivingPromptId && decision?.action !== 'keep') {
      if (entry.id) promptIdMap.set(entry.id, survivingPromptId);
      return;
    }
    const id = usedIds.has(entry.id) ? crypto.randomUUID() : entry.id;
    usedIds.add(id);
    signatureToPromptId.set(signature, id);
    if (entry.id) promptIdMap.set(entry.id, id);
    imported.push({ ...entry, id });
  });

  const merged = prepend
    ? [...imported, ...normalizedExisting]
    : [...normalizedExisting, ...imported];

  return {
    library: normalizeLibrary(merged),
    importedCount: imported.length,
    skippedCount: normalizedIncoming.length - imported.length - replacedIds.size,
    promptIdMap,
    replacedIds,
    excludedIds,
    replacedCount: replacedIds.size,
  };
}

export function matchesLibrarySearch(entry, rawQuery = '') {
  const query = ensureString(rawQuery).trim().toLowerCase();
  if (!query) return true;

  const fields = [
    entry?.title,
    entry?.collection,
    entry?.notes,
    entry?.original,
    entry?.enhanced,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
  ];

  return fields.some((value) => ensureString(value).toLowerCase().includes(query));
}
