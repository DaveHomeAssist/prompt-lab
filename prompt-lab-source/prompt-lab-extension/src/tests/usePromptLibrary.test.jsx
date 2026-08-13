import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKeys } from '../lib/storage.js';

const legacyBridgeMocks = vi.hoisted(() => ({
  requestLegacyLibraryPayload: vi.fn(),
  shouldAttemptLegacyWebMigration: vi.fn(() => true),
}));

vi.mock('../lib/legacyLibraryMigration.js', async () => {
  const actual = await vi.importActual('../lib/legacyLibraryMigration.js');
  return {
    ...actual,
    requestLegacyLibraryPayload: legacyBridgeMocks.requestLegacyLibraryPayload,
    shouldAttemptLegacyWebMigration: legacyBridgeMocks.shouldAttemptLegacyWebMigration,
  };
});

import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { LEGACY_LIBRARY_CHECK_KEY } from '../lib/legacyLibraryMigration.js';

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
    legacyBridgeMocks.requestLegacyLibraryPayload.mockReset();
    legacyBridgeMocks.shouldAttemptLegacyWebMigration.mockReset();
    legacyBridgeMocks.shouldAttemptLegacyWebMigration.mockReturnValue(true);
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

  it('saves a deleted loaded prompt once as a new entry and preserves its metadata', async () => {
    const sourceEntry = {
      ...makeEntry({
        id: 'deleted-entry',
        title: 'Deleted Source',
        tags: ['alpha'],
        collection: 'Ops',
        variants: [{ label: 'Original variant', content: 'Original variant body' }],
      }),
      metadata: { owner: 'Dave', purpose: 'Recovery' },
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
      testCases: [{
        id: 'case-1',
        name: 'Recovery case',
        input: 'Test recovery',
        expectedTraits: ['safe'],
        exclusions: [],
        notes: '',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
      }],
    };
    localStorage.setItem(storageKeys.library, JSON.stringify([sourceEntry]));

    const notify = vi.fn();
    const first = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(first.result.current.libReady).toBe(true));
    const loadedSource = first.result.current.library[0];

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => first.result.current.del(sourceEntry.id));

    let saved;
    act(() => {
      saved = first.result.current.doSave({
        raw: 'Recovered raw',
        enhanced: 'Recovered enhanced',
        variants: [{ label: 'Recovered variant', content: 'Recovered variant body' }],
        notes: 'Recovered notes',
        tags: ['alpha', 'beta'],
        title: 'Recovered prompt',
        collection: 'Recovered',
        editingId: sourceEntry.id,
        changeNote: 'Recover deleted prompt',
        sourceEntry: loadedSource,
      });
    });

    expect(saved).toEqual(expect.objectContaining({ savedAsNew: true }));
    expect(saved.id).not.toBe(sourceEntry.id);
    expect(first.result.current.library).toHaveLength(1);
    expect(first.result.current.library[0]).toEqual(expect.objectContaining({
      id: saved.id,
      title: 'Recovered prompt',
      original: 'Recovered raw',
      enhanced: 'Recovered enhanced',
      notes: 'Recovered notes',
      tags: ['alpha', 'beta'],
      collection: 'Recovered',
      metadata: expect.objectContaining({ owner: 'Dave', purpose: 'Recovery' }),
    }));
    expect(first.result.current.library[0].inputs).toHaveLength(1);
    expect(first.result.current.library[0].testCases).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('The original prompt was deleted. Saved this draft as a new prompt.');
    expect(notify).not.toHaveBeenCalledWith('Prompt updated!');

    const persisted = JSON.parse(localStorage.getItem(storageKeys.library));
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(saved.id);

    first.unmount();
    const second = renderHook(() => usePromptLibrary(vi.fn()));
    await waitFor(() => expect(second.result.current.libReady).toBe(true));
    expect(second.result.current.library).toHaveLength(1);
    expect(second.result.current.library[0]).toEqual(expect.objectContaining({
      id: saved.id,
      enhanced: 'Recovered enhanced',
      collection: 'Recovered',
    }));
  });

  it('persists an ID-less deleted source with explicit recovery feedback', async () => {
    const sourceEntry = {
      ...makeEntry({ id: 'deleted-source', title: 'Deleted Source' }),
      metadata: { owner: 'Dave', purpose: 'Delete recovery' },
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
    };
    localStorage.setItem(storageKeys.library, JSON.stringify([]));
    localStorage.setItem(LEGACY_LIBRARY_CHECK_KEY, JSON.stringify(true));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(result.current.libReady).toBe(true));

    let saved;
    act(() => {
      saved = result.current.doSave({
        raw: 'Recovered raw',
        enhanced: 'Recovered enhanced',
        variants: [],
        notes: 'Recovered notes',
        tags: ['safe'],
        title: 'Recovered prompt',
        collection: 'Recovered',
        editingId: null,
        changeNote: '',
        sourceEntry: { ...sourceEntry, id: null },
        savedFromDeletedTarget: true,
      });
    });

    expect(saved).toEqual(expect.objectContaining({ savedAsNew: true }));
    expect(result.current.library[0]).toEqual(expect.objectContaining({
      id: saved.id,
      original: 'Recovered raw',
      enhanced: 'Recovered enhanced',
      metadata: expect.objectContaining({ owner: 'Dave', purpose: 'Delete recovery' }),
    }));
    expect(result.current.library[0].inputs).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(storageKeys.library))[0].id).toBe(saved.id);
    expect(notify).toHaveBeenCalledWith('The original prompt was deleted. Saved this draft as a new prompt.');
  });

  it('restores a version only after the library write succeeds', async () => {
    const entry = makeEntry({
      id: 'versioned-entry',
      original: 'Current raw',
      enhanced: 'Current enhanced',
      notes: 'Current notes',
      versions: [{
        id: 'version-1',
        original: 'Restored raw',
        enhanced: 'Restored enhanced',
        variants: [{ label: 'Restored', content: 'Restored variant' }],
        notes: 'Restored notes',
        savedAt: '2026-03-19T00:00:00.000Z',
        changeNote: 'Prior state',
        source: 'manual_save',
      }],
    });
    localStorage.setItem(storageKeys.library, JSON.stringify([entry]));

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(result.current.libReady).toBe(true));
    const version = result.current.library[0].versions[0];

    let restored;
    act(() => {
      restored = result.current.restoreVersion(entry.id, version);
    });

    expect(restored).toEqual(expect.objectContaining({
      id: entry.id,
      original: 'Restored raw',
      enhanced: 'Restored enhanced',
      notes: 'Restored notes',
    }));
    expect(result.current.library[0].enhanced).toBe('Restored enhanced');
    expect(JSON.parse(localStorage.getItem(storageKeys.library))[0].enhanced).toBe('Restored enhanced');
    expect(notify).toHaveBeenCalledWith('Restored!');
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

  it('deletes an existing prompt and reports whether the record was removed', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([makeEntry()]));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.library).toHaveLength(1);
    });

    act(() => {
      expect(result.current.del('entry-1')).toBe(true);
    });

    expect(confirm).toHaveBeenCalledWith('Delete this prompt?');
    expect(result.current.library).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Prompt deleted.');
  });

  it('returns and persists the restored prompt version', async () => {
    const versionOne = {
      id: 'version-one',
      original: 'Version one original',
      enhanced: 'Version one enhanced',
      savedAt: '2026-03-19T00:00:00.000Z',
    };
    localStorage.setItem(storageKeys.library, JSON.stringify([
      makeEntry({
        original: 'Version two original',
        enhanced: 'Version two enhanced',
        versions: [versionOne],
      }),
    ]));
    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
    });

    let restored;
    act(() => {
      restored = result.current.restoreVersion('entry-1', versionOne);
    });

    expect(restored).toMatchObject({
      id: 'entry-1',
      original: versionOne.original,
      enhanced: versionOne.enhanced,
    });
    expect(result.current.library[0]).toMatchObject({
      original: versionOne.original,
      enhanced: versionOne.enhanced,
    });
    expect(notify).toHaveBeenCalledWith('Restored!');
  });

  it('marks the legacy library bridge as checked when recovery is unreachable', async () => {
    legacyBridgeMocks.requestLegacyLibraryPayload.mockResolvedValue(null);

    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
      expect(result.current.recoveringLegacyLibrary).toBe(false);
    });

    expect(legacyBridgeMocks.requestLegacyLibraryPayload).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(LEGACY_LIBRARY_CHECK_KEY)).toBe(JSON.stringify(true));
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('Recovered'));
  });

  it('does not retry the legacy bridge on rerender when notify changes identity', async () => {
    legacyBridgeMocks.requestLegacyLibraryPayload.mockImplementation(
      () => new Promise(() => {})
    );

    const { result, rerender } = renderHook(
      ({ notify }) => usePromptLibrary(notify),
      { initialProps: { notify: vi.fn() } },
    );

    await waitFor(() => {
      expect(result.current.libReady).toBe(true);
    });
    expect(legacyBridgeMocks.requestLegacyLibraryPayload).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ notify: vi.fn() });
      await Promise.resolve();
    });

    expect(legacyBridgeMocks.requestLegacyLibraryPayload).toHaveBeenCalledTimes(1);
  });
});
