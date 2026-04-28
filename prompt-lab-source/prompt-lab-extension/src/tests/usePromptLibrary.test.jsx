import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { storageKeys } from '../lib/storage.js';

function makeEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry-1',
    title: overrides.title || 'Prompt Entry',
    original: overrides.original || 'Original body',
    enhanced: overrides.enhanced || overrides.original || 'Enhanced body',
    notes: overrides.notes || '',
    tags: overrides.tags || [],
    collection: overrides.collection || '',
    createdAt: overrides.createdAt || '2026-03-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt || overrides.createdAt || '2026-03-20T00:00:00.000Z',
    useCount: overrides.useCount || 0,
    versions: overrides.versions || [],
    variants: overrides.variants || [],
  };
}

describe('usePromptLibrary', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('filters by collection and tag, sorts by most used, and derives quick inject entries', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'Alpha', collection: 'Ops', tags: ['alpha'], useCount: 1 }),
      makeEntry({ id: 'entry-2', title: 'Bravo', collection: 'Ops', tags: ['alpha', 'beta'], useCount: 5 }),
      makeEntry({ id: 'entry-3', title: 'Charlie', collection: 'Launch', tags: ['beta'], useCount: 8 }),
      makeEntry({ id: 'entry-4', title: 'Delta', collection: 'Research', tags: ['gamma'], useCount: 3 }),
      makeEntry({ id: 'entry-5', title: 'Echo', collection: 'Research', tags: ['gamma'], useCount: 6 }),
      makeEntry({ id: 'entry-6', title: 'Foxtrot', collection: 'Ops', tags: ['delta'], useCount: 2 }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(6);
    });

    expect(result.current.collections).toEqual(['Ops', 'Launch', 'Research']);
    expect(result.current.allLibTags).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    expect(result.current.quickInject.map((entry) => entry.title)).toEqual(['Charlie', 'Echo', 'Bravo', 'Delta', 'Foxtrot']);

    act(() => {
      result.current.setActiveCollection('Ops');
      result.current.setActiveTag('alpha');
      result.current.setSortBy('most-used');
    });

    expect(result.current.filtered.map((entry) => entry.title)).toEqual(['Bravo', 'Alpha']);
    expect(localStorage.getItem(storageKeys.sortBy)).toBe(JSON.stringify('most-used'));
  });

  it('deleting a collection clears entry assignments and resets the active collection', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'Alpha', collection: 'Ops' }),
      makeEntry({ id: 'entry-2', title: 'Bravo', collection: 'Launch' }),
    ]));
    localStorage.setItem(storageKeys.collections, JSON.stringify(['Ops', 'Launch']));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
    });

    act(() => {
      result.current.setActiveCollection('Ops');
      result.current.deleteCollection('Ops');
    });

    expect(result.current.activeCollection).toBe(null);
    expect(result.current.collections).toEqual(['Launch']);
    expect(result.current.library.find((entry) => entry.id === 'entry-1')?.collection).toBe('');
    expect(result.current.library.find((entry) => entry.id === 'entry-2')?.collection).toBe('Launch');
    expect(notify).toHaveBeenCalledWith('Removed collection: Ops');
  });

  it('normalizes stored tags and canonicalizes known aliases', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'One', tags: ['code', 'CODING', ' Code '] }),
      makeEntry({ id: 'entry-2', title: 'Two', tags: ['analysis', 'ANALYTICAL'] }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
    });

    expect(result.current.library[0].tags).toEqual(['Code']);
    expect(result.current.library[1].tags).toEqual(['Analysis']);
    expect(result.current.allLibTags).toEqual(['Code', 'Analysis']);
  });
});
