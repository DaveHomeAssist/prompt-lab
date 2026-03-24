import seedData from '../data/promptlab-seed-libraries.json';
import { mergeLibraryEntries } from './libraryMatching.js';
import { createPromptEntry } from './promptSchema.js';
import { loadJson, saveJson } from './storage.js';
import { randomId } from './utils.js';

const LOADED_PACKS_KEY = 'pl2-loaded-packs';

/**
 * Transform a seed prompt into a Prompt Lab library entry.
 */
function seedToEntry(prompt, library, loadedAt) {
  return createPromptEntry({
    id: randomId(),
    title: prompt.title || 'Untitled',
    original: prompt.prompt || '',
    enhanced: prompt.prompt || '',
    variants: [],
    notes: `Starter prompt from ${library.name}.`,
    tags: Array.isArray(prompt.tags) && prompt.tags.length > 0 ? prompt.tags : ['Other'],
    collection: library.name,
    useCount: 0,
    versions: [],
    testCases: [],
    metadata: {
      source: 'starter-library',
      packId: library.id,
      packName: library.name,
      packLoadedAt: loadedAt,
      seedPromptId: prompt.id || '',
      category: prompt.category || null,
    },
  }, { now: loadedAt });
}

function prioritizeCollection(currentCollections, nextCollection) {
  return [nextCollection, ...currentCollections.filter((collection) => collection !== nextCollection)];
}

/**
 * Get the list of already-loaded pack IDs.
 */
export function getLoadedPacks() {
  const stored = loadJson(LOADED_PACKS_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

/**
 * Get all available starter libraries with their loaded status.
 */
export function getStarterLibraries() {
  const loaded = new Set(getLoadedPacks());
  return (seedData.libraries || [])
    .filter(lib => Array.isArray(lib.prompts) && lib.prompts.length > 0)
    .map(lib => ({
      id: lib.id,
      name: lib.name,
      description: lib.description || '',
      icon: lib.icon || '',
      promptCount: lib.prompts.length,
      loaded: loaded.has(lib.id),
    }));
}

/**
 * Load a starter pack into the library.
 *
 * @param {string} packId - The pack ID to load
 * @param {Array} currentLibrary - Current library entries
 * @param {Array} currentCollections - Current collections
 * @returns {{ count: number, collection: string, library: Array<object>, collections: Array<string> } | null} Result or null if skipped
 */
export function loadStarterPack(packId, currentLibrary, currentCollections) {
  // 1. Locate pack in seed data
  const pack = (seedData.libraries || []).find(lib => lib.id === packId);
  if (!pack || !Array.isArray(pack.prompts) || pack.prompts.length === 0) return null;

  const loadedAt = new Date().toISOString();

  // 2. Check if already loaded
  const loadedPacks = getLoadedPacks();
  if (loadedPacks.includes(packId)) return null;

  // 3. Build set of existing seed prompt IDs for duplicate protection
  const existingSeeds = new Set();
  for (const entry of currentLibrary) {
    const meta = entry.metadata;
    if (meta && meta.packId === packId && meta.seedPromptId) {
      existingSeeds.add(meta.seedPromptId);
    }
  }

  // 4. Transform prompts, skipping duplicates
  const newEntries = [];
  for (const prompt of pack.prompts) {
    if (prompt.id && existingSeeds.has(prompt.id)) continue;
    const entry = seedToEntry(prompt, pack, loadedAt);
    if (entry) newEntries.push(entry);
  }

  const collections = prioritizeCollection(currentCollections, pack.name);
  const mergeResult = mergeLibraryEntries(currentLibrary, newEntries, { prepend: true });

  if (mergeResult.importedCount === 0) {
    // All prompts already exist — just mark as loaded
    saveJson(LOADED_PACKS_KEY, [...loadedPacks, packId]);
    return { count: 0, collection: pack.name, library: currentLibrary, collections };
  }

  // 7. Update loaded packs
  saveJson(LOADED_PACKS_KEY, [...loadedPacks, packId]);

  return {
    count: mergeResult.importedCount,
    collection: pack.name,
    library: mergeResult.library,
    collections,
  };
}
