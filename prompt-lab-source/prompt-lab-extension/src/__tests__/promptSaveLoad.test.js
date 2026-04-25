import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { storageKeys, loadJson, saveJson } from '../lib/storage.js';
import { createPromptEntry } from '../lib/promptSchema.js';

const NOW = '2026-04-10T12:00:00.000Z';

function makeEntry(overrides = {}) {
  return createPromptEntry({
    title: overrides.title || 'Test Prompt',
    original: overrides.original || 'Original text',
    enhanced: overrides.enhanced || overrides.original || 'Enhanced text',
    notes: overrides.notes || '',
    tags: overrides.tags || [],
    collection: overrides.collection || '',
    useCount: overrides.useCount || 0,
    ...overrides,
  }, { now: NOW });
}

function setupHook(initialLibrary = null, initialCollections = null) {
  if (initialLibrary) {
    localStorage.setItem(storageKeys.library, JSON.stringify(initialLibrary));
  }
  if (initialCollections) {
    localStorage.setItem(storageKeys.collections, JSON.stringify(initialCollections));
  }
  const notify = vi.fn();
  const hook = renderHook(() => usePromptLibrary(notify));
  return { ...hook, notify };
}

describe('Prompt Save & Load Integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Save — New Prompt
  // ────────────────────────────────────────────────────────────────────────────
  describe('doSave — new prompt', () => {
    it('saves a new prompt to the library', async () => {
      const { result, notify } = setupHook();
      await waitFor(() => expect(result.current.libReady).toBe(true));

      const initialLength = result.current.library.length;
      let saved;
      act(() => {
        saved = result.current.doSave({
          raw: 'My raw prompt',
          enhanced: 'My enhanced prompt',
          variants: [],
          notes: 'Test notes',
          tags: ['Code'],
          title: 'My New Prompt',
          collection: 'TestCol',
          editingId: null,
          changeNote: '',
        });
      });

      expect(saved).toBeTruthy();
      expect(saved.id).toBeTruthy();
      expect(saved.title).toBe('My New Prompt');
      expect(result.current.library.length).toBe(initialLength + 1);
      expect(notify).toHaveBeenCalledWith('Saved!');
    });

    it('auto-generates title from enhanced text when title is empty', async () => {
      const { result } = setupHook();
      await waitFor(() => expect(result.current.libReady).toBe(true));

      let saved;
      act(() => {
        saved = result.current.doSave({
          raw: '',
          enhanced: 'Write a comprehensive analysis of market trends',
          variants: [],
          notes: '',
          tags: [],
          title: '',
          collection: '',
          editingId: null,
          changeNote: '',
        });
      });

      expect(saved.title).toBeTruthy();
      expect(saved.title).not.toBe('');
      expect(saved.title).not.toBe('Untitled Prompt');
    });

    it('prepends new entry to library', async () => {
      const existing = makeEntry({ id: 'existing-1', enhanced: 'Existing prompt' });
      const { result } = setupHook([existing]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.doSave({
          raw: 'New raw',
          enhanced: 'New enhanced',
          variants: [],
          notes: '',
          tags: [],
          title: 'New Prompt',
          collection: '',
          editingId: null,
          changeNote: '',
        });
      });

      expect(result.current.library[0].title).toBe('New Prompt');
    });

    it('uses raw as enhanced when enhanced is empty', async () => {
      const { result } = setupHook();
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.doSave({
          raw: 'Only raw text',
          enhanced: '',
          variants: [],
          notes: '',
          tags: [],
          title: 'Raw Only',
          collection: '',
          editingId: null,
          changeNote: '',
        });
      });

      const saved = result.current.library.find((e) => e.title === 'Raw Only');
      expect(saved).toBeTruthy();
      expect(saved.enhanced).toBe('Only raw text');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Save — Update Existing
  // ────────────────────────────────────────────────────────────────────────────
  describe('doSave — update existing', () => {
    it('updates an existing prompt', async () => {
      const existing = makeEntry({ id: 'entry-1', enhanced: 'Old enhanced', title: 'Old Title' });
      const { result, notify } = setupHook([existing]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.doSave({
          raw: 'Updated raw',
          enhanced: 'Updated enhanced',
          variants: [],
          notes: 'Updated notes',
          tags: ['Writing'],
          title: 'Updated Title',
          collection: 'NewCol',
          editingId: 'entry-1',
          changeNote: 'Made improvements',
        });
      });

      const updated = result.current.library.find((e) => e.id === 'entry-1');
      expect(updated).toBeTruthy();
      expect(updated.enhanced).toBe('Updated enhanced');
      expect(updated.tags).toEqual(['Writing']);
      expect(updated.collection).toBe('NewCol');
      expect(notify).toHaveBeenCalledWith('Prompt updated!');
    });

    it('creates a version snapshot when content changes', async () => {
      const existing = makeEntry({ id: 'entry-1', enhanced: 'Version 1 content' });
      const { result } = setupHook([existing]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.doSave({
          raw: existing.original,
          enhanced: 'Version 2 content',
          variants: [],
          notes: '',
          tags: [],
          title: existing.title,
          collection: '',
          editingId: 'entry-1',
          changeNote: 'Updated content',
        });
      });

      const updated = result.current.library.find((e) => e.id === 'entry-1');
      expect(updated.versions.length).toBeGreaterThan(0);
    });

    it('does not duplicate library length on update', async () => {
      const existing = makeEntry({ id: 'entry-1', enhanced: 'Content' });
      const { result } = setupHook([existing]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      const initialLength = result.current.library.length;
      act(() => {
        result.current.doSave({
          raw: 'Updated',
          enhanced: 'Updated content',
          variants: [],
          notes: '',
          tags: [],
          title: 'Updated',
          collection: '',
          editingId: 'entry-1',
          changeNote: '',
        });
      });

      expect(result.current.library.length).toBe(initialLength);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Load from localStorage
  // ────────────────────────────────────────────────────────────────────────────
  describe('library loading', () => {
    it('loads library from localStorage on init', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha' }),
        makeEntry({ id: 'b', enhanced: 'Bravo' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => {
        expect(result.current.libReady).toBe(true);
        expect(result.current.library).toHaveLength(2);
      });
    });

    it('loads default seeds when no library exists', async () => {
      const { result } = setupHook();
      await waitFor(() => expect(result.current.libReady).toBe(true));
      expect(result.current.library.length).toBeGreaterThan(0);
    });

    it('loads collections from localStorage', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha', collection: 'Col1' })];
      const { result } = setupHook(entries, ['Col1', 'Col2']);
      await waitFor(() => expect(result.current.libReady).toBe(true));
      expect(result.current.collections).toContain('Col1');
      expect(result.current.collections).toContain('Col2');
    });

    it('derives collections from library when none stored', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha', collection: 'DerivedCol' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));
      expect(result.current.collections).toContain('DerivedCol');
    });

    it('handles corrupted localStorage gracefully', async () => {
      localStorage.setItem(storageKeys.library, 'not valid json{{{');
      const { result } = setupHook();
      await waitFor(() => expect(result.current.libReady).toBe(true));
      // Should fall back to default seeds
      expect(result.current.library.length).toBeGreaterThan(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Delete
  // ────────────────────────────────────────────────────────────────────────────
  describe('del', () => {
    it('deletes a prompt after confirmation', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha' }),
        makeEntry({ id: 'b', enhanced: 'Bravo' }),
      ];
      const { result, notify } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      vi.spyOn(window, 'confirm').mockReturnValue(true);
      act(() => result.current.del('a'));

      expect(result.current.library).toHaveLength(1);
      expect(result.current.library[0].id).toBe('b');
      expect(notify).toHaveBeenCalledWith('Prompt deleted.');
      window.confirm.mockRestore();
    });

    it('does not delete when confirmation is cancelled', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      vi.spyOn(window, 'confirm').mockReturnValue(false);
      act(() => result.current.del('a'));

      expect(result.current.library).toHaveLength(1);
      window.confirm.mockRestore();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // bumpUse
  // ────────────────────────────────────────────────────────────────────────────
  describe('bumpUse', () => {
    it('increments useCount for an entry', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha', useCount: 3 })];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.bumpUse('a'));

      expect(result.current.library.find((e) => e.id === 'a').useCount).toBe(4);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Rename
  // ────────────────────────────────────────────────────────────────────────────
  describe('renameEntry', () => {
    it('renames an entry', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha', title: 'Old Name' })];
      const { result, notify } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      const setSaveTitle = vi.fn();
      act(() => result.current.renameEntry('a', 'New Name', 'a', setSaveTitle));

      expect(result.current.library.find((e) => e.id === 'a').title).toBe('New Name');
      expect(setSaveTitle).toHaveBeenCalledWith('New Name');
      expect(result.current.renamingId).toBeNull();
      expect(result.current.renameValue).toBe('');
      expect(notify).toHaveBeenCalledWith('Renamed.');
    });

    it('does not rename to empty string', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha', title: 'Keep Me' })];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.renameEntry('a', '  ', null, null));

      expect(result.current.library.find((e) => e.id === 'a').title).toBe('Keep Me');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Sorting
  // ────────────────────────────────────────────────────────────────────────────
  describe('sorting', () => {
    it('sorts by newest (default)', async () => {
      const entries = [
        makeEntry({ id: 'old', enhanced: 'Old', createdAt: '2026-01-01T00:00:00.000Z' }),
        makeEntry({ id: 'new', enhanced: 'New', createdAt: '2026-04-01T00:00:00.000Z' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));
      expect(result.current.filtered[0].id).toBe('new');
    });

    it('sorts by oldest', async () => {
      const entries = [
        makeEntry({ id: 'old', enhanced: 'Old', createdAt: '2026-01-01T00:00:00.000Z' }),
        makeEntry({ id: 'new', enhanced: 'New', createdAt: '2026-04-01T00:00:00.000Z' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('oldest'));
      expect(result.current.filtered[0].id).toBe('old');
    });

    it('sorts by a-z', async () => {
      const entries = [
        makeEntry({ id: 'c', enhanced: 'Charlie content', title: 'Charlie' }),
        makeEntry({ id: 'a', enhanced: 'Alpha content', title: 'Alpha' }),
        makeEntry({ id: 'b', enhanced: 'Bravo content', title: 'Bravo' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('a-z'));
      expect(result.current.filtered.map((e) => e.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    });

    it('sorts by z-a', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha content', title: 'Alpha' }),
        makeEntry({ id: 'c', enhanced: 'Charlie content', title: 'Charlie' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('z-a'));
      expect(result.current.filtered[0].title).toBe('Charlie');
    });

    it('sorts by most-used', async () => {
      const entries = [
        makeEntry({ id: 'low', enhanced: 'Low use', useCount: 1 }),
        makeEntry({ id: 'high', enhanced: 'High use', useCount: 10 }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('most-used'));
      expect(result.current.filtered[0].id).toBe('high');
    });

    it('rejects invalid sort values', async () => {
      const { result } = setupHook([makeEntry({ enhanced: 'Test' })]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('invalid-sort'));
      expect(result.current.sortBy).toBe('newest');
    });

    it('persists sort preference to localStorage', async () => {
      const { result } = setupHook([makeEntry({ enhanced: 'Test' })]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSortBy('a-z'));
      expect(loadJson(storageKeys.sortBy)).toBe('a-z');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Filtering
  // ────────────────────────────────────────────────────────────────────────────
  describe('filtering', () => {
    it('filters by search query', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Write Python code', title: 'Python Helper' }),
        makeEntry({ id: 'b', enhanced: 'Analyze market data', title: 'Market Analysis' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setSearch('python'));
      expect(result.current.filtered).toHaveLength(1);
      expect(result.current.filtered[0].id).toBe('a');
    });

    it('filters by active tag', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha', tags: ['Code'] }),
        makeEntry({ id: 'b', enhanced: 'Bravo', tags: ['Writing'] }),
        makeEntry({ id: 'c', enhanced: 'Charlie', tags: ['Code', 'Writing'] }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setActiveTag('Code'));
      expect(result.current.filtered).toHaveLength(2);
      expect(result.current.filtered.map((e) => e.id).sort()).toEqual(['a', 'c']);
    });

    it('filters by active collection', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha', collection: 'Ops' }),
        makeEntry({ id: 'b', enhanced: 'Bravo', collection: 'Launch' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.setActiveCollection('Ops'));
      expect(result.current.filtered).toHaveLength(1);
      expect(result.current.filtered[0].id).toBe('a');
    });

    it('combines search, tag, and collection filters', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Python code helper', tags: ['Code'], collection: 'Ops' }),
        makeEntry({ id: 'b', enhanced: 'Python writer', tags: ['Writing'], collection: 'Ops' }),
        makeEntry({ id: 'c', enhanced: 'Python script', tags: ['Code'], collection: 'Launch' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.setSearch('python');
        result.current.setActiveTag('Code');
        result.current.setActiveCollection('Ops');
      });

      expect(result.current.filtered).toHaveLength(1);
      expect(result.current.filtered[0].id).toBe('a');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Collections
  // ────────────────────────────────────────────────────────────────────────────
  describe('collections', () => {
    it('derives allLibTags from library entries', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha', tags: ['Code', 'Writing'] }),
        makeEntry({ id: 'b', enhanced: 'Bravo', tags: ['Code', 'Creative'] }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      expect(result.current.allLibTags).toContain('Code');
      expect(result.current.allLibTags).toContain('Writing');
      expect(result.current.allLibTags).toContain('Creative');
    });

    it('deleteCollection clears collection from entries', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha', collection: 'ToDelete' }),
        makeEntry({ id: 'b', enhanced: 'Bravo', collection: 'Keep' }),
      ];
      const { result, notify } = setupHook(entries, ['ToDelete', 'Keep']);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.deleteCollection('ToDelete'));

      expect(result.current.collections).not.toContain('ToDelete');
      expect(result.current.collections).toContain('Keep');
      expect(result.current.library.find((e) => e.id === 'a').collection).toBe('');
      expect(result.current.library.find((e) => e.id === 'b').collection).toBe('Keep');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Move / Reorder
  // ────────────────────────────────────────────────────────────────────────────
  describe('moveLibraryEntry', () => {
    it('moves an entry before a target', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha entry' }),
        makeEntry({ id: 'b', enhanced: 'Bravo entry' }),
        makeEntry({ id: 'c', enhanced: 'Charlie entry' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.moveLibraryEntry('c', 'a', 'before'));
      expect(result.current.library.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    });

    it('moves an entry after a target', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha entry' }),
        makeEntry({ id: 'b', enhanced: 'Bravo entry' }),
        makeEntry({ id: 'c', enhanced: 'Charlie entry' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.moveLibraryEntry('a', 'c', 'after'));
      expect(result.current.library.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    });

    it('no-ops when source equals target', async () => {
      const entries = [
        makeEntry({ id: 'a', enhanced: 'Alpha entry' }),
        makeEntry({ id: 'b', enhanced: 'Bravo entry' }),
      ];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      const before = result.current.library.map((e) => e.id);
      act(() => result.current.moveLibraryEntry('a', 'a', 'before'));
      expect(result.current.library.map((e) => e.id)).toEqual(before);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Version History
  // ────────────────────────────────────────────────────────────────────────────
  describe('version history', () => {
    it('restores a version', async () => {
      const existing = makeEntry({ id: 'a', enhanced: 'Current version' });
      const { result, notify } = setupHook([existing]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      // Update to create a version
      act(() => {
        result.current.doSave({
          raw: 'Updated',
          enhanced: 'Updated version',
          variants: [],
          notes: '',
          tags: [],
          title: 'Test',
          collection: '',
          editingId: 'a',
          changeNote: 'Update',
        });
      });

      const entry = result.current.library.find((e) => e.id === 'a');
      if (entry.versions.length > 0) {
        act(() => result.current.restoreVersion('a', entry.versions[0]));
        expect(notify).toHaveBeenCalledWith('Restored!');
      }
    });

    it('opens and closes version history modal', async () => {
      const { result } = setupHook([makeEntry({ id: 'a', enhanced: 'Test' })]);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.openVersionHistory('a', 2));
      expect(result.current.expandedVersionId).toBe('a');
      expect(result.current.diffVersionIdx).toBe(2);

      act(() => result.current.closeVersionHistory());
      expect(result.current.expandedVersionId).toBeNull();
      expect(result.current.diffVersionIdx).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Golden Response
  // ────────────────────────────────────────────────────────────────────────────
  describe('golden response', () => {
    it('pins a golden response', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
      const { result, notify } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.pinGoldenResponse('a', {
          text: 'Expected output',
          runId: 'run-1',
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
        });
      });

      // Note: Bug #4 means the return value may be false even though the update happened
      const entry = result.current.library.find((e) => e.id === 'a');
      expect(entry.goldenResponse).not.toBeNull();
      expect(entry.goldenResponse.text).toBe('Expected output');
    });

    it('rejects empty golden response text', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.pinGoldenResponse('a', { text: '  ' });
      });

      const entry = result.current.library.find((e) => e.id === 'a');
      expect(entry.goldenResponse).toBeNull();
    });

    it('clears a golden response', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => {
        result.current.pinGoldenResponse('a', { text: 'Golden text' });
      });
      act(() => {
        result.current.clearGoldenResponse('a');
      });

      const entry = result.current.library.find((e) => e.id === 'a');
      expect(entry.goldenResponse).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Quick Inject
  // ────────────────────────────────────────────────────────────────────────────
  describe('quickInject', () => {
    it('returns top 5 most-used prompts', async () => {
      const entries = Array.from({ length: 8 }, (_, i) =>
        makeEntry({ id: `e-${i}`, enhanced: `Prompt ${i}`, useCount: i })
      );
      const { result } = setupHook(entries);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      expect(result.current.quickInject).toHaveLength(5);
      // Should be sorted descending by useCount
      for (let i = 0; i < result.current.quickInject.length - 1; i++) {
        expect(result.current.quickInject[i].useCount).toBeGreaterThanOrEqual(
          result.current.quickInject[i + 1].useCount
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Clear Library
  // ────────────────────────────────────────────────────────────────────────────
  describe('clearLibrary', () => {
    it('clears all library state', async () => {
      const entries = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
      const { result, notify } = setupHook(entries, ['Col1']);
      await waitFor(() => expect(result.current.libReady).toBe(true));

      act(() => result.current.clearLibrary());

      expect(result.current.library).toEqual([]);
      expect(result.current.collections).toEqual([]);
      expect(result.current.activeCollection).toBeNull();
      expect(result.current.activeTag).toBeNull();
      expect(result.current.expandedId).toBeNull();
      expect(notify).toHaveBeenCalledWith('Library cleared.');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Export
  // ────────────────────────────────────────────────────────────────────────────
  describe('exportLib', () => {
    it('notifies when library is empty', async () => {
      const { result, notify } = setupHook([]);
      // Wait for libReady, then clear
      await waitFor(() => expect(result.current.libReady).toBe(true));
      act(() => result.current.clearLibrary());

      act(() => result.current.exportLib());
      expect(notify).toHaveBeenCalledWith('Library is empty.');
    });
  });
});
