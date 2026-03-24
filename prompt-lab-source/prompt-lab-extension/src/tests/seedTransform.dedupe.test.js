import { beforeEach, describe, expect, it } from 'vitest';
import seedData from '../data/promptlab-seed-libraries.json';
import { createPromptEntry } from '../lib/promptSchema.js';
import { getLoadedPacks, loadStarterPack } from '../lib/seedTransform.js';

describe('loadStarterPack dedupe', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('skips starter prompts whose body already exists in the library', () => {
    const pack = seedData.libraries[0];
    const duplicateBody = pack.prompts[0].prompt;
    const existingLibrary = [
      createPromptEntry({
        id: 'custom-duplicate',
        title: 'Custom duplicate',
        original: duplicateBody,
        enhanced: duplicateBody,
        collection: 'Custom',
      }, { now: '2026-03-20T00:00:00.000Z' }),
    ];

    const result = loadStarterPack(pack.id, existingLibrary, ['Custom']);

    expect(result).not.toBeNull();
    expect(result.count).toBeLessThan(pack.prompts.length);
    expect(result.library.filter((entry) => entry.enhanced === duplicateBody)).toHaveLength(1);
    expect(getLoadedPacks()).toContain(pack.id);
  });
});
