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

function renderPersistenceFlow({ entry = null, raw = 'Raw draft', enhanced = 'Enhanced draft', doSaveImpl } = {}) {
  const notify = vi.fn();
  const setTab = vi.fn();
  const setABVariant = vi.fn();
  const bumpUse = vi.fn();
  const doSave = vi.fn(doSaveImpl || ((payload) => ({
    id: payload.editingId || 'new-entry-id',
    title: payload.title || 'Saved Prompt',
  })));
  const library = entry ? [entry] : [];

  const hook = renderHook(() => {
    const [rawState, setRaw] = useState(raw);
    const [enhancedState, setEnhanced] = useState(enhanced);
    const [variants, setVariants] = useState([]);
    const [notes, setNotes] = useState('');
    const [enhMode, setEnhMode] = useState('balanced');
    const [composerBlocks, setComposerBlocks] = useState([]);

    const flow = usePersistenceFlow({
      ui: { notify, setTab, setABVariant, tab: 'editor' },
      lib: { library, doSave, bumpUse },
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
    };
  });

  return { ...hook, notify, setTab, setABVariant, bumpUse, doSave, library };
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
});
