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
  const seen = new Set(normalizedExisting.map(getLibraryEntrySignature).filter(Boolean));
  const imported = [];

  normalizedIncoming.forEach((entry) => {
    const signature = getLibraryEntrySignature(entry);
    if (!signature || seen.has(signature)) return;
    seen.add(signature);
    imported.push(entry);
  });

  const merged = prepend
    ? [...imported, ...normalizedExisting]
    : [...normalizedExisting, ...imported];

  return {
    library: normalizeLibrary(merged),
    importedCount: imported.length,
    skippedCount: normalizedIncoming.length - imported.length,
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
