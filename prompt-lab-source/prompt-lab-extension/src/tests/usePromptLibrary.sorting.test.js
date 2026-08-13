import { describe, expect, it } from 'vitest';
import { getNewestSortTimestamp, sortLibraryEntries } from '../hooks/usePromptLibrary.js';

function makeEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry-1',
    title: overrides.title || 'Entry',
    collection: overrides.collection || '',
    useCount: overrides.useCount || 0,
    createdAt: overrides.createdAt || '2026-03-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt || overrides.createdAt || '2026-03-20T00:00:00.000Z',
    metadata: overrides.metadata || {},
  };
}

describe('usePromptLibrary sorting helpers', () => {
  it('prefers the latest timestamp when packLoadedAt is newer than updatedAt', () => {
    const entry = makeEntry({
      updatedAt: '2026-03-20T00:00:00.000Z',
      metadata: { packLoadedAt: '2026-03-24T12:00:00.000Z' },
    });

    expect(getNewestSortTimestamp(entry)).toBe(Date.parse('2026-03-24T12:00:00.000Z'));
  });

  it('ignores absent and invalid timestamps', () => {
    const entry = {
      metadata: { packLoadedAt: '' },
      updatedAt: 'not-a-date',
      updated_at: null,
      createdAt: '1999-12-31T00:00:00.000Z',
    };

    expect(getNewestSortTimestamp(entry)).toBe(Date.parse('1999-12-31T00:00:00.000Z'));
    expect(getNewestSortTimestamp({ metadata: { packLoadedAt: '' } })).toBe(0);
  });

  it('sorts newest by most recent effective timestamp', () => {
    const older = makeEntry({
      id: 'older',
      title: 'Older',
      updatedAt: '2026-03-20T00:00:00.000Z',
    });
    const loadedLater = makeEntry({
      id: 'loaded-later',
      title: 'Loaded later',
      updatedAt: '2026-03-20T00:00:00.000Z',
      metadata: { packLoadedAt: '2026-03-24T12:00:00.000Z' },
    });

    const sorted = sortLibraryEntries([older, loadedLater], 'newest');
    expect(sorted.map((entry) => entry.id)).toEqual(['loaded-later', 'older']);
  });

  it('uses entry id as a deterministic fallback for equal effective timestamps', () => {
    const zeta = makeEntry({
      id: 'zeta',
      updatedAt: '2026-03-24T12:00:00.000Z',
      createdAt: '2026-03-23T00:00:00.000Z',
    });
    const alpha = makeEntry({
      id: 'alpha',
      updatedAt: '2026-03-24T12:00:00.000Z',
      createdAt: '2026-03-20T00:00:00.000Z',
    });

    const sorted = sortLibraryEntries([zeta, alpha], 'newest');
    expect(sorted.map((entry) => entry.id)).toEqual(['alpha', 'zeta']);
  });

  it('sorts grouped entries by collection then title', () => {
    const alpha = makeEntry({ id: 'alpha', title: 'Alpha', collection: 'Research' });
    const zeta = makeEntry({ id: 'zeta', title: 'Zeta', collection: 'Research' });
    const ungrouped = makeEntry({ id: 'ungrouped', title: 'Ungrouped', collection: '' });

    const sorted = sortLibraryEntries([ungrouped, zeta, alpha], 'group');
    expect(sorted.map((entry) => entry.id)).toEqual(['alpha', 'zeta', 'ungrouped']);
  });
});
