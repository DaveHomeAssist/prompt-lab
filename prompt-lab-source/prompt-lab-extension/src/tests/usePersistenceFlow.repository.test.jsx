import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from '../../../library-storage/contract.mjs';
import { captureSourceInventory } from '../../../library-storage/source-inventory.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../../../library-storage/command-client.mjs';
import { createAppLibraryRepository } from '../lib/appLibraryRepository.js';
import { createPromptLibraryStore } from '../lib/promptLibraryStore.js';
import usePersistenceFlow from '../hooks/usePersistenceFlow.js';

vi.mock('../lib/platform.js', () => ({ sessionGet: (_key, callback) => callback(null), sessionSet: vi.fn() }));
beforeEach(() => { localStorage.clear(); window.location.hash = ''; });

async function fixture() {
  const workspace = { library: [{ id: 'original', original: 'Original content', currentVersionId: 'original-version',
    versions: Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, original: `History ${i}` })), future: { keep: true } }],
    runs: [{ id: 'run', input: 'Input', output: 'Result', future: { keep: true } }],
    scratch: { pads: [{ id: 'note', content: 'Source note', future: { keep: true } }], activeId: 'note', revision: 1 } };
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]', 'pl2-pads': JSON.stringify(workspace.scratch) };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'editor-fixture',
    localStorage: { length: 3, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const copied = await service.apply({ ...await service.preview({ mode: 'import', libraryId: 'editor-lib', expectedRevision: null,
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId: 'editor-lib', expectedRevision: copied.revision }), idempotencyKey: 'select' });
  const rows = new Map();
  const store = {
    async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
    async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
    async write(row, version) {
      const key = canonical([row.libraryId, row.operationId]);
      if ((rows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Concurrent fixture write');
      rows.set(key, structuredClone(row));
    },
  };
  const transport = createServiceTransport(service, { libraryId: 'editor-lib' });
  let offline = false;
  const options = { libraryId: 'editor-lib', sourceBinding: copied.sourceBinding, outbox: createCommandOutbox(store), transport: {
    ...transport, identity: async () => { if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Service offline'); return transport.identity(); },
  } };
  const repository = createAppLibraryRepository(options), notify = vi.fn();
  const lib = createPromptLibraryStore(repository, { notify, newId: () => 'retained-editor-draft' }); await lib.open();
  const hook = renderHook(() => {
    const [raw, setRaw] = useState('Complete editor draft'), [enhanced, setEnhanced] = useState('');
    const [variants, setVariants] = useState([]), [notes, setNotes] = useState('');
    const flow = usePersistenceFlow({ ui: { notify, setTab() {}, tab: 'editor', setABVariant() {} }, lib,
      editor: { raw, enhanced, variants, notes, resultMeta: null, enhMode: 'balanced', setRaw, setEnhanced, setVariants, setNotes, setEnhMode() {}, setComposerBlocks() {} } });
    return { ...flow, raw, setRaw };
  });
  return { ...hook, lib, notify, repository, service, options, setOffline: value => { offline = value; } };
}

it('actual editor save reports the selected library revision and keeps legacy browser data untouched', async () => {
  const f = await fixture();
  localStorage.setItem('pl2-library', '[{"id":"unrelated-local"}]');
  localStorage.setItem('pl2-pads', '{"pads":[{"id":"note","linkedPromptId":"local-owner"}]}');
  const before = { ...localStorage };
  act(() => { f.result.current.openSavePanel(); f.result.current.setSourceNoteId('note'); });
  let result;
  await act(async () => { result = await f.result.current.doSave(); });
  expect(result.libraryId).toBe('editor-lib');
  expect(f.result.current.lastSaveReceipt).toMatchObject({ libraryId: 'editor-lib', revision: result.revision, operationId: result.operationId });
  expect(f.result.current.showSave).toBe(false); expect(f.result.current.raw).toBe('Complete editor draft');
  expect((await f.service.operation(result.operationId)).revision).toBe(result.revision);
  await waitFor(async () => expect((await f.repository.readRecord('scratch-notes', 'note')).linkedPromptId).toBe(result.id));
  expect({ ...localStorage }).toEqual(before);
});

it('offline editor keeps its panel and draft, then recovers one creation after repository restart', async () => {
  const f = await fixture(); act(() => f.result.current.openSavePanel()); f.setOffline(true);
  await act(async () => expect(await f.result.current.doSave()).toBeNull());
  expect(f.result.current.showSave).toBe(true); expect(f.result.current.lastSaveReceipt).toBeNull();
  expect(f.result.current.raw).toBe('Complete editor draft'); expect(f.lib.saveError).toContain('draft is still available');
  expect((await f.repository.pending())[0]).toMatchObject({ schemaVersion: 3, reviewHash: null, request: { mode: 'create' } });
  f.setOffline(false); const restarted = createAppLibraryRepository(f.options); await restarted.open();
  await act(async () => expect(await f.result.current.doSave()).not.toBeNull());
  expect((await restarted.readPromptLibrary()).library).toHaveLength(2);
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(3);
});

it('actual editor updates an observed prompt without truncating its prior versions', async () => {
  const f = await fixture(), entry = f.lib.library.find(row => row.id === 'original');
  act(() => { f.result.current.setEditingId(entry.id); f.result.current.setEditingVersionId(entry.currentVersionId); f.result.current.openSavePanel(); });
  let saved;
  await act(async () => { saved = await f.result.current.doSave(); });
  expect(saved.id).toBe('original'); expect(saved.versionNumber).toBe(32);
  const row = await f.repository.readRecord('prompts', 'original');
  expect(row.versions).toHaveLength(31); expect(row.versions.at(-1).original).toBe('Original content');
  expect(row.future).toEqual({ keep: true }); expect(row.original).toBe('Complete editor draft');
  expect(f.result.current.lastSaveReceipt).toMatchObject({ libraryId: 'editor-lib', revision: saved.revision, action: 'version' });
});

it('a missing shared Scratch link reports repair without changing the legacy note', async () => {
  const f = await fixture();
  localStorage.setItem('pl2-pads', '{"pads":[{"id":"missing-note","linkedPromptId":"local-owner"}]}');
  const original = localStorage.getItem('pl2-pads');
  act(() => { f.result.current.openSavePanel(); f.result.current.setSourceNoteId('missing-note'); });
  await act(async () => expect((await f.result.current.doSave()).libraryId).toBe('editor-lib'));
  await waitFor(() => expect(f.notify).toHaveBeenCalledWith('Prompt saved to the selected Library. Related run or Scratch links need retry.'));
  expect(localStorage.getItem('pl2-pads')).toBe(original);
  expect((await f.repository.readPromptLibrary()).library).toHaveLength(2);
});
