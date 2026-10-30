import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from '../../../library-storage/contract.mjs';
import { captureSourceInventory } from '../../../library-storage/source-inventory.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../../../library-storage/command-client.mjs';
import { createAppLibraryRepository } from '../lib/appLibraryRepository.js';
import { createPromptLibraryStore } from '../lib/promptLibraryStore.js';
import { useRepositoryPromptLibrary } from '../hooks/useRepositoryPromptLibrary.js';
import { exportPackFromEntries } from '../lib/packExport.js';
import PackStudioPanel from '../PackStudioPanel.jsx';
import WorkspaceImportModal from '../modals/WorkspaceImportModal.jsx';
import usePersistenceFlow from '../hooks/usePersistenceFlow.js';
import { encodePackShare } from '../lib/packExport.js';
import { detectDuplicates } from '../lib/presetMatching.js';
import { getLibraryEntrySignature } from '../lib/libraryMatching.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear(); window.location.hash = '';
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:pack');
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const libraryId = crypto.randomUUID();
  const workspace = { library: [
    { id: 'p', title: 'Existing member', original: 'Retain $& {{input}}', metadata: { packId: 'starter_pack', extra: { keep: true } },
      versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: i })), future: { keep: ['all'] } },
    { id: 'q', title: 'Unassigned prompt', original: 'Unassigned', future: { retained: true } },
  ], packs: { starter_pack: { id: 'starter_pack', title: 'Existing pack', version: '2.1.3', source: 'imported', future: { retain: [1, 2] } } },
  loadedPacks: ['starter_pack'], scratch: { pads: [{ id: 'note', content: 'Retained note' }] } };
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]' };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: libraryId,
    localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const imported = await service.apply({ ...await service.preview({ mode: 'import', libraryId, expectedRevision: null,
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId, expectedRevision: imported.revision }), idempotencyKey: 'select' });
  const transport = createServiceTransport(service, { libraryId });
  let offline = false, beforeApply = async () => {}, afterApply = async () => {};
  function client(sharedRows = new Map()) {
    return createAppLibraryRepository({ libraryId, sourceBinding: imported.sourceBinding,
      transport: { ...transport, identity: async () => {
        if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Service offline');
        return transport.identity();
      }, apply: async input => { await beforeApply(); const result = await transport.apply(input); await afterApply(); return result; } },
      outbox: createCommandOutbox({
        async read(lib, op) { return structuredClone(sharedRows.get(canonical([lib, op])) ?? null); },
        async list(lib) { return structuredClone([...sharedRows.values()].filter(row => row.libraryId === lib)); },
        async write(row, version) {
          const key = canonical([row.libraryId, row.operationId]);
          if ((sharedRows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Concurrent write');
          sharedRows.set(key, structuredClone(row));
        },
      }),
    });
  }
  const rows = new Map(), repository = client(rows); await repository.open();
  const notify = vi.fn();
  localStorage.setItem('pl2-packs', JSON.stringify({ unrelated: { id: 'unrelated', title: 'Browser only', source: 'authored' } }));
  localStorage.setItem('pl2-library', JSON.stringify([{ id: 'local', title: 'Browser prompt' }]));
  const legacy = { ...localStorage };
  return { libraryId, service, repository, client, rows, workspace, notify, legacy,
    setOffline: value => { offline = value; }, beforeApply: fn => { beforeApply = fn; }, afterApply: fn => { afterApply = fn; } };
}
function Studio({ repository, notify }) {
  const lib = useRepositoryPromptLibrary(repository, notify);
  return <PackStudioPanel m={{}} lib={lib} />;
}
async function mount(f, repository = f.repository) {
  const result = render(<Studio repository={repository} notify={f.notify} />);
  await screen.findByText('Existing pack');
  return result;
}
const legacyUnchanged = f => expect({ ...localStorage }).toEqual(f.legacy);
const packRow = () => screen.getByText('Existing pack').parentElement.parentElement;
const operationCount = async f => Object.keys((await f.service.read()).operations).length;
const downloadedPack = () => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject;
  reader.readAsText(URL.createObjectURL.mock.calls.at(-1)[0]);
});
function publish() {
  fireEvent.change(screen.getByRole('textbox', { name: 'New pack name' }), { target: { value: 'New pack' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Unassigned prompt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export 1 prompts as JSON' }));
}

it('reads the selected registry and publishes membership plus metadata as one confirmed operation', async () => {
  const f = await fixture(); await mount(f); const before = await f.service.read();
  expect(screen.queryByText('Browser only')).not.toBeInTheDocument();
  publish();
  await screen.findByText('Exported 1 prompts as New pack.');
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(await operationCount(f)).toBe(Object.keys(before.operations).length + 1);
  expect(await f.repository.readRecord('prompts', 'q')).toMatchObject({ metadata: { packId: 'new-pack' }, future: { retained: true } });
  expect(await f.repository.readRecord('packs', 'new-pack')).toMatchObject({ title: 'New pack', version: '1.0.0' });
  const after = await f.service.read();
  for (const [key, value] of Object.entries(before.objects)) expect(after.objects[key]).toEqual(value);
  legacyUnchanged(f);
});

it('keeps choices and suppresses download and success while acknowledgement is pending', async () => {
  const f = await fixture(); await mount(f); let release;
  f.beforeApply(() => new Promise(resolve => { release = resolve; }));
  publish(); await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByRole('textbox', { name: 'New pack name' })).toHaveValue('New pack');
  expect(screen.getByRole('checkbox', { name: 'Unassigned prompt' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Close pack studio' })).toBeDisabled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByText(/Exported 1/)).not.toBeInTheDocument();
  await act(async () => release());
  await screen.findByText('Exported 1 prompts as New pack.');
  expect(screen.getByRole('textbox', { name: 'New pack name' })).toHaveValue('');
});

it('retains an offline pack intent and retries the exact command without browser fallback', async () => {
  const f = await fixture(); await mount(f); const count = await operationCount(f);
  f.setOffline(true); publish();
  const retry = await screen.findByRole('button', { name: 'Retry pack change' });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'New pack name' })).toHaveValue('New pack');
  const [pending] = await f.repository.pending();
  expect(pending).toMatchObject({ schemaVersion: 3, state: 'failed', request: { mode: 'pack', action: 'publish' } });
  legacyUnchanged(f); f.setOffline(false); fireEvent.click(retry);
  await screen.findByText('Exported 1 prompts as New pack.');
  expect(await operationCount(f)).toBe(count + 1);
  expect((await f.repository.pending())[0].operationId).toBe(pending.operationId);
  legacyUnchanged(f);
});

it('replays a retained offline publication after repository restart', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  const count = await operationCount(f); f.setOffline(true);
  expect(await store.publishPack({ id: 'new', title: 'New', version: '1', source: 'authored' }, ['q'], store.revision)).toBe(false);
  f.setOffline(false); const restarted = f.client(f.rows); await restarted.open();
  expect(await restarted.readRecord('packs', 'new')).toMatchObject({ title: 'New' });
  expect(await operationCount(f)).toBe(count + 1); legacyUnchanged(f);
});

it('recovers a lost publication response without repeating the commit or incrementing the version', async () => {
  const f = await fixture(); await mount(f); const count = await operationCount(f); let fail = true;
  f.afterApply(async () => { if (fail) { fail = false; throw new Error('Lost response'); } });
  fireEvent.click(within(packRow()).getByRole('button', { name: 'Update' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry pack change' }));
  await screen.findByText('Updated Existing pack to v2.1.4 with 1 prompts.');
  expect(await operationCount(f)).toBe(count + 1);
  const pack = await f.repository.readRecord('packs', 'starter_pack');
  expect(pack).toMatchObject({ id: 'starter_pack', version: '2.1.4', future: { retain: [1, 2] } });
  expect((await f.repository.readDomain('packs')).length).toBe(1);
  expect((await downloadedPack()).presets[0].versions).toEqual(f.workspace.library[0].versions);
  const prompt = await f.repository.readRecord('prompts', 'p');
  expect(prompt.versions.slice(0, 41)).toEqual(f.workspace.library[0].versions);
  expect(prompt.future).toEqual({ keep: ['all'] }); legacyUnchanged(f);
});

it('rejects stale pack choices even after another component refreshes the repository cache', async () => {
  const f = await fixture(); await mount(f); const other = f.client(); await other.open();
  await other.editPrompt(await other.readRecord('prompts', 'q'), { original: 'Competing edit' });
  await f.repository.readDomain('prompts'); const count = await operationCount(f);
  publish(); await screen.findByRole('button', { name: 'Retry pack change' });
  expect(await operationCount(f)).toBe(count);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(await f.repository.readRecord('prompts', 'q')).toMatchObject({ original: 'Competing edit' });
  legacyUnchanged(f);
});

it('does not report successful readback after another client changes the committed pack', async () => {
  const f = await fixture(), other = f.client(); await other.open();
  const repository = { ...f.repository, changePack: async (...args) => {
    const result = await f.repository.changePack(...args);
    await other.editPrompt(await other.readRecord('prompts', 'q'), { notes: 'Later change' });
    return result;
  } };
  await mount(f, repository); publish();
  await screen.findByRole('button', { name: 'Retry pack change' });
  expect(f.notify).toHaveBeenCalledWith(expect.stringMatching(/Another change followed this pack operation/));
  expect(URL.createObjectURL).not.toHaveBeenCalled(); legacyUnchanged(f);
});

it('uninstalls the selected pack atomically into Trash without erasing original history or other records', async () => {
  const f = await fixture(); await mount(f); const before = await f.service.read();
  fireEvent.click(within(packRow()).getByRole('button', { name: 'Uninstall' }));
  await screen.findByText('Moved 1 prompts from Existing pack to Recently Deleted.');
  const view = await f.repository.readPromptLibrary();
  expect(view.library.map(row => row.id)).toEqual(['q']);
  expect(view.trash[0]).toMatchObject(f.workspace.library[0]);
  expect(view.packs).toEqual({});
  const after = await f.service.read();
  const marker = await f.service.currentRecords({ libraryId: f.libraryId, expectedRevision: after.revision, domain: 'loaded-packs' });
  expect(marker.items).toEqual([]);
  for (const [key, value] of Object.entries(before.objects)) expect(after.objects[key]).toEqual(value);
  expect(await operationCount(f)).toBe(Object.keys(before.operations).length + 1);
  legacyUnchanged(f);
});

it('retries a failed uninstall without a second confirmation or premature disappearance', async () => {
  const f = await fixture(); await mount(f); f.setOffline(true);
  fireEvent.click(within(packRow()).getByRole('button', { name: 'Uninstall' }));
  const retry = await screen.findByRole('button', { name: 'Retry pack change' });
  expect(screen.getByText('Existing pack')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Existing member' })).toBeInTheDocument();
  f.setOffline(false); fireEvent.click(retry);
  await screen.findByText('Moved 1 prompts from Existing pack to Recently Deleted.');
  expect(window.confirm).toHaveBeenCalledTimes(1); legacyUnchanged(f);
});

it('retries only the download after a committed update if the browser download fails', async () => {
  const f = await fixture(); await mount(f); const count = await operationCount(f);
  URL.createObjectURL.mockImplementationOnce(() => { throw new Error('Download unavailable'); });
  fireEvent.click(within(packRow()).getByRole('button', { name: 'Update' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry pack download' }));
  await screen.findByText('Updated Existing pack to v2.1.4 with 1 prompts.');
  expect(await operationCount(f)).toBe(count + 1);
});

it('refuses implicit replacement when a newly published name collides with an existing pack', async () => {
  const f = await fixture(); await mount(f);
  const store = createPromptLibraryStore(f.repository); await store.open();
  await store.publishPack({ id: 'new-pack', title: 'Existing new pack', version: '7', source: 'authored' }, ['q'], store.revision);
  cleanup(); await mount(f); const count = await operationCount(f); publish();
  await screen.findByText(/A pack with this name already exists/);
  expect(await operationCount(f)).toBe(count);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('never falls back to the browser registry when selected-library pack methods are unavailable', async () => {
  const f = await fixture(), view = await f.repository.readPromptLibrary();
  render(<PackStudioPanel m={{}} lib={{ ...view, repository: f.repository, libReady: true, packRegistry: view.packs }} />);
  publish(); await screen.findByRole('button', { name: 'Retry pack change' });
  expect(URL.createObjectURL).not.toHaveBeenCalled(); legacyUnchanged(f);
});

it('keeps existing browser publication available when no repository is selected', async () => {
  const assignEntriesToPack = vi.fn();
  render(<PackStudioPanel m={{}} lib={{ library: [{ id: 'q', title: 'Unassigned prompt', original: 'Body' }], assignEntriesToPack }} />);
  publish(); await screen.findByText('Exported 1 prompts as New pack.');
  expect(assignEntriesToPack).toHaveBeenCalledWith(['q'], 'new-pack', 'New pack');
  expect(JSON.parse(localStorage.getItem('pl2-packs'))['new-pack']).toMatchObject({ title: 'New pack' });
});

it('exports unknown prompt fields, complete history and the stable existing pack identity', async () => {
  const f = await fixture();
  const pack = exportPackFromEntries(f.workspace.library, { id: 'starter_pack', title: 'Existing pack' });
  expect(pack.id).toBe('starter_pack');
  expect(pack.presets[0].future).toEqual({ keep: ['all'] });
  expect(pack.presets[0].versions).toEqual(f.workspace.library[0].versions);
});

const importedPack = () => ({ type: 'prompt-pack', id: 'reviewed-pack', title: 'Reviewed pack', version: '3', future: { retained: true },
  presets: [{ id: 'p', title: 'Existing member', original: 'Replacement body', prompt: 'Replacement body',
    future: { incoming: true }, versions: Array.from({ length: 43 }, (_, i) => ({ id: `incoming-${i}`, original: `Incoming ${i}`, unknown: i })) },
  { id: 'new', title: 'Zebra study', prompt: 'New content', metadata: { opaque: [1, 2, 3] } }] });

function ImportSurface({ repository, notify }) {
  const lib = useRepositoryPromptLibrary(repository, notify);
  return <><output>{lib.libReady ? 'Library ready' : 'Opening Library'}</output><input aria-label="Pack file" type="file" onChange={lib.importLib} />
    {lib.starterLibraries.map(pack => <button key={pack.id} onClick={() => lib.loadStarterPack(pack.id)} disabled={pack.loaded}>{pack.name}: {pack.loaded ? 'Loaded' : 'Review'}</button>)}
    {lib.saveError && <p role="status">{lib.saveError}</p>}
    {lib.pendingImport && !lib.importPreview && <button onClick={lib.retryImport}>Reopen pending import</button>}
    {lib.importPreview && <WorkspaceImportModal m={{}} preview={lib.importPreview} applying={lib.importApplying}
      onChoice={lib.chooseImportResolution} onApply={lib.confirmImport} onRetry={lib.retryImport} onClose={lib.cancelImportPreview} />}
  </>;
}
async function reviewFile(f, pack = importedPack()) {
  render(<ImportSurface repository={f.repository} notify={f.notify} />);
  await screen.findByText('Library ready');
  const text = ' \n' + JSON.stringify(pack, null, 3) + '\n';
  await act(async () => { await f.repository.readPromptLibrary(); });
  fireEvent.change(screen.getByLabelText('Pack file'), { target: { files: [new File([text], 'reviewed.json', { type: 'application/json' })] } });
  await screen.findByRole('dialog');
  return text;
}

it('reviews a real pack file without writes, then preserves both histories and exact raw source in one acknowledged import', async () => {
  const f = await fixture(), before = await f.service.read(), pack = importedPack();
  const text = await reviewFile(f, pack);
  expect(await f.service.read()).toEqual(before);
  expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Conflict action for Existing member'), { target: { value: 'replace' } });
  fireEvent.change(screen.getByLabelText('Conflict action for Zebra study'), { target: { value: 'skip' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const result = await f.repository.readRecord('prompts', 'p');
  expect(result.original).toBe('Replacement body');
  expect(result.versions.slice(0, 41)).toEqual(f.workspace.library[0].versions);
  expect(result.versions.slice(42)).toEqual(pack.presets[0].versions);
  expect(result.future).toEqual({ keep: ['all'], incoming: true });
  expect((await f.repository.readPromptLibrary()).loadedPacks).toContain('reviewed-pack');
  const after = await f.service.read();
  expect(Object.keys(after.operations)).toHaveLength(Object.keys(before.operations).length + 1);
  expect(Object.values(after.objects).some(object => object.kind === 'pack-source' && object.data === text)).toBe(true);
  expect((await f.repository.readRecord('packs', 'reviewed-pack')).presets[1]).toEqual(pack.presets[1]);
  for (const [key, value] of Object.entries(before.objects)) expect(after.objects[key]).toEqual(value);
  legacyUnchanged(f);
});

it('keeps the reviewed file and choices visible until acknowledgement and refuses close while pending', async () => {
  const f = await fixture(); let release;
  const pack = importedPack(); pack.presets = [pack.presets[1]];
  await reviewFile(f, pack);
  f.beforeApply(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  expect(screen.getByRole('button', { name: 'Applying import…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Close import preview' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(f.notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Pack imported/));
  await act(async () => release());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('retains an offline import, hides without discarding it and retries exactly once', async () => {
  const f = await fixture(), pack = importedPack(); pack.presets = [pack.presets[1]];
  await reviewFile(f, pack); const count = await operationCount(f); f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
  await screen.findByRole('button', { name: 'Retry import' });
  const retained = (await f.repository.pending())[0]; expect(retained.request.action).toBe('install');
  expect(await operationCount(f)).toBe(count); legacyUnchanged(f);
  fireEvent.click(screen.getByRole('button', { name: 'Close import preview' }));
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Reopen pending import' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(async () => expect(await operationCount(f)).toBe(count + 1));
  expect((await f.repository.pending())[0].operationId).toBe(retained.operationId);
  legacyUnchanged(f);
});

it('replays the complete reviewed import after restart without losing skipped original records', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  const raw = JSON.stringify(importedPack()); store.reviewPackImport(raw, 'restart.json');
  store.chooseImportResolution('pack-preset-0', { action: 'skip' });
  f.setOffline(true); expect(await store.confirmImport()).toBe(false);
  const retained = (await f.repository.pending())[0], count = await operationCount(f);
  f.setOffline(false); const restarted = f.client(f.rows); await restarted.open();
  const pack = await restarted.readRecord('packs', 'reviewed-pack');
  expect(pack.presets).toEqual(importedPack().presets);
  expect(await operationCount(f)).toBe(count + 1);
  expect((await restarted.pending())[0]).toMatchObject({ operationId: retained.operationId, state: 'committed' });
  legacyUnchanged(f);
});

it('recovers a lost installation response with no second version or publication', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  store.reviewPackImport(JSON.stringify(importedPack()));
  store.chooseImportResolution('pack-preset-0', { action: 'replace', existingId: 'p' });
  const count = await operationCount(f); let failure = true;
  f.afterApply(async () => { if (failure) { failure = false; throw new Error('Response lost'); } });
  expect(await store.confirmImport()).toBe(false);
  expect(await store.retryPending()).toBeTruthy();
  expect(store.importPreview).toBe(null); expect(await operationCount(f)).toBe(count + 1);
  expect((await f.repository.readRecord('prompts', 'p')).versions).toHaveLength(85);
});

it('rejects a stale replacement review without overwriting a competing client or falling back', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  store.reviewPackImport(JSON.stringify(importedPack())); store.chooseImportResolution('pack-preset-0', { action: 'replace', existingId: 'p' });
  const other = f.client(); await other.open(); await other.editPrompt(await other.readRecord('prompts', 'p'), { original: 'Independent update' });
  await f.repository.readPromptLibrary(); const count = await operationCount(f);
  expect(await store.confirmImport()).toBe(false);
  expect(store.importPreview.error).toMatch(/changed|REVISION|review/i);
  expect((await other.readRecord('prompts', 'p')).original).toBe('Independent update');
  expect(await operationCount(f)).toBe(count); legacyUnchanged(f);
});

it('rejects malformed history before retaining an impossible write and allows explicit skip with original source retention', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  const pack = importedPack(); pack.presets[1].versions = ['future-history'];
  store.reviewPackImport(JSON.stringify(pack)); store.chooseImportResolution('pack-preset-0', { action: 'skip' });
  expect(await store.confirmImport()).toBe(false); expect(await f.repository.pending()).toEqual([]);
  expect(store.pendingImport).toBe(false);
  store.chooseImportResolution('pack-preset-1', { action: 'skip' });
  expect(await store.confirmImport()).toBeTruthy();
  expect((await f.repository.readRecord('packs', 'reviewed-pack')).presets[1].versions).toEqual(['future-history']);
});

it('requires distinct replacement targets and keeps duplicate preset identities independently reviewable', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  const pack = importedPack(); pack.presets = [pack.presets[0], { ...pack.presets[0], prompt: 'Second incoming', original: 'Second incoming' }];
  store.reviewPackImport(JSON.stringify(pack));
  for (const id of ['pack-preset-0', 'pack-preset-1']) store.chooseImportResolution(id, { action: 'replace', existingId: 'p' });
  expect(await store.confirmImport()).toBe(false); expect(await f.repository.pending()).toEqual([]);
  store.chooseImportResolution('pack-preset-1', { action: 'keep' });
  expect(await store.confirmImport()).toBeTruthy(); expect(store.library).toHaveLength(3);
});

it('opens a shared pack for review instead of using the legacy importer or reporting it loaded', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository); await store.open();
  const pack = importedPack(); window.location.hash = `#pack=${encodePackShare(pack)}`;
  const setTab = vi.fn();
  renderHook(() => usePersistenceFlow({ ui: { notify: f.notify, setTab, setABVariant: vi.fn(), tab: 'editor' },
    lib: { repository: f.repository, libReady: true, library: store.library, reviewPackImport: store.reviewPackImport, setLibrary: vi.fn() },
    editor: { raw: '', enhanced: '', variants: [], notes: '', setRaw: vi.fn(), setEnhanced: vi.fn(), setVariants: vi.fn(), setNotes: vi.fn(), setEnhMode: vi.fn(), setComposerBlocks: vi.fn() } }));
  await waitFor(() => expect(store.importPreview?.fileName).toBe('Shared pack'));
  expect(await operationCount(f)).toBe(2); expect(setTab).toHaveBeenCalledWith('library');
  expect(f.notify).not.toHaveBeenCalledWith(expect.stringMatching(/Shared pack loaded/)); legacyUnchanged(f);
});

it('shows starter loaded state from the selected library only after the reviewed installation is acknowledged', async () => {
  const f = await fixture(); localStorage.setItem('pl2-loaded-packs', '["lib_notion_formatter"]');
  render(<ImportSurface repository={f.repository} notify={f.notify} />);
  await screen.findByText('Library ready');
  const button = await screen.findByRole('button', { name: /Notion Page Formatter.*Review/i });
  await act(async () => { await f.repository.readPromptLibrary(); });
  fireEvent.click(button); await screen.findByRole('dialog');
  expect(button).toBeEnabled(); expect(await operationCount(f)).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Apply import' }));
  await screen.findByRole('button', { name: /Notion Page Formatter.*Loaded/i });
  expect(await operationCount(f)).toBe(3);
  expect(localStorage.getItem('pl2-loaded-packs')).toBe('["lib_notion_formatter"]');
});

it('does not silently skip different prompt bodies that share the old short matching hash', () => {
  const first = { id: 'one', title: 'Alpha', prompt: 'a~' }, second = { id: 'two', title: 'Zebra', original: 'b]' };
  expect(getLibraryEntrySignature(first)).toBe(getLibraryEntrySignature(second));
  expect(detectDuplicates([first], [second]).filter(row => row.reason === 'prompt-exact-match')).toEqual([]);
});

it('imports collection paths after folder edits and maps foreign folder IDs without changing existing folders', async () => {
  const f = await fixture(), store = createPromptLibraryStore(f.repository, f.notify); await store.open();
  expect(await store.saveFolders([{ id: 'local-folder', name: 'Existing', parentId: null, collection: 'Existing' }])).toBe(true);
  const existingFolder = (await f.repository.readPromptLibrary()).folders[0];
  const before = await f.service.read();
  const sourceText = JSON.stringify({ type: 'prompt-pack', id: 'folders-pack', title: 'Folders', version: '1', presets: [
    { id: 'one', title: 'First imported', prompt: 'First imported content', collection: 'Imported/Literal', folderId: 'foreign-folder' },
    { id: 'two', title: 'Second imported', prompt: 'Second imported content', collection: 'Existing', folderId: 'another-foreign-folder' },
  ] });
  expect(await store.reviewPackImport(sourceText, 'Folders pack')).toBe(true);
  expect(await store.confirmImport()).toBeTruthy();
  const view = await f.repository.readPromptLibrary(), created = view.folders.find(row => row.collection === 'Imported/Literal');
  expect(created).toMatchObject({ name: 'Imported/Literal', parentId: null });
  expect(created.id).not.toBe('foreign-folder');
  expect(view.folders.find(row => row.id === 'local-folder')).toEqual(existingFolder);
  expect(view.library.find(row => row.title === 'First imported').folderId).toBe(created.id);
  expect(view.library.find(row => row.title === 'Second imported').folderId).toBe('local-folder');
  expect(view.collections.sort()).toEqual(['Existing', 'Imported/Literal']);
  const after = await f.service.read();
  expect(Object.keys(after.operations).length).toBe(Object.keys(before.operations).length + 1);
  expect(Object.values(after.objects).some(row => row.kind === 'pack-source' && row.data === sourceText)).toBe(true);
  for (const [key, value] of Object.entries(before.objects)) expect(after.objects[key]).toEqual(value);
  const reopened = f.client(); await reopened.open();
  expect((await reopened.readPromptLibrary()).folders).toEqual(view.folders);
});
