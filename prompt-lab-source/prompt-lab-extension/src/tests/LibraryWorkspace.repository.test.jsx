import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inspectTransfer } from '../../../library-storage/transfer.mjs';
import LibraryWorkspace from '../LibraryWorkspace.jsx';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from '../../../library-storage/contract.mjs';
import { captureSourceInventory } from '../../../library-storage/source-inventory.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../../../library-storage/command-client.mjs';
import { createAppLibraryRepository } from '../lib/appLibraryRepository.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../PackStudioPanel.jsx', () => ({ default: () => null }));
beforeEach(() => {
  localStorage.clear(); window.location.hash = '';
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:backup');
    static revokeObjectURL = vi.fn();
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const workspace = { library: [{ id: 'shared', title: 'Shared prompt', original: 'Keep original', enhanced: 'Keep enhanced',
    currentVersionId: 'current', favorite: false, tags: [' padded '], variants: [{ label: 'Opaque', content: '', future: true }],
    metadata: { owner: 'Original owner', future: { keep: true } }, future: { keep: true },
    versions: Array.from({ length: 35 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: { keep: true } })) }],
    trash: [], collections: ['Shared collection'], folders: [{ id: 'shared-folder', name: 'Shared collection', collection: 'Shared collection',
      parentId: null, artwork: { future: { keep: true } }, future: { keep: true } }] };
  const values = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]',
    'pl2-collections': JSON.stringify(workspace.collections), 'pl2-collection-folders': JSON.stringify(workspace.folders) };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'workspace-action-fixture',
    localStorage: { length: Object.keys(values).length, key: i => Object.keys(values)[i], getItem: key => values[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const imported = await service.apply({ ...await service.preview({ mode: 'import', libraryId: 'shared-library', expectedRevision: null,
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId: 'shared-library', expectedRevision: imported.revision }), idempotencyKey: 'select' });
  const entries = new Map(), outbox = createCommandOutbox({
    async read(lib, op) { return structuredClone(entries.get(canonical([lib, op])) ?? null); },
    async list(lib) { return structuredClone([...entries.values()].filter(row => row.libraryId === lib)); },
    async write(row, version) {
      const key = canonical([row.libraryId, row.operationId]);
      if ((entries.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Concurrent fixture write');
      entries.set(key, structuredClone(row));
    },
  });
  let offline = false, rateLimited = false, barrier = null, transferBarrier = null;
  const base = createServiceTransport(service, { libraryId: 'shared-library' });
  const repository = createAppLibraryRepository({ libraryId: 'shared-library', sourceBinding: imported.sourceBinding, outbox,
    transport: { ...base,
      identity: () => { if (rateLimited) throw new LibraryError('RATE_LIMIT', 'Generic transport error', 429); if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Service offline'); return base.identity(); },
      apply: async request => { if (barrier) await barrier; return base.apply(request); },
      transfer: async revision => { if (transferBarrier) await transferBarrier; return base.transfer(revision); },
    } });
  const notify = vi.fn();
  function Surface() {
    const lib = usePromptLibrary(notify, { repository });
    return <LibraryWorkspace lib={lib} loadEntry={() => {}} copy={() => {}} addToComposer={() => {}} sendToABTest={() => {}} />;
  }
  const legacy = { 'pl2-library': '[{"id":"legacy-only","original":"Untouched local source"}]',
    'pl2-library-trash': '[{"id":"legacy-trash"}]', 'pl2-collections': '["Legacy collection"]',
    'pl2-collection-folders': '[]', 'pl2-recent-artwork': '["kept"]', 'pl2-loaded-packs': '["legacy-pack"]' };
  for (const [key, value] of Object.entries(legacy)) localStorage.setItem(key, value);
  const surface = render(<Surface />);
  await screen.findByRole('button', { name: 'Favorite Shared prompt' });
  return { surface, repository, service, workspace, legacy, notify, setOffline: value => { offline = value; },
    setRateLimited: value => { rateLimited = value; },
    holdTransfer: () => { let release; transferBarrier = new Promise(resolve => { release = resolve; }); return () => { transferBarrier = null; release(); }; },
    hold: () => { let release; barrier = new Promise(resolve => { release = resolve; }); return () => { barrier = null; release(); }; } };
}

it('the actual Library hook and workspace wait for the shared favorite receipt without writing legacy data', async () => {
  const f = await fixture(), release = f.hold();
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Shared prompt' }));
  await screen.findByText('Saving to the selected Library…');
  expect(screen.getByRole('button', { name: 'Favorite Shared prompt' })).toHaveAttribute('aria-pressed', 'false');
  expect(f.notify).not.toHaveBeenCalledWith('Prompt changes saved.');
  await act(async () => release());
  await screen.findByRole('button', { name: 'Unfavorite Shared prompt' });
  const saved = await f.repository.readRecord('prompts', 'shared');
  expect(saved.favorite).toBe(true); expect(saved.versions).toHaveLength(36);
  expect(saved.variants).toEqual(f.workspace.library[0].variants); expect(saved.tags).toEqual([' padded ']);
  expect(saved.future).toEqual({ keep: true });
  await new Promise(resolve => setTimeout(resolve, 180));
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(3);
});

it('offline Library actions retain their identity and recover through the visible retry control', async () => {
  const f = await fixture(); f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Shared prompt' }));
  await screen.findByRole('button', { name: 'Retry pending changes' });
  expect(screen.getByRole('button', { name: 'Favorite Shared prompt' })).toHaveAttribute('aria-pressed', 'false');
  const pending = (await f.repository.pending()).filter(row => row.state !== 'committed');
  expect(pending).toHaveLength(1); expect(pending[0].request.mode).toBe('edit');
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Retry pending changes' }));
  await screen.findByRole('button', { name: 'Unfavorite Shared prompt' });
  expect((await f.repository.pending())[0]).toMatchObject({ operationId: pending[0].operationId, state: 'committed' });
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(3);
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('the inspector saves shared metadata while preserving hidden fields and prior history', async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Shared prompt' }));
  await waitFor(() => expect(screen.queryByText('Saving to the selected Library…')).not.toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Shared owner' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByText('Saved details for Shared prompt.');
  const saved = await f.repository.readRecord('prompts', 'shared');
  expect(saved.metadata.owner).toBe('Shared owner'); expect(saved.metadata.future).toEqual({ keep: true });
  expect(saved.versions.length).toBeGreaterThan(35); expect(saved.versions.slice(0, 35)).toEqual(f.workspace.library[0].versions);
  expect(saved.variants).toEqual(f.workspace.library[0].variants);
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('folder controls wait for creation and retry an offline rename through the shared repository', async () => {
  const f = await fixture(), release = f.hold();
  fireEvent.click(screen.getByRole('button', { name: 'Manage collections' }));
  fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Created folder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
  await screen.findByText('Saving to the selected Library…');
  expect(screen.getByLabelText('New collection name')).toHaveValue('Created folder');
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(2);
  await act(async () => release());
  await screen.findByText('Created folder Created folder.');
  expect(screen.getByLabelText('New collection name')).toHaveValue('');
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename / Move' })[0]);
  const input = screen.getByLabelText('Rename Created folder');
  fireEvent.change(input, { target: { value: 'Offline folder' } }); f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByRole('button', { name: 'Retry pending changes' });
  expect(input).toHaveValue('Offline folder');
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Retry pending changes' }));
  await waitFor(async () => expect((await f.repository.readPromptLibrary()).collections).toContain('Offline folder'));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry pending changes' })).not.toBeInTheDocument());
  expect(screen.queryByText('Folder changes were not saved. Please retry.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Rename Offline folder')).not.toBeInTheDocument();
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(4);
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('delayed folder acknowledgement preserves newer create and rename form edits', async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Manage collections' }));
  let release = f.hold();
  fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Created folder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
  await screen.findByText('Saving to the selected Library…');
  fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Next folder' } });
  await act(async () => release());
  await screen.findByText('Created folder Created folder.');
  expect(screen.getByLabelText('New collection name')).toHaveValue('Next folder');
  fireEvent.click(screen.getAllByRole('button', { name: 'Rename / Move' })[0]);
  release = f.hold();
  fireEvent.change(screen.getByLabelText('Rename Created folder'), { target: { value: 'Saved name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText('Saving to the selected Library…');
  fireEvent.change(screen.getByLabelText('Rename Created folder'), { target: { value: 'Next name' } });
  await act(async () => release());
  await screen.findByText('Folder and prompt assignments updated.');
  expect(screen.getByLabelText('Rename Saved name')).toHaveValue('Next name');
  f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByRole('button', { name: 'Retry pending changes' });
  release = f.hold(); f.setOffline(false);
  fireEvent.click(screen.getByRole('button', { name: 'Retry pending changes' }));
  await screen.findByText('Saving to the selected Library…');
  fireEvent.change(screen.getByLabelText('Rename Saved name'), { target: { value: 'Newer name' } });
  await act(async () => release());
  await screen.findByText('Folder changes saved.');
  expect(screen.getByLabelText('Rename Next name')).toHaveValue('Newer name');
  expect(screen.queryByText('Folder changes were not saved. Please retry.')).not.toBeInTheDocument();
});

it('folder artwork and removal use real controls and preserve unrelated source fields', async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Manage collections' }));
  fireEvent.click(screen.getByRole('button', { name: 'Artwork', exact: true }));
  fireEvent.click(screen.getByText('Collection artwork', { selector: 'summary' }));
  fireEvent.change(screen.getByLabelText('Collection artwork emoji'), { target: { value: '🧪' } });
  await waitFor(async () => expect((await f.repository.readPromptLibrary()).folders[0].artwork.emoji).toBe('🧪'));
  const folder = (await f.repository.readPromptLibrary()).folders[0];
  expect(folder.future).toEqual({ keep: true }); expect(folder.artwork.future).toEqual({ keep: true });
  await waitFor(() => expect(screen.queryByText('Saving to the selected Library…')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Remove folder Shared collection, keep prompts' }));
  await screen.findByText('Folder removed; its prompts remain in All prompts.');
  expect((await f.repository.readPromptLibrary()).folders).toHaveLength(0);
  expect((await f.repository.readRecord('prompts', 'shared')).versions).toEqual(f.workspace.library[0].versions);
  expect(localStorage.getItem('pl2-collection-folders')).toBe('[]');
});


const downloaded = () => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(JSON.parse(reader.result)); reader.onerror = reject;
  reader.readAsText(URL.createObjectURL.mock.calls.at(-1)[0]);
});

it('checkpoint review makes no writes and restore waits for its receipt before showing recovered content', async () => {
  const f = await fixture(), checkpoint = (await f.service.read()).revision;
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Shared prompt' }));
  await screen.findByRole('button', { name: 'Unfavorite Shared prompt' });
  const before = await f.service.read();
  fireEvent.click(screen.getByRole('button', { name: 'Recovery', exact: true }));
  await screen.findByLabelText('Recovery checkpoint');
  fireEvent.change(screen.getByLabelText('Recovery checkpoint'), { target: { value: checkpoint } });
  fireEvent.click(screen.getByRole('button', { name: 'Review checkpoint', exact: true }));
  await screen.findByText('1 active prompts after restore');
  expect(await f.service.read()).toEqual(before);
  const release = f.hold();
  fireEvent.click(screen.getByRole('button', { name: 'Restore this checkpoint', exact: true }));
  await screen.findByText('Restoring the Library…');
  expect(f.notify).not.toHaveBeenCalledWith('Library checkpoint restored. Later history and backups are retained.');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Library recovery' })).toBeInTheDocument();
  await act(async () => release());
  await screen.findByText('Checkpoint restored. Later history and backups are retained.');
  fireEvent.click(screen.getByRole('button', { name: 'Close recovery' }));
  await screen.findByRole('button', { name: 'Favorite Shared prompt' });
  const after = await f.service.read();
  expect(Object.keys(after.operations)).toHaveLength(Object.keys(before.operations).length + 1);
  for (const [id, value] of Object.entries(before.objects)) expect(after.objects[id]).toEqual(value);
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('offline checkpoint restore retains the exact review for visible retry without false success', async () => {
  const f = await fixture(), checkpoint = (await f.service.read()).revision;
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Shared prompt' }));
  await screen.findByRole('button', { name: 'Unfavorite Shared prompt' });
  fireEvent.click(screen.getByRole('button', { name: 'Recovery', exact: true }));
  await screen.findByLabelText('Recovery checkpoint');
  fireEvent.change(screen.getByLabelText('Recovery checkpoint'), { target: { value: checkpoint } });
  fireEvent.click(screen.getByRole('button', { name: 'Review checkpoint', exact: true }));
  await screen.findByText('1 active prompts after restore');
  const before = await f.service.read(); f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Restore this checkpoint', exact: true }));
  await screen.findByRole('button', { name: 'Retry this restore' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry this restore' })).toBeEnabled());
  expect(await f.service.read()).toEqual(before);
  expect(screen.queryByText('Checkpoint restored. Later history and backups are retained.')).not.toBeInTheDocument();
  const pending = (await f.repository.pending()).filter(row => row.state !== 'committed');
  expect(pending).toHaveLength(1); expect(pending[0].request.currentView).toBe('checkpoint');
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Retry this restore' }));
  await screen.findByText('Checkpoint restored. Later history and backups are retained.');
  expect((await f.repository.pending()).find(row => row.operationId === pending[0].operationId).state).toBe('committed');
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(Object.keys(before.operations).length + 1);
});

it('checkpoint listing failures can refresh and closing a reviewed checkpoint changes no data', async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole('button', { name: 'Favorite Shared prompt' }));
  await screen.findByRole('button', { name: 'Unfavorite Shared prompt' });
  const before = await f.service.read(); f.setOffline(true);
  fireEvent.click(screen.getByRole('button', { name: 'Recovery', exact: true }));
  await screen.findByRole('button', { name: 'Refresh checkpoints' });
  expect(screen.queryByRole('button', { name: 'Restore this checkpoint' })).not.toBeInTheDocument();
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Refresh checkpoints' }));
  await screen.findByLabelText('Recovery checkpoint');
  fireEvent.click(screen.getByRole('button', { name: 'Close recovery' }));
  expect(await f.service.read()).toEqual(before);
});

it('the visible Backup action waits for verification and downloads the complete saved archive', async () => {
  const f = await fixture(), before = await f.service.read(), release = f.holdTransfer();
  fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await screen.findByText('Preparing the saved Library download…');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Backup', exact: true })).toBeDisabled();
  await act(async () => release());
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  expect((await inspectTransfer(await downloaded())).state).toEqual(before);
  expect(await f.service.read()).toEqual(before);
  expect(f.notify).toHaveBeenCalledWith('Library backup download started. Retained history and backups are included.');
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('a canceled or offline backup creates no file and the online retry succeeds', async () => {
  const f = await fixture(); window.confirm.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  f.setOffline(true); fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await screen.findByText('Export failed. Library service is unavailable. Reconnect and try the export again.');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(f.notify.mock.calls.flat().some(message => message.includes('download started'))).toBe(false);
  f.setOffline(false); fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('selection export preserves raw records and does not announce success when downloading fails', async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Shared prompt' }));
  HTMLAnchorElement.prototype.click.mockImplementationOnce(() => { throw new Error('Download unavailable'); });
  fireEvent.click(screen.getByRole('button', { name: 'Export selected', exact: true }));
  await screen.findByText('Export failed. Download unavailable');
  await screen.findByText('Export was not started. Your selection is unchanged.');
  expect(screen.getByRole('checkbox', { name: 'Select Shared prompt' })).toBeChecked();
  expect(f.notify.mock.calls.flat().some(message => message.includes('download started'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Export selected', exact: true }));
  await screen.findByText('Download started for 1 selected prompts.');
  const pack = await downloaded();
  expect(pack.type).toBe('prompt-pack'); expect(pack.presets).toEqual(f.workspace.library);
  expect(Object.keys((await f.service.read()).operations)).toHaveLength(2);
  for (const [key, value] of Object.entries(f.legacy)) expect(localStorage.getItem(key)).toBe(value);
});

it('a newer service revision requires visible refresh before exporting the updated Library', async () => {
  const f = await fixture();
  await f.repository.editPrompt(await f.repository.readRecord('prompts', 'shared'), { notes: 'A newer API change' });
  fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh Library', exact: true }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
  expect((await inspectTransfer(await downloaded())).state).toEqual(await f.service.read());
});


it('rate limited exports explain the wait and permit an explicit later retry', async () => {
  const f = await fixture(); f.setRateLimited(true);
  fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await screen.findByText('Export failed. Too many Library requests. Wait a minute, then try again.');
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  f.setRateLimited(false); fireEvent.click(screen.getByRole('button', { name: 'Backup', exact: true }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));
});
