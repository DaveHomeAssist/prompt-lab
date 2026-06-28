import { beforeEach, describe, expect, it } from 'vitest';
import seedData from '../data/promptlab-seed-libraries.json';
import { getStarterLibraries } from '../lib/seedTransform.js';

describe('starter library seed data', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('matches the production starter-library contract', () => {
    const libraries = seedData.libraries || [];
    const promptIds = libraries.flatMap((library) =>
      (library.prompts || []).map((prompt) => prompt.id),
    );
    const totalPrompts = libraries.reduce(
      (total, library) => total + (library.prompts || []).length,
      0,
    );
    const streamDeck = libraries.find((library) => library.id === 'lib_stream_deck');

    expect(getStarterLibraries()).toHaveLength(8);
    expect(totalPrompts).toBe(74);
    expect(new Set(promptIds).size).toBe(promptIds.length);
    expect(libraries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'lib_stream_deck',
        name: 'Stream Deck',
        prompt_count: 0,
        prompts: [],
      }),
    ]));
    expect(streamDeck?.prompts).toHaveLength(0);

    for (const library of libraries) {
      expect(library.prompt_count).toBe((library.prompts || []).length);
    }
  });
});
