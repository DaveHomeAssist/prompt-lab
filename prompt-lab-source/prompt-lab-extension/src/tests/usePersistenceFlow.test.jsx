import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePersistenceFlow from '../hooks/usePersistenceFlow.js';
import { normalizeEntry } from '../lib/promptSchema.js';

const { sessionGet, sessionSet } = vi.hoisted(() => ({
  sessionGet: vi.fn((_key, cb) => cb(null)),
  sessionSet: vi.fn(),
}));

vi.mock('../lib/platform.js', () => ({
  sessionGet,
  sessionSet,
}));

function makeEntry(overrides = {}) {
  return normalizeEntry({
    id: 'entry-1',
    title: 'Existing Prompt',
    original: 'Original text',
    enhanced: 'Enhanced text',
    tags: ['alpha', 'beta'],
    collection: 'Ops',
    createdAt: '2026-03-10T00:00:00.000Z',
    updatedAt: '2026-03-11T00:00:00.000Z',
    ...overrides,
  });
}

function renderPersistenceFlow({
  entry = null,
  raw = 'Raw draft',
  enhanced = 'Enhanced draft',
  variants: initialVariants = [],
  notes: initialNotes = '',
  doSaveImpl,
  libOverrides = {},
} = {}) {
  const notify = vi.fn();
  const setTab = vi.fn();
  const setABVariant = vi.fn();
  const bumpUse = vi.fn();
  const trackRecentAccess = vi.fn();
  const doSave = vi.fn(doSaveImpl || ((payload) => ({
    id: payload.editingId || 'new-entry-id',
    title: payload.title || 'Saved Prompt',
  })));
  const library = entry ? [entry] : [];

  const hook = renderHook(() => {
    const [rawState, setRaw] = useState(raw);
    const [enhancedState, setEnhanced] = useState(enhanced);
    const [variants, setVariants] = useState(initialVariants);
    const [notes, setNotes] = useState(initialNotes);
    const [enhMode, setEnhMode] = useState('balanced');
    const [composerBlocks, setComposerBlocks] = useState([]);

    const flow = usePersistenceFlow({
      ui: { notify, setTab, setABVariant, tab: 'editor' },
      lib: { library, doSave, bumpUse, trackRecentAccess, ...libOverrides },
      editor: {
        raw: rawState,
        enhanced: enhancedState,
        variants,
        notes,
        enhMode,
        setRaw,
        setEnhanced,
        setVariants,
        setNotes,
        setEnhMode,
        setComposerBlocks,
      },
    });

    return {
      ...flow,
      raw: rawState,
      enhanced: enhancedState,
      variants,
      notes,
      enhMode,
      composerBlocks,
      setRaw,
      setEnhanced,
      setVariants,
      setNotes,
    };
  });

  return { ...hook, notify, setTab, setABVariant, bumpUse, trackRecentAccess, doSave, library };
}

describe('usePersistenceFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '';
  });

  it('edit_existing_save_updates_same_id', () => {
    const entry = makeEntry();
    const { result, doSave } = renderPersistenceFlow({
      entry,
      doSaveImpl: (payload) => ({ id: payload.editingId, title: payload.title || entry.title }),
    });

    act(() => {
      result.current.applyEntry(entry);
      result.current.openSavePanel();
      result.current.setSaveTitle('Updated Existing Prompt');
    });

    let saved;
    act(() => {
      saved = result.current.doSave();
    });

    expect(doSave).toHaveBeenCalledWith(expect.objectContaining({
      editingId: entry.id,
      title: 'Updated Existing Prompt',
    }));
    expect(saved).toEqual({ id: entry.id, title: 'Updated Existing Prompt' });
    expect(result.current.editingId).toBe(entry.id);
  });

  it('edit_existing_cancel_preserves_editing_id', () => {
    const entry = makeEntry();
    const { result } = renderPersistenceFlow({ entry });

    act(() => {
      result.current.applyEntry(entry);
      result.current.openSavePanel();
      result.current.setChangeNote('keep draft note out of the next open');
      result.current.setShowNewColl(true);
      result.current.setNewCollName('Scratch');
      result.current.closeSavePanel();
    });

    expect(result.current.showSave).toBe(false);
    expect(result.current.editingId).toBe(entry.id);
    expect(result.current.changeNote).toBe('');
    expect(result.current.showNewColl).toBe(false);
    expect(result.current.newCollName).toBe('');
  });

  it('adopts the replacement id when a deleted loaded prompt is saved as new', () => {
    const entry = makeEntry({
      metadata: { owner: 'Dave', purpose: 'Recovery' },
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
    });
    const { result, doSave } = renderPersistenceFlow({
      entry,
      doSaveImpl: (payload) => ({
        id: 'replacement-entry',
        title: payload.title,
        savedAsNew: true,
      }),
    });

    act(() => {
      result.current.applyEntry(entry);
      result.current.setRaw('Recovered raw');
      result.current.setEnhanced('Recovered enhanced');
      result.current.setVariants([{ label: 'Recovered', content: 'Recovered variant' }]);
      result.current.setNotes('Recovered notes');
      result.current.openSavePanel();
    });
    act(() => {
      result.current.setSaveTitle('Recovered prompt');
      result.current.setSaveTags(['safe']);
      result.current.setSaveCollection('Recovered');
    });

    let saved;
    act(() => {
      saved = result.current.doSave();
    });

    expect(doSave).toHaveBeenCalledWith(expect.objectContaining({
      editingId: entry.id,
      raw: 'Recovered raw',
      enhanced: 'Recovered enhanced',
      variants: [{ label: 'Recovered', content: 'Recovered variant' }],
      notes: 'Recovered notes',
      sourceEntry: expect.objectContaining({
        id: entry.id,
        metadata: expect.objectContaining({ owner: 'Dave', purpose: 'Recovery' }),
      }),
    }));
    expect(saved).toEqual({
      id: 'replacement-entry',
      title: 'Recovered prompt',
      savedAsNew: true,
    });
    expect(result.current.editingId).toBe('replacement-entry');

    act(() => result.current.openSavePanel());
    expect(result.current.saveTitle).toBe('Recovered prompt');
    expect(result.current.saveTags).toEqual(['safe']);
    expect(result.current.saveCollection).toBe('Recovered');
  });

  it('synchronizes every loaded editor field after an acknowledged version restore', () => {
    const entry = makeEntry({
      variants: [{ label: 'Current', content: 'Current variant' }],
      notes: 'Current notes',
    });
    const restored = makeEntry({
      id: entry.id,
      title: 'Restored title',
      original: 'Restored raw',
      enhanced: 'Restored enhanced',
      variants: [{ label: 'Restored', content: 'Restored variant' }],
      notes: 'Restored notes',
      tags: ['restored'],
      collection: 'Archive',
    });
    const restoreVersion = vi.fn(() => restored);
    const { result, notify, bumpUse, trackRecentAccess } = renderPersistenceFlow({
      entry,
      libOverrides: { restoreVersion },
    });

    act(() => result.current.applyEntry(entry));
    notify.mockClear();
    bumpUse.mockClear();
    trackRecentAccess.mockClear();

    let restoredResult;
    act(() => {
      restoredResult = result.current.restoreEntryVersion(entry.id, { id: 'version-1' });
    });

    expect(restoredResult).toEqual(restored);
    expect(result.current.editingId).toBe(entry.id);
    expect(result.current.raw).toBe('Restored raw');
    expect(result.current.enhanced).toBe('Restored enhanced');
    expect(result.current.variants).toEqual([{ label: 'Restored', content: 'Restored variant' }]);
    expect(result.current.notes).toBe('Restored notes');
    expect(result.current.saveTitle).toBe('Restored title');
    expect(result.current.saveTags).toEqual(['restored']);
    expect(result.current.saveCollection).toBe('Archive');
    expect(bumpUse).not.toHaveBeenCalled();
    expect(trackRecentAccess).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalledWith('Loaded into editor!');
  });

  it('leaves the loaded editor unchanged when version persistence is rejected', () => {
    const entry = makeEntry({
      variants: [{ label: 'Current', content: 'Current variant' }],
      notes: 'Current notes',
    });
    const restoreVersion = vi.fn(() => null);
    const { result } = renderPersistenceFlow({ entry, libOverrides: { restoreVersion } });

    act(() => result.current.applyEntry(entry));

    let restoredResult;
    act(() => {
      restoredResult = result.current.restoreEntryVersion(entry.id, { id: 'version-1' });
    });

    expect(restoredResult).toBeNull();
    expect(result.current.editingId).toBe(entry.id);
    expect(result.current.raw).toBe(entry.original);
    expect(result.current.enhanced).toBe(entry.enhanced);
    expect(result.current.variants).toEqual(entry.variants);
    expect(result.current.notes).toBe(entry.notes);
    expect(result.current.saveTitle).toBe(entry.title);
    expect(result.current.saveTags).toEqual(entry.tags);
    expect(result.current.saveCollection).toBe(entry.collection);
  });

  it('deleting the loaded prompt clears its save target but preserves the draft', () => {
    const entry = makeEntry({
      metadata: { owner: 'Dave', purpose: 'Delete recovery' },
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
    });
    const del = vi.fn(() => true);
    const { result, doSave } = renderPersistenceFlow({ entry, libOverrides: { del } });

    act(() => result.current.applyEntry(entry));

    act(() => {
      result.current.openSavePanel();
      result.current.deleteEntry(entry.id);
    });

    expect(del).toHaveBeenCalledWith(entry.id);
    expect(result.current.editingId).toBeNull();
    expect(result.current.saveTargetId).toBeNull();
    expect(result.current.raw).toBe(entry.original);
    expect(result.current.enhanced).toBe(entry.enhanced);

    act(() => {
      result.current.openSavePanel();
      result.current.doSave();
    });

    expect(doSave).toHaveBeenLastCalledWith(expect.objectContaining({
      editingId: null,
      raw: entry.original,
      enhanced: entry.enhanced,
      savedFromDeletedTarget: true,
      sourceEntry: expect.objectContaining({
        id: null,
        metadata: expect.objectContaining({ owner: 'Dave', purpose: 'Delete recovery' }),
        inputs: expect.arrayContaining([expect.objectContaining({ key: 'topic' })]),
      }),
    }));
    expect(result.current.editingId).toBe('new-entry-id');
  });

  it('restoring a version synchronizes a loaded editor before the next save', () => {
    const entry = makeEntry({
      original: 'Version two original',
      enhanced: 'Version two enhanced',
    });
    const restored = makeEntry({
      id: entry.id,
      original: 'Version one original',
      enhanced: 'Version one enhanced',
    });
    const restoreVersion = vi.fn(() => restored);
    const { result, doSave } = renderPersistenceFlow({ entry, libOverrides: { restoreVersion } });

    act(() => result.current.applyEntry(entry));

    act(() => {
      result.current.restoreEntryVersion(entry.id, { id: 'version-one' });
    });

    expect(restoreVersion).toHaveBeenCalledWith(entry.id, { id: 'version-one' });
    expect(result.current.raw).toBe(restored.original);
    expect(result.current.enhanced).toBe(restored.enhanced);

    act(() => {
      result.current.openSavePanel();
      result.current.doSave();
    });

    expect(doSave).toHaveBeenLastCalledWith(expect.objectContaining({
      editingId: entry.id,
      raw: restored.original,
      enhanced: restored.enhanced,
    }));
  });

  it('save_new_creates_new_id', () => {
    const { result, doSave } = renderPersistenceFlow({
      doSaveImpl: (payload) => ({ id: payload.editingId || 'new-generated-id', title: 'Fresh Prompt' }),
    });

    act(() => {
      result.current.openSavePanel();
      result.current.setSaveTitle('Fresh Prompt');
    });

    let saved;
    act(() => {
      saved = result.current.doSave();
    });

    expect(doSave).toHaveBeenCalledWith(expect.objectContaining({
      editingId: null,
      title: 'Fresh Prompt',
    }));
    expect(saved).toEqual({ id: 'new-generated-id', title: 'Fresh Prompt' });
    expect(result.current.editingId).toBe('new-generated-id');
  });

  it('open_save_panel_prefills_from_active_entry', () => {
    const entry = makeEntry({
      title: 'Canonical Prompt',
      tags: ['prod', 'safe'],
      collection: 'Launch',
    });
    const { result } = renderPersistenceFlow({ entry });

    act(() => {
      result.current.applyEntry(entry);
      result.current.setSaveTitle('Wrong Title');
      result.current.setSaveTags([]);
      result.current.setSaveCollection('');
      result.current.openSavePanel();
    });

    expect(result.current.saveTitle).toBe('Canonical Prompt');
    expect(result.current.saveTags).toEqual(['prod', 'safe']);
    expect(result.current.saveCollection).toBe('Launch');
    expect(result.current.editingId).toBe(entry.id);
  });

  it('metadata_only_edit_preserves_saved_prompt_content', () => {
    const entry = makeEntry({
      title: 'Metadata Target',
      original: 'Canonical original',
      enhanced: 'Canonical enhanced',
      notes: 'Canonical notes',
    });
    const { result, doSave } = renderPersistenceFlow({
      entry,
      raw: 'Unrelated draft',
      enhanced: 'Unrelated enhanced draft',
      doSaveImpl: (payload) => ({ id: payload.editingId, title: payload.title }),
    });

    act(() => {
      result.current.openSavePanel(entry);
      result.current.setSaveTitle('Retitled Prompt');
    });

    act(() => {
      result.current.doSave();
    });

    expect(doSave).toHaveBeenCalledWith(expect.objectContaining({
      editingId: entry.id,
      raw: 'Canonical original',
      enhanced: 'Canonical enhanced',
      notes: 'Canonical notes',
      title: 'Retitled Prompt',
    }));
    expect(result.current.editingId).toBe(null);
    expect(result.current.saveTargetId).toBe(null);
  });

  it('add_to_composer_tracks_recent_access_when_available', () => {
    const entry = makeEntry({
      title: 'Composer Target',
      enhanced: 'Composer content',
    });
    const { result, bumpUse, trackRecentAccess, notify } = renderPersistenceFlow({ entry });

    act(() => {
      result.current.addToComposer(entry);
    });

    expect(result.current.composerBlocks).toHaveLength(1);
    expect(result.current.composerBlocks[0]).toEqual(expect.objectContaining({
      label: 'Composer Target',
      content: 'Composer content',
      sourceId: entry.id,
    }));
    expect(bumpUse).toHaveBeenCalledWith(entry.id);
    expect(trackRecentAccess).toHaveBeenCalledWith(entry.id);
    expect(notify).toHaveBeenCalledWith('Added to Composer!');
  });

  it('add_to_composer_tolerates_missing_library_callbacks', () => {
    const entry = makeEntry({
      title: 'Composer Fallback',
      enhanced: 'Fallback content',
    });
    const { result, notify } = renderPersistenceFlow({
      entry,
      libOverrides: {
        bumpUse: undefined,
        trackRecentAccess: undefined,
      },
    });

    expect(() => {
      act(() => {
        result.current.addToComposer(entry);
      });
    }).not.toThrow();

    expect(result.current.composerBlocks).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('Added to Composer!');
  });
});
