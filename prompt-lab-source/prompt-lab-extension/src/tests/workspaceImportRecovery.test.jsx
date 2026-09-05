import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { listEvalRuns, listTestCases } from '../experimentStore.js';
import { retryPendingWrites } from '../lib/writeRecovery.js';

vi.mock('../lib/legacyLibraryMigration.js', async (importOriginal) => ({
  ...await importOriginal(), shouldAttemptLegacyWebMigration: () => false,
}));

const prompt = (id) => ({ id, title: id, original: 'Same input', enhanced: 'Same output', currentVersionId: `${id}-version` });
class FileReaderFixture {
  readAsText(file) { queueMicrotask(() => this.onload({ target: { result: file.contents } })); }
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('pl2-library', JSON.stringify([prompt('survivor')]));
  vi.stubGlobal('FileReader', FileReaderFixture);
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('disabled'); } });
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await retryPendingWrites(); vi.unstubAllGlobals(); });

it('retains a partial import and retries stable associations once, including after reload', async () => {
  const notify = vi.fn();
  const tab = renderHook(() => usePromptLibrary(notify));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  const setItem = Storage.prototype.setItem;
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === 'pl2-eval-run-fallback') throw new Error('quota');
    return setItem.call(this, key, value);
  });
  const contents = JSON.stringify({
    library: [prompt('source')],
    testCases: [{ promptId: 'source', input: 'Case input' }],
    runs: [{ promptId: 'source', promptVersionId: 'source-version', output: 'Historical output' }],
  });
  const input = { files: [{ contents, size: contents.length }], value: 'fixture.json' };
  act(() => tab.result.current.importLib({ target: input }));
  await waitFor(() => expect(tab.result.current.importPreview?.plan).toBeTruthy());
  await act(async () => tab.result.current.confirmImport());
  await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('Import incomplete:')));
  expect(tab.result.current.pendingImport).toBe(true);
  expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Imported/));
  expect(await listEvalRuns()).toEqual([]);
  expect(await listTestCases()).toHaveLength(1);
  failure.mockRestore();
  await act(async () => { await tab.result.current.retryImport(); });
  expect(tab.result.current.pendingImport).toBe(false);
  const records = await listEvalRuns();
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ promptId: 'survivor', promptVersionId: 'survivor-version' });
  expect(await listTestCases()).toHaveLength(1);
  await retryPendingWrites();
  expect(await listEvalRuns()).toHaveLength(1);
  tab.unmount();
  const reloaded = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(reloaded.result.current.libReady).toBe(true));
  expect(reloaded.result.current.library.map((entry) => entry.id)).toEqual(['survivor']);
  expect((await listEvalRuns())[0].promptId).toBe(reloaded.result.current.library[0].id);
});

it('imports an explicit backup into the new generation after Clear Library', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  act(() => tab.result.current.clearLibrary());
  const contents = JSON.stringify([prompt('restored')]);
  const input = { files: [{ contents, size: contents.length }], value: 'backup.json' };
  act(() => tab.result.current.importLib({ target: input }));
  await waitFor(() => expect(tab.result.current.importPreview?.plan).toBeTruthy());
  await act(async () => tab.result.current.confirmImport());
  await waitFor(() => expect(input.value).toBe(''));
  expect(tab.result.current.library.map((entry) => entry.id)).toEqual(['restored']);
  expect(JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.libraryGeneration).not.toBe('0');
});

async function openPreview(tab, payload) {
  const contents = JSON.stringify(payload);
  const input = { files: [{ contents, size: contents.length, name: 'fixture.json' }], value: 'fixture.json' };
  act(() => tab.result.current.importLib({ target: input }));
  await waitFor(() => expect(tab.result.current.importPreview).toBeTruthy());
}

it('preview and Cancel perform no import writes, including workspace extras', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await openPreview(tab, { library: [{ ...prompt('new'), enhanced: 'Different body' }], scratch: { pads: [{ id: 'note', content: 'New note' }] }, runs: [{ promptId: 'new', output: 'Result' }] });
  expect(writes).not.toHaveBeenCalled();
  act(() => tab.result.current.cancelImportPreview());
  expect(writes).not.toHaveBeenCalled();
  expect(tab.result.current.importPreview).toBeNull();
  expect(tab.result.current.library.map(row => row.id)).toEqual(['survivor']);
  expect(await listEvalRuns()).toHaveLength(0);
});

it('refreshes stale preview choices without writing and preserves another tab addition on renewed Apply', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  await openPreview(tab, [{ ...prompt('new'), enhanced: 'Incoming body' }]);
  const other = { ...prompt('other'), enhanced: 'Other tab body', createdAt: new Date().toISOString() };
  localStorage.setItem('pl2-library', JSON.stringify([...tab.result.current.library, other]));
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.importPreview.notice).toContain('workspace changed');
  expect(writes).not.toHaveBeenCalled();
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.importPreview).toBeNull();
  expect(tab.result.current.library.map(row => row.id)).toEqual(expect.arrayContaining(['survivor', 'other', 'new']));
});

it('requires refreshed confirmation when Clear Library changes the destination generation', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  await openPreview(tab, [prompt('new')]);
  act(() => tab.result.current.clearLibrary());
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.importPreview.notice).toContain('workspace changed');
  expect(tab.result.current.library).toHaveLength(0);
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.library.map(row => row.id)).toEqual(['new']);
});

it('retries only unfinished stages after a run write fails', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  await openPreview(tab, { library: [prompt('source')], runs: [{ id: 'pending-run', promptId: 'source', output: 'Result' }], testCases: [{ id: 'saved-case', promptId: 'source', input: 'Example' }] });
  const original = Storage.prototype.setItem;
  let fail = true;
  const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (fail && key === 'pl2-eval-run-fallback') throw new Error('quota');
    return original.call(this, key, value);
  });
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.importPreview.completedStages).toEqual(expect.arrayContaining(['Library', 'Trash', 'Collections', 'Test case saved-case']));
  await act(async () => new Promise(resolve => setTimeout(resolve, 180)));
  writes.mockClear();
  fail = false;
  await act(async () => tab.result.current.retryImport());
  expect(writes.mock.calls.map(([key]) => key)).not.toContain('pl2-library');
  expect(writes.mock.calls.map(([key]) => key)).not.toContain('pl2-test-case-fallback');
  expect(await listEvalRuns()).toHaveLength(1);
  expect(await listTestCases()).toHaveLength(1);
});

it('shows malformed JSON errors without writing', async () => {
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  const input = { files: [{ contents: '{broken', size: 7 }], value: 'bad.json' };
  act(() => tab.result.current.importLib({ target: input }));
  await waitFor(() => expect(tab.result.current.importPreview?.error).toBeTruthy());
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.pendingImport).toBe(false);
  expect(tab.result.current.library.map(row => row.id)).toEqual(['survivor']);
});

it('preserves authored destination packs when an older export omitted its registry as an empty array', async () => {
  const registry = { 'authored-empty': { id: 'authored-empty', title: 'Empty authored pack', version: '1.0.0', source: 'authored' } };
  localStorage.setItem('pl2-packs', JSON.stringify(registry));
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  await openPreview(tab, { product: 'Prompt Lab', schemaVersion: 2, library: [prompt('source')], packs: [] });
  expect(tab.result.current.importPreview.error).toBe('');
  await act(async () => tab.result.current.confirmImport());
  expect(tab.result.current.importPreview).toBeNull();
  expect(JSON.parse(localStorage.getItem('pl2-packs'))).toEqual(registry);
});
