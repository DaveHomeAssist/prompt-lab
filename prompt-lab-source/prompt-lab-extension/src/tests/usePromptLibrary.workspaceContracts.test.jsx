import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKeys } from '../lib/storage.js';

const experimentMocks = vi.hoisted(() => ({
  listEvalRuns: vi.fn(),
  saveEvalRun: vi.fn(),
}));

vi.mock('../experimentStore.js', () => ({
  listEvalRuns: experimentMocks.listEvalRuns,
  saveEvalRun: experimentMocks.saveEvalRun,
}));

vi.mock('../lib/legacyLibraryMigration.js', async () => {
  const actual = await vi.importActual('../lib/legacyLibraryMigration.js');
  return {
    ...actual,
    shouldAttemptLegacyWebMigration: () => false,
    requestLegacyLibraryPayload: vi.fn(),
  };
});

import usePromptLibrary, { isTrashEntryRestorable } from '../hooks/usePromptLibrary.js';

const richPrompt = {
  id: 'prompt-1',
  title: 'Release checklist',
  original: 'Draft release checklist',
  enhanced: 'Verified release checklist',
  variants: [
    { label: 'Tighter', content: 'Tight release checklist' },
    { label: 'Strict JSON', content: '{"steps":[]}' },
  ],
  notes: 'Run against production evidence.',
  resultMeta: {
    candidates: [
      { id: 'improved', label: 'Improved', content: 'Verified release checklist' },
      { id: 'tighter', label: 'Tighter', content: 'Tight release checklist' },
      { id: 'strict-json', label: 'Strict JSON', content: '{"steps":[]}' },
    ],
    selectedCandidateId: 'strict-json',
    changeSummary: 'Made every step testable.',
    changes: [{ id: 'change-1', type: 'changed', label: 'Made evidence explicit' }],
    assumptions: [{ id: 'assumption-1', text: 'A deployed URL exists.' }],
    reversibleEdits: [{
      id: 'edit-1',
      label: 'Add live verification',
      operation: 'add',
      before: '',
      after: 'Verify the live URL.',
      candidateId: 'improved',
    }],
    reasoning: 'Verification closes the release loop.',
    tags: ['Operations'],
    usage: { input: 50, output: 25, total: 75 },
    runId: 'run-1',
  },
  tags: ['Operations'],
  collection: 'Releases',
  favorite: true,
  kind: 'template',
  sourceNoteId: 'scratch-1',
  tombstoneVersion: 2,
  currentVersionId: 'version-2',
  versions: [{
    id: 'version-1',
    original: 'Draft v1',
    enhanced: 'Checklist v1',
    variants: [],
    notes: 'First version',
    savedAt: '2026-08-19T10:00:00.000Z',
    source: 'manual_save',
  }],
  testCases: [{
    id: 'case-1',
    name: 'Production release',
    input: 'Verify the current release.',
    expectedTraits: ['Has source-of-truth evidence'],
    exclusions: ['Assumes HTTP 200 is sufficient'],
    notes: '',
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-19T10:00:00.000Z',
  }],
  inputs: [{ key: 'url', label: 'Live URL', type: 'text', required: true }],
  goldenResponse: {
    text: 'Release is verified.',
    pinnedAt: '2026-08-19T10:00:00.000Z',
    pinnedFromRunId: 'run-1',
    provider: 'anthropic',
    model: 'claude-test',
  },
  goldenThreshold: 0.9,
  metadata: {
    owner: 'Dave',
    purpose: 'Verify releases',
    status: 'active',
    packId: 'pack-1',
    packName: 'Release Pack',
    packSource: 'authored',
  },
  createdAt: '2026-08-19T10:00:00.000Z',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

const deletedPrompt = {
  ...richPrompt,
  id: 'prompt-deleted',
  title: 'Deleted checklist',
  currentVersionId: 'deleted-version-1',
  deletedAt: '2026-08-20T09:00:00.000Z',
  updatedAt: '2026-08-20T09:00:00.000Z',
  tombstoneVersion: 3,
};

const scratchWorkspace = {
  revision: 4,
  pads: [{
    id: 'scratch-1',
    title: 'Release notes',
    content: 'Draft release checklist',
    linkedPromptId: 'prompt-1',
    tags: ['release'],
    status: 'working',
    pinned: true,
  }],
};

const packRegistry = {
  'pack-1': {
    id: 'pack-1',
    title: 'Release Pack',
    version: '2.0.0',
    source: 'authored',
    createdAt: '2026-08-19T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:00.000Z',
  },
};

const evalRun = {
  id: 'run-1',
  createdAt: '2026-08-20T10:00:00.000Z',
  promptId: 'prompt-1',
  promptVersionId: 'version-2',
  promptTitle: 'Release checklist',
  mode: 'enhance',
  provider: 'anthropic',
  model: 'claude-test',
  input: 'Draft release checklist',
  output: '{"steps":[]}',
  candidates: richPrompt.resultMeta.candidates,
  selectedCandidateId: 'strict-json',
  reversibleEdits: richPrompt.resultMeta.reversibleEdits,
  tags: ['Operations'],
  usage: { input: 50, output: 25, total: 75 },
};

class ImmediateFileReader {
  readAsText(file) {
    queueMicrotask(() => this.onload?.({ target: { result: file.contents } }));
  }
}

describe('workspace export and import contract', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    experimentMocks.listEvalRuns.mockResolvedValue([evalRun]);
    experimentMocks.saveEvalRun.mockImplementation(async (run) => run);
    vi.stubGlobal('FileReader', ImmediateFileReader);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:prompt-lab-workspace'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('round-trips prompt detail, trash, collections, packs, Scratch, and runs', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([richPrompt]));
    localStorage.setItem(storageKeys.trash, JSON.stringify([deletedPrompt]));
    localStorage.setItem(storageKeys.collections, JSON.stringify(['Releases']));
    localStorage.setItem(storageKeys.packs, JSON.stringify(packRegistry));
    localStorage.setItem('pl2-pads', JSON.stringify(scratchWorkspace));

    const exportNotify = vi.fn();
    const exportedHook = renderHook(() => usePromptLibrary(exportNotify));
    await waitFor(() => expect(exportedHook.result.current.libReady).toBe(true));

    let payload;
    await act(async () => {
      payload = await exportedHook.result.current.exportLib();
    });

    expect(experimentMocks.listEvalRuns).toHaveBeenCalledWith({ limit: null });

    expect(payload).toEqual(expect.objectContaining({
      product: 'Prompt Lab',
      schemaVersion: 2,
      library: [expect.objectContaining({
        id: 'prompt-1',
        favorite: true,
        kind: 'template',
        sourceNoteId: 'scratch-1',
        tombstoneVersion: 2,
        resultMeta: expect.objectContaining({
          selectedCandidateId: 'strict-json',
          usage: { input: 50, output: 25, total: 75 },
        }),
      })],
      trash: [expect.objectContaining({ id: 'prompt-deleted', tombstoneVersion: 3 })],
      collections: ['Releases'],
      packs: packRegistry,
      scratch: scratchWorkspace,
      runs: [evalRun],
    }));

    exportedHook.unmount();
    localStorage.clear();
    localStorage.setItem(storageKeys.library, JSON.stringify([]));

    const importNotify = vi.fn();
    const importedHook = renderHook(() => usePromptLibrary(importNotify));
    await waitFor(() => expect(importedHook.result.current.libReady).toBe(true));

    const input = {
      files: [{ size: JSON.stringify(payload).length, contents: JSON.stringify(payload) }],
      value: 'workspace.json',
    };
    act(() => {
      importedHook.result.current.importLib({ target: input });
    });

    await waitFor(() => {
      expect(importedHook.result.current.library).toHaveLength(1);
      expect(experimentMocks.saveEvalRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }));
    });

    expect(importedHook.result.current.library[0]).toEqual(expect.objectContaining({
      id: 'prompt-1',
      favorite: true,
      kind: 'template',
      sourceNoteId: 'scratch-1',
      tombstoneVersion: 2,
      inputs: [expect.objectContaining({ key: 'url', required: true })],
      testCases: [expect.objectContaining({ id: 'case-1' })],
      goldenResponse: expect.objectContaining({ text: 'Release is verified.' }),
      resultMeta: expect.objectContaining({
        selectedCandidateId: 'strict-json',
        reversibleEdits: [expect.objectContaining({ id: 'edit-1' })],
        usage: { input: 50, output: 25, total: 75 },
      }),
    }));
    expect(importedHook.result.current.trash).toEqual([
      expect.objectContaining({ id: 'prompt-deleted', tombstoneVersion: 3 }),
    ]);
    expect(importedHook.result.current.collections).toContain('Releases');
    expect(JSON.parse(localStorage.getItem(storageKeys.packs))).toEqual(packRegistry);
    expect(JSON.parse(localStorage.getItem('pl2-pads'))).toEqual(scratchWorkspace);
    expect(input.value).toBe('');
    expect(importNotify).toHaveBeenCalledWith('Imported 1 prompts and workspace data.');
  });

  it('accepts a workspace backup containing only packs, Scratch notes, and runs', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([]));
    const notify = vi.fn();
    const { result } = renderHook(() => usePromptLibrary(notify));
    await waitFor(() => expect(result.current.libReady).toBe(true));

    const workspaceOnly = {
      product: 'Prompt Lab',
      schemaVersion: 2,
      library: [],
      packs: packRegistry,
      scratch: scratchWorkspace,
      runs: [evalRun],
    };
    const input = {
      files: [{ size: JSON.stringify(workspaceOnly).length, contents: JSON.stringify(workspaceOnly) }],
      value: 'workspace-only.json',
    };

    act(() => {
      result.current.importLib({ target: input });
    });

    await waitFor(() => {
      expect(experimentMocks.saveEvalRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }));
      expect(input.value).toBe('');
    });

    expect(result.current.library).toEqual([]);
    expect(JSON.parse(localStorage.getItem(storageKeys.packs))).toEqual(packRegistry);
    expect(JSON.parse(localStorage.getItem('pl2-pads'))).toEqual(scratchWorkspace);
    expect(notify).toHaveBeenCalledWith('Imported workspace data. No new prompts; skipped 0 duplicates.');
    expect(notify).not.toHaveBeenCalledWith('Import failed: no valid prompts found.');
  });

  it('adopts newer cross-tab mutations for every extended prompt field', async () => {
    const local = { ...richPrompt, favorite: false, tags: ['Local'], sourceNoteId: '', updatedAt: '2026-08-20T10:00:00.000Z' };
    localStorage.setItem(storageKeys.library, JSON.stringify([local]));
    const { result } = renderHook(() => usePromptLibrary(vi.fn()));
    await waitFor(() => expect(result.current.libReady).toBe(true));

    const remote = {
      ...local,
      favorite: true,
      tags: ['Remote'],
      sourceNoteId: 'scratch-remote',
      metadata: { ...local.metadata, status: 'active', owner: 'Other tab' },
      updatedAt: '2026-08-20T10:00:01.000Z',
    };
    localStorage.setItem(storageKeys.library, JSON.stringify([remote]));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: storageKeys.library })));

    await waitFor(() => expect(result.current.library[0]).toEqual(expect.objectContaining({
      favorite: true,
      tags: ['Remote'],
      sourceNoteId: 'scratch-remote',
      metadata: expect.objectContaining({ owner: 'Other tab' }),
    })));

    const previousClock = new Date(result.current.library[0].updatedAt).getTime();
    act(() => result.current.setFavorite('prompt-1', false));
    expect(new Date(result.current.library[0].updatedAt).getTime()).toBeGreaterThan(previousClock);
  });

  it('recomputes completeness for bulk and inspector-style mutations', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([{
      ...richPrompt,
      tags: [],
      metadata: { ...richPrompt.metadata, purpose: '' },
      completeness: {
        complete: false,
        missing: ['tags', 'purpose'],
        updatedAt: '2026-08-19T10:00:00.000Z',
      },
    }]));
    const { result } = renderHook(() => usePromptLibrary(vi.fn()));
    await waitFor(() => expect(result.current.libReady).toBe(true));

    act(() => result.current.updateEntries(['prompt-1'], (entry) => ({
      ...entry,
      tags: ['Operations'],
      metadata: { ...entry.metadata, purpose: 'Verify releases' },
    })));

    expect(result.current.library[0].completeness).toEqual({
      complete: true,
      missing: [],
      updatedAt: result.current.library[0].updatedAt,
    });
  });

  it('enforces the 30-day recovery cutoff', () => {
    const now = new Date('2026-08-20T12:00:00.000Z').getTime();
    expect(isTrashEntryRestorable({ deletedAt: '2026-07-22T12:00:00.000Z' }, now)).toBe(true);
    expect(isTrashEntryRestorable({ deletedAt: '2026-07-20T11:59:59.000Z' }, now)).toBe(false);
  });
});
