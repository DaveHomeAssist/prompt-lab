import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { LEGACY_LIBRARY_CHECK_KEY } from '../lib/legacyLibraryMigration.js';
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

function getStorageKeys() {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(Boolean);
}

function mockFileReaderResult(result) {
  const OriginalFileReader = globalThis.FileReader;
  globalThis.FileReader = class MockFileReader {
    readAsText() {
      this.onload?.({ target: { result } });
    }
  };
  return () => {
    globalThis.FileReader = OriginalFileReader;
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

  it('saving an existing prompt persists the updated entry immediately', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({
        id: 'entry-1',
        title: 'Alpha',
        original: 'Original text',
        enhanced: 'Enhanced text',
        tags: ['alpha'],
      }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(1);
    });

    let saved;
    act(() => {
      saved = result.current.doSave({
        raw: 'Updated original',
        enhanced: 'Updated enhanced',
        variants: [],
        notes: 'Updated notes',
        tags: ['alpha', 'beta'],
        title: 'Updated Alpha',
        collection: 'Ops',
        editingId: 'entry-1',
        changeNote: 'Refined wording',
      });
    });

    expect(saved).toEqual({ id: 'entry-1', title: 'Updated Alpha' });
    expect(result.current.library[0]).toMatchObject({
      id: 'entry-1',
      title: 'Updated Alpha',
      original: 'Updated original',
      enhanced: 'Updated enhanced',
      notes: 'Updated notes',
      collection: 'Ops',
      tags: ['alpha', 'beta'],
    });

    const persisted = JSON.parse(localStorage.getItem(storageKeys.library) || '[]');
    expect(persisted[0]).toMatchObject({
      id: 'entry-1',
      title: 'Updated Alpha',
      original: 'Updated original',
      enhanced: 'Updated enhanced',
      notes: 'Updated notes',
      collection: 'Ops',
      tags: ['alpha', 'beta'],
    });
    expect(notify).toHaveBeenCalledWith('Prompt updated!');
  });

  it('backs up corrupt library storage and notifies before loading fallback data', async () => {
    localStorage.setItem(storageKeys.library, '{broken');
    localStorage.setItem(LEGACY_LIBRARY_CHECK_KEY, JSON.stringify(true));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library.length).toBeGreaterThan(0);
    });

    const backupKey = getStorageKeys().find((key) => key.startsWith(`${storageKeys.library}:corrupt-backup:`));
    expect(backupKey).toBeTruthy();
    expect(localStorage.getItem(backupKey)).toBe('{broken');
    expect(notify).toHaveBeenCalledWith(
      'Recovered from unreadable local library data. A backup was saved before defaults were loaded.',
    );
  });

  it('does not report success when saving a missing prompt id', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({
        id: 'entry-1',
        title: 'Alpha',
        original: 'Original text',
        enhanced: 'Enhanced text',
      }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(1);
    });

    let saved;
    act(() => {
      saved = result.current.doSave({
        raw: 'Updated original',
        enhanced: 'Updated enhanced',
        variants: [],
        notes: '',
        tags: [],
        title: 'Missing Alpha',
        collection: '',
        editingId: 'missing-entry',
        changeNote: '',
      });
    });

    expect(saved).toBeNull();
    expect(result.current.library[0]).toMatchObject({
      id: 'entry-1',
      title: 'Alpha',
      original: 'Original text',
      enhanced: 'Enhanced text',
    });
    expect(notify).toHaveBeenCalledWith('Prompt update failed: the saved prompt no longer exists.');
    expect(notify).not.toHaveBeenCalledWith('Prompt updated!');
  });

  it('preserves a manual reorder when saving again before the next render', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'Alpha' }),
      makeEntry({ id: 'entry-2', title: 'Bravo' }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library.map((entry) => entry.title)).toEqual(['Alpha', 'Bravo']);
    });

    act(() => {
      result.current.moveLibraryEntry('entry-1', 'entry-2', 'after');
      result.current.doSave({
        raw: 'New prompt body',
        enhanced: 'New prompt body',
        variants: [],
        notes: '',
        tags: [],
        title: 'New Prompt',
        collection: '',
        editingId: '',
        changeNote: '',
      });
    });

    expect(result.current.library.map((entry) => entry.title)).toEqual(['New Prompt', 'Bravo', 'Alpha']);
  });

  it('reports imported, duplicate, and invalid prompt counts', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'Existing', enhanced: 'Duplicate body' }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(1);
    });

    const restoreFileReader = mockFileReaderResult(JSON.stringify([
      { id: 'duplicate', title: 'Duplicate', enhanced: 'Duplicate body' },
      { id: 'fresh', title: 'Fresh', enhanced: 'Fresh body', collection: 'Imported' },
      { id: 'invalid', title: 'Invalid', enhanced: '' },
    ]));
    const event = { target: { files: [{ size: 512 }], value: 'selected.json' } };

    try {
      act(() => {
        result.current.importLib(event);
      });
    } finally {
      restoreFileReader();
    }

    expect(result.current.library.map((entry) => entry.title)).toEqual(['Fresh', 'Existing']);
    expect(result.current.collections).toContain('Imported');
    expect(event.target.value).toBe('');
    expect(notify).toHaveBeenCalledWith('Imported 1 prompt, skipped 1 duplicate, rejected 1 invalid record.');
  });

  it('reports malformed import JSON directly', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([]));
    localStorage.setItem(LEGACY_LIBRARY_CHECK_KEY, JSON.stringify(true));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
    });

    const restoreFileReader = mockFileReaderResult('{broken');
    const event = { target: { files: [{ size: 128 }], value: 'selected.json' } };

    try {
      act(() => {
        result.current.importLib(event);
      });
    } finally {
      restoreFileReader();
    }

    expect(event.target.value).toBe('');
    expect(notify).toHaveBeenCalledWith('Import failed: file is not valid JSON.');
  });

  it('keeps recent-access tracking from throwing when anticipation storage fails', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({ id: 'entry-1', title: 'Alpha' }),
    ]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(1);
    });

    const originalSetItem = Storage.prototype.setItem;
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItemMock(key, value) {
      if (key === 'pl2-anticipation') throw new Error('storage unavailable');
      return originalSetItem.call(this, key, value);
    });

    try {
      act(() => {
        expect(() => result.current.trackRecentAccess('entry-1')).not.toThrow();
      });
    } finally {
      setItem.mockRestore();
    }

    expect(result.current.library[0]?.lastAccessedAt).toEqual(expect.any(String));
  });
});
