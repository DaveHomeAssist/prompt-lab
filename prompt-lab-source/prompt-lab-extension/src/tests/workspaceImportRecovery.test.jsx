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
  await waitFor(() => expect(input.value).toBe(''));
  expect(tab.result.current.library.map((entry) => entry.id)).toEqual(['restored']);
  expect(JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.libraryGeneration).not.toBe('0');
});
