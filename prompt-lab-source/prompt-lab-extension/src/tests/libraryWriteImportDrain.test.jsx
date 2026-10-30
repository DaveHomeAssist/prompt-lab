import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { libraryWriteCoordinator } from '../lib/libraryWriteCoordinator.js';
import * as scratchJournal from '../lib/scratchJournal.js';

vi.mock('../lib/legacyLibraryMigration.js', async importOriginal => ({
  ...await importOriginal(), shouldAttemptLegacyWebMigration: () => false,
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('waits for the complete workspace import, including stages after an asynchronous journal write', async () => {
  localStorage.clear();
  vi.stubGlobal('FileReader', class {
    readAsText(file) { queueMicrotask(() => this.onload({ target: { result: file.contents } })); }
  });
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('fixture uses fallback'); } });
  let release;
  const durable = vi.spyOn(scratchJournal, 'commitScratchSave').mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  await waitFor(() => expect(tab.result.current.libReady).toBe(true));
  const contents = JSON.stringify({
    library: [{ id: 'new', title: 'New', original: 'Input', enhanced: 'Output', currentVersionId: 'v1' }],
    scratch: { pads: [{ id: 'note', content: 'Preserved note' }] },
    packs: { incoming: { id: 'incoming', title: 'Incoming pack', version: '1.0.0', source: 'authored' } },
  });
  act(() => tab.result.current.importLib({ target: { files: [{ contents, size: contents.length }], value: 'fixture.json' } }));
  await waitFor(() => expect(tab.result.current.importPreview?.plan).toBeTruthy());
  let importing;
  act(() => { importing = tab.result.current.confirmImport(); });
  await waitFor(() => expect(durable).toHaveBeenCalledOnce());
  let reads = 0;
  const capture = libraryWriteCoordinator.withPausedWrites(() => {
    reads += 1;
    return JSON.parse(localStorage.getItem('pl2-packs'));
  });
  expect(reads).toBe(0);
  await act(async () => { release(2); await importing; });
  const report = await capture;
  expect(report.value.incoming.id).toBe('incoming');
  expect(report.coordination.writesDrained).toBeGreaterThan(0);
  expect(tab.result.current.pendingImport).toBe(false);
});
