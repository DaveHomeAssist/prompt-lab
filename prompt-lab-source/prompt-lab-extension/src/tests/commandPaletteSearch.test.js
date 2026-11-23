import { describe, expect, it, vi } from 'vitest';
import { buildPaletteCatalog, fuzzyScore, searchPaletteItems } from '../lib/commandPaletteSearch.js';

describe('fuzzyScore', () => {
  it('ranks a contiguous label hit above a sparse subsequence', () => {
    const contiguous = fuzzyScore('brief', 'Quarterly briefing\nnotes');
    const sparse = fuzzyScore('qbrf', 'Quarterly briefing\nnotes');
    expect(contiguous).toBeGreaterThan(0);
    expect(sparse).toBeGreaterThan(0);
    expect(contiguous).toBeGreaterThan(sparse);
  });

  it('rejects a query whose letters are out of order', () => {
    expect(fuzzyScore('zzzz', 'Open Scratch')).toBe(0);
  });
});

describe('searchPaletteItems', () => {
  const openLibrary = vi.fn();
  const openDensity = vi.fn();
  const catalog = buildPaletteCatalog({
    actions: [
      { label: 'Open Scratch', hint: 'Alt+6', action: vi.fn() },
      { label: 'Enhance Prompt', action: vi.fn() },
    ],
    prompts: [
      { id: 'brief', title: 'Quarterly briefing', enhanced: 'Write the customer briefing.', tags: ['finance'], action: openLibrary },
    ],
    settings: [
      { label: 'Setting: Density', keywords: 'compact comfortable spacious', action: openDensity },
    ],
  });

  it('searches prompts, actions, and settings, including a fuzzy prompt title', () => {
    expect(searchPaletteItems(catalog, 'scratch').map((item) => item.label)).toEqual(['Open Scratch']);
    expect(searchPaletteItems(catalog, 'brif').map((item) => item.label)).toContain('Quarterly briefing');
    expect(searchPaletteItems(catalog, 'dens').map((item) => item.label)).toEqual(['Setting: Density']);
    expect(searchPaletteItems(catalog, 'zzzz')).toEqual([]);
  });

  it('lists actions, a few prompts, and settings before a query is typed', () => {
    const labels = searchPaletteItems(catalog, '').map((item) => item.kind);
    expect(labels).toEqual(['action', 'action', 'prompt', 'setting']);
  });

  it('runs the matched prompt', () => {
    searchPaletteItems(catalog, 'brief')[0].action();
    expect(openLibrary).toHaveBeenCalledTimes(1);
  });
});
