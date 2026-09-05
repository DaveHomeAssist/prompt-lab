import { normalizeLibrary } from './promptSchema.js';
import { ensureString } from './utils.js';

function normalizePromptText(value) {
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

export function getLibraryEntrySignature(entry) {
  return promptHash(getLibraryEntryBody(entry));
}

export function mergeLibraryEntries(existingLibrary, incomingLibrary, options = {}) {
  const normalizedExisting = normalizeLibrary(existingLibrary);
  const normalizedIncoming = normalizeLibrary(incomingLibrary);
  const prepend = options?.prepend === true;
  const signatureToPromptId = new Map(
    normalizedExisting
      .map((entry) => [normalizePromptText(getLibraryEntryBody(entry)).toLowerCase(), entry.id])
      .filter(([signature, promptId]) => Boolean(signature && promptId)),
  );
  const promptIdMap = new Map();
  const imported = [];
  const usedIds = new Set([...normalizedExisting.map((entry) => entry.id), ...(options.blockedIds || [])]);

  normalizedIncoming.forEach((entry) => {
    // Confirm the whole canonical body; a short hash alone can collide.
    const signature = normalizePromptText(getLibraryEntryBody(entry)).toLowerCase();
    if (!signature) return;
    const survivingPromptId = signatureToPromptId.get(signature);
    if (survivingPromptId) {
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
    skippedCount: normalizedIncoming.length - imported.length,
    promptIdMap,
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
