import { beforeEach, describe, expect, it } from 'vitest';
import seedData from '../data/promptlab-seed-libraries.json';
import { createPromptEntry } from '../lib/promptSchema.js';
import {
  getLoadedPacks,
  getStarterLibraries,
  loadStarterPack,
} from '../lib/seedTransform.js';

describe('seedTransform', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // getLoadedPacks
  // ────────────────────────────────────────────────────────────────────────────
  describe('getLoadedPacks', () => {
    it('returns empty array when nothing stored', () => {
      expect(getLoadedPacks()).toEqual([]);
    });

    it('returns stored array', () => {
      localStorage.setItem('pl2-loaded-packs', JSON.stringify(['pack-1', 'pack-2']));
      expect(getLoadedPacks()).toEqual(['pack-1', 'pack-2']);
    });

    it('returns empty array when stored value is not an array', () => {
      localStorage.setItem('pl2-loaded-packs', JSON.stringify('not-an-array'));
      expect(getLoadedPacks()).toEqual([]);
    });

    it('returns empty array when stored JSON is invalid', () => {
      localStorage.setItem('pl2-loaded-packs', 'invalid json');
      expect(getLoadedPacks()).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // getStarterLibraries
  // ────────────────────────────────────────────────────────────────────────────
  describe('getStarterLibraries', () => {
    it('returns all libraries from seed data', () => {
      const libraries = getStarterLibraries();
      expect(libraries.length).toBeGreaterThan(0);
      libraries.forEach((lib) => {
        expect(lib).toHaveProperty('id');
        expect(lib).toHaveProperty('name');
        expect(lib).toHaveProperty('description');
        expect(lib).toHaveProperty('promptCount');
        expect(lib).toHaveProperty('loaded');
        expect(typeof lib.loaded).toBe('boolean');
      });
    });

    it('marks loaded packs correctly', () => {
      const allLibs = getStarterLibraries();
      if (allLibs.length === 0) return; // skip if no seed data
      const firstId = allLibs[0].id;
      localStorage.setItem('pl2-loaded-packs', JSON.stringify([firstId]));
      const after = getStarterLibraries();
      expect(after.find((l) => l.id === firstId).loaded).toBe(true);
      after.filter((l) => l.id !== firstId).forEach((l) => {
        expect(l.loaded).toBe(false);
      });
    });

    // Bug #3: getStarterLibraries ignores its argument — always reads localStorage
    it('ignores passed argument and reads localStorage directly (documents Bug #3)', () => {
      const allLibs = getStarterLibraries();
      if (allLibs.length === 0) return;
      const firstId = allLibs[0].id;
      // Pass a loaded pack ID as argument — function should use it but doesn't
      const result = getStarterLibraries([firstId]);
      // The function ignores the argument, so it reads from localStorage
      // which doesn't have the pack loaded yet
      expect(result.find((l) => l.id === firstId).loaded).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // loadStarterPack
  // ────────────────────────────────────────────────────────────────────────────
  describe('loadStarterPack', () => {
    it('returns null for non-existent pack', () => {
      expect(loadStarterPack('nonexistent', [], [])).toBeNull();
    });

    it('returns null for already-loaded pack', () => {
      const pack = seedData.libraries[0];
      localStorage.setItem('pl2-loaded-packs', JSON.stringify([pack.id]));
      expect(loadStarterPack(pack.id, [], [])).toBeNull();
    });

    it('loads a pack and returns correct result shape', () => {
      const pack = seedData.libraries[0];
      const result = loadStarterPack(pack.id, [], []);
      expect(result).not.toBeNull();
      expect(result).toHaveProperty('count');
      expect(result).toHaveProperty('collection');
      expect(result).toHaveProperty('library');
      expect(result).toHaveProperty('collections');
      expect(result.count).toBeGreaterThan(0);
      expect(result.collection).toBe(pack.name);
      expect(Array.isArray(result.library)).toBe(true);
      expect(Array.isArray(result.collections)).toBe(true);
    });

    it('marks pack as loaded in localStorage after load', () => {
      const pack = seedData.libraries[0];
      loadStarterPack(pack.id, [], []);
      expect(getLoadedPacks()).toContain(pack.id);
    });

    it('creates entries with correct metadata', () => {
      const pack = seedData.libraries[0];
      const result = loadStarterPack(pack.id, [], []);
      const loadedEntries = result.library.filter(
        (e) => e.metadata?.packId === pack.id
      );
      expect(loadedEntries.length).toBeGreaterThan(0);
      loadedEntries.forEach((entry) => {
        expect(entry.metadata.source).toBe('starter-library');
        expect(entry.metadata.packName).toBe(pack.name);
        expect(entry.collection).toBe(pack.name);
      });
    });

    it('skips prompts that already exist by seed ID', () => {
      const pack = seedData.libraries[0];
      const firstPrompt = pack.prompts[0];
      const existingEntry = createPromptEntry({
        id: 'existing-1',
        title: firstPrompt.title,
        original: firstPrompt.prompt,
        enhanced: firstPrompt.prompt,
        metadata: { packId: pack.id, seedPromptId: firstPrompt.id },
      });
      const result = loadStarterPack(pack.id, [existingEntry], []);
      expect(result.count).toBeLessThan(pack.prompts.length);
    });

    it('prioritizes new collection in the collections list', () => {
      const pack = seedData.libraries[0];
      const result = loadStarterPack(pack.id, [], ['Existing Col']);
      expect(result.collections[0]).toBe(pack.name);
      expect(result.collections).toContain('Existing Col');
    });

    it('handles loading multiple packs sequentially', () => {
      if (seedData.libraries.length < 2) return;
      const pack1 = seedData.libraries[0];
      const pack2 = seedData.libraries[1];

      const result1 = loadStarterPack(pack1.id, [], []);
      expect(result1).not.toBeNull();

      const result2 = loadStarterPack(pack2.id, result1.library, result1.collections);
      expect(result2).not.toBeNull();
      expect(result2.library.length).toBeGreaterThan(result1.library.length);
      expect(getLoadedPacks()).toContain(pack1.id);
      expect(getLoadedPacks()).toContain(pack2.id);
    });
  });
});
