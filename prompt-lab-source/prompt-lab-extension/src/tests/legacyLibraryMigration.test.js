import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { createPromptEntry } from '../lib/promptSchema.js';
import {
  getLibraryEntrySignature,
  isSeedOnlyLibrary,
  mergeCollections,
  mergeLibraryEntries,
  parseLegacyLibraryPayload,
} from '../lib/legacyLibraryMigration.js';

describe('legacyLibraryMigration', () => {
  it('detects a seed-only library', () => {
    expect(isSeedOnlyLibrary(DEFAULT_LIBRARY_SEEDS)).toBe(true);
  });

  it('merges legacy libraries without duplicating shared prompts', () => {
    const duplicateSeed = createPromptEntry({
      ...DEFAULT_LIBRARY_SEEDS[0],
      title: DEFAULT_LIBRARY_SEEDS[0].title,
      original: DEFAULT_LIBRARY_SEEDS[0].original,
      enhanced: DEFAULT_LIBRARY_SEEDS[0].original,
    });
    const legacyOnly = createPromptEntry({
      title: 'Recovered Prompt',
      original: 'Recovered original',
      enhanced: 'Recovered enhanced',
      collection: 'Recovered',
    });

    const result = mergeLibraryEntries(DEFAULT_LIBRARY_SEEDS, [duplicateSeed, legacyOnly]);

    expect(result.importedCount).toBe(1);
    expect(result.library.some((entry) => entry.title === 'Recovered Prompt')).toBe(true);
  });

  it('builds stable signatures for equivalent entries', () => {
    const left = createPromptEntry({
      title: 'Prompt Alpha',
      original: 'Alpha body',
      enhanced: 'Alpha body',
    });
    const right = createPromptEntry({
      title: 'Prompt Alpha',
      original: 'Alpha body',
      enhanced: 'Alpha body',
    });

    expect(getLibraryEntrySignature(left)).toBe(getLibraryEntrySignature(right));
  });

  it('dedupes merged collections', () => {
    expect(mergeCollections(['Ops', 'Launch'], ['Launch', 'Recovered', ''])).toEqual(['Ops', 'Launch', 'Recovered']);
  });

  it('parses valid bridge payloads only', () => {
    expect(parseLegacyLibraryPayload({ type: 'wrong' })).toBeNull();
    expect(parseLegacyLibraryPayload({
      type: 'pl2:legacy-library-payload',
      library: [{ title: 'Recovered Prompt', original: 'body', enhanced: 'body' }],
      collections: ['Recovered'],
      sourceOrigin: 'https://prompt-lab-tawny.vercel.app',
    })).toEqual({
      library: [{ title: 'Recovered Prompt', original: 'body', enhanced: 'body' }],
      collections: ['Recovered'],
      sourceOrigin: 'https://prompt-lab-tawny.vercel.app',
    });
  });
});
