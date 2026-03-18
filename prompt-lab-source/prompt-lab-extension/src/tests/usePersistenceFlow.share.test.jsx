import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import usePersistenceFlow from '../hooks/usePersistenceFlow.js';
import { createPromptEntry, normalizeEntry } from '../lib/promptSchema.js';
import { encodeShare } from '../promptUtils.js';

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
    id: 'templated-entry',
    title: 'Templated Prompt',
    original: 'Original body',
    enhanced: 'Hello {{name}} from {{date}}',
    tags: ['template', 'shared'],
    collection: 'Templates',
    createdAt: '2026-03-12T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
    ...overrides,
  });
}

function renderPersistenceFlow({ entry = null, raw = '', enhanced = '' } = {}) {
  const notify = vi.fn();
  const setTab = vi.fn();
  const setABVariant = vi.fn();
  const bumpUse = vi.fn();
  const doSave = vi.fn((payload) => ({
    id: payload.editingId || 'saved-entry',
    title: payload.title || 'Saved Prompt',
  }));
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
    };
  });

  return { ...hook, notify, setTab, setABVariant, bumpUse, doSave };
}

describe('usePersistenceFlow share + template paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.location.hash = '';
  });

  it('shared_prompt_normalizes_on_load', async () => {
    const shared = {
      title: '   ',
      original: 'Prompt source',
      enhanced: 'Prompt enhanced',
      variants: [
        { label: 'Tighter', content: 'Prompt tighter' },
        { label: 42, content: '' },
      ],
      tags: ['shared', '', 99, 'handoff'],
      notes: 123,
    };
    window.location.hash = `#share=${encodeShare(shared)}`;

    const { result, notify } = renderPersistenceFlow();

    await waitFor(() => {
      expect(result.current.showSave).toBe(true);
    });

    expect(result.current.raw).toBe('Prompt source');
    expect(result.current.enhanced).toBe('Prompt enhanced');
    expect(result.current.variants).toEqual([{ label: 'Tighter', content: 'Prompt tighter' }]);
    expect(result.current.notes).toBe('');
    expect(result.current.saveTags).toEqual(['shared', 'handoff']);
    expect(result.current.saveTitle).toBe('Prompt enhanced');
    expect(notify).toHaveBeenCalledWith('Shared prompt loaded!');
  });

  it('template_fill_preserves_entry_metadata', async () => {
    const entry = Object.freeze(makeEntry());
    const { result } = renderPersistenceFlow({ entry });

    await act(async () => {
      await result.current.loadEntry(entry);
    });

    expect(result.current.pendingTemplate).toEqual(entry);
    expect(result.current.showVarForm).toBe(true);
    expect(result.current.pendingTemplate.createdAt).toBe('2026-03-12T00:00:00.000Z');

    act(() => {
      result.current.setVarVals({ name: 'Dana', date: '2026-03-17' });
      result.current.applyTemplate();
    });

    expect(result.current.enhanced).toBe('Hello Dana from 2026-03-17');
    expect(result.current.editingId).toBe(entry.id);
    expect(result.current.saveTitle).toBe(entry.title);
    expect(result.current.saveTags).toEqual(entry.tags);
    expect(result.current.saveCollection).toBe(entry.collection);
    expect(result.current.showVarForm).toBe(false);
    expect(result.current.pendingTemplate).toBe(null);
    expect(entry.createdAt).toBe('2026-03-12T00:00:00.000Z');
    expect(entry.tags).toEqual(['template', 'shared']);
  });

  it('version_fields_round_trip', () => {
    const mockDexieTable = new Map();
    const created = createPromptEntry({
      id: 'versioned-entry',
      title: 'Versioned Prompt',
      original: 'Input',
      enhanced: 'Output',
      createdAt: '2026-03-15T00:00:00.000Z',
      updated_at: '2026-03-16T12:30:00.000Z',
      version: '7',
      schema_version: '2026-03',
    });

    mockDexieTable.set(created.id, structuredClone(created));
    const loaded = normalizeEntry(mockDexieTable.get(created.id));

    expect(loaded.version).toBe('7');
    expect(loaded.schema_version).toBe('2026-03');
    expect(loaded.updated_at).toBe('2026-03-16T12:30:00.000Z');
    expect(loaded.updatedAt).toBe('2026-03-16T12:30:00.000Z');
  });

  it('send_entry_to_ab_test_uses_template_resolution_before_variant_load', async () => {
    const entry = Object.freeze(makeEntry());
    const { result, setABVariant, setTab, bumpUse, notify } = renderPersistenceFlow({ entry });

    await act(async () => {
      await result.current.sendEntryToABTest(entry, 'a');
    });

    expect(result.current.pendingTemplate).toEqual(entry);
    expect(result.current.showVarForm).toBe(true);

    act(() => {
      result.current.setVarVals({ name: 'Dana', date: '2026-03-18' });
      result.current.applyTemplate();
    });

    expect(setABVariant).toHaveBeenCalledWith('a', 'Hello Dana from 2026-03-18');
    expect(setTab).toHaveBeenCalledWith('abtest');
    expect(bumpUse).toHaveBeenCalledWith(entry.id);
    expect(notify).toHaveBeenCalledWith('Loaded Templated Prompt into Variant A');
    expect(result.current.editingId).toBe(null);
    expect(result.current.pendingTemplate).toBe(null);
  });
});
