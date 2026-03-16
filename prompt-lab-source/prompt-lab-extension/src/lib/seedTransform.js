import seedData from '../data/promptlab-seed-libraries.json';
import { createPromptEntry } from './promptSchema.js';
import { loadJson, saveJson } from './storage.js';
import { randomId } from './utils.js';

const LOADED_PACKS_KEY = 'pl2-loaded-packs';

/**
 * Transform a seed prompt into a Prompt Lab library entry.
 */
function seedToEntry(prompt, library) {
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
      seedPromptId: prompt.id || '',
      category: prompt.category || null,
    },
  });
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
 * @param {function} setLibrary - State setter for library
 * @param {Array} currentCollections - Current collections
 * @param {function} setCollections - State setter for collections
 * @returns {{ count: number, collection: string } | null} Result or null if skipped
 */
export function loadStarterPack(packId, currentLibrary, setLibrary, currentCollections, setCollections) {
  // 1. Locate pack in seed data
  const pack = (seedData.libraries || []).find(lib => lib.id === packId);
  if (!pack || !Array.isArray(pack.prompts) || pack.prompts.length === 0) return null;

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
    const entry = seedToEntry(prompt, pack);
    if (entry) newEntries.push(entry);
  }

  if (newEntries.length === 0) {
    // All prompts already exist — just mark as loaded
    saveJson(LOADED_PACKS_KEY, [...loadedPacks, packId]);
    return { count: 0, collection: pack.name };
  }

  // 5. Merge: new prompts first
  setLibrary(prev => [...newEntries, ...prev]);

  // 6. Add collection
  setCollections(prev => [...new Set([...prev, pack.name])]);

  // 7. Update loaded packs
  saveJson(LOADED_PACKS_KEY, [...loadedPacks, packId]);

  return { count: newEntries.length, collection: pack.name };
}
