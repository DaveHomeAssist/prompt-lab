import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from '../../../library-storage/contract.mjs';
import { captureSourceInventory } from '../../../library-storage/source-inventory.mjs';
import { createCommandOutbox } from '../../../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../../../library-storage/command-client.mjs';
import { createAppLibraryRepository } from '../lib/appLibraryRepository.js';
import { AppLibraryProvider } from '../lib/AppLibraryContext.jsx';
import { createScratchRepositoryStore } from '../lib/scratchRepositoryStore.js';
import ScratchWorkspace from '../ScratchWorkspace.jsx';
import ScratchSidePanel from '../ScratchSidePanel.jsx';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function fixture({ empty = false, status = 'future-status' } = {}) {
  const libraryId = crypto.randomUUID();
  const workspace = { scratch: { pads: empty ? [] : [
      { id: 'note', name: 'Folder note', content: 'Original note', status, tags: ['tag', 'tag'], future: { retain: [1, 2] } },
      { id: 'second', name: 'Other note', content: 'Second text' },
    ] }, library: [{ id: 'prompt', title: 'Folder prompt', original: 'Prompt body' }],
    evaluations: [{ id: 'eval', promptId: 'prompt', input: 'Source', output: 'Folder output', mode: 'enhance' }],
    testCases: [{ id: 'case', promptId: 'prompt', title: 'Folder case', input: 'Original case',
      future: { preserve: ['unknown', 'fields'] }, createdAt: '2026-01-01T00:00:00Z' }] };
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]' };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: libraryId,
    localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const copied = await service.apply({ ...await service.preview({ mode: 'import', libraryId, expectedRevision: null,
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId, expectedRevision: copied.revision }), idempotencyKey: 'select' });
  const transport = createServiceTransport(service, { libraryId });
  let offline = false;
  function client() {
    const rows = new Map();
    return createAppLibraryRepository({ libraryId, sourceBinding: copied.sourceBinding,
      transport: { ...transport, identity: async () => {
        if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Service offline');
        return transport.identity();
      } },
      outbox: createCommandOutbox({
        async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
        async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
        async write(row, version) {
          const key = canonical([row.libraryId, row.operationId]);
          if ((rows.get(key)?.version ?? null) !== version) throw new Error('Fixture concurrent write');
          rows.set(key, structuredClone(row));
        },
      }),
    });
  }
  const repository = client(); await repository.open();
  const wrapper = ({ children }) => <AppLibraryProvider repository={repository}>{children}</AppLibraryProvider>;
  const notify = vi.fn();
  for (const key of ['pl2-pads', 'pl2-library', 'pl2-eval-run-fallback', 'pl2-test-case-fallback', 'pl2-run-fallback', 'pl2-experiment-fallback']) {
    localStorage.setItem(key, JSON.stringify([{ id: `legacy-${key}`, input: 'Unrelated local record' }]));
  }
  const legacy = { ...localStorage };
  return { libraryId, service, repository, client, wrapper, notify, legacy, setOffline: value => { offline = value; } };
}

const unchangedLegacy = f => expect(Object.fromEntries(Object.keys(f.legacy).map(key => [key, localStorage.getItem(key)]))).toEqual(f.legacy);
const names = { workspace: 'Scratchpad', side: 'Scratch note text' };
async function selectOriginal(surface) {
  const row = await screen.findByRole('button', { name: /Folder note/ });
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByRole('textbox', { name: names[surface] })).toHaveValue('Original note'));
}
async function mount(f, surface, repository = f.repository) {
  const Component = surface === 'workspace' ? ScratchWorkspace : ScratchSidePanel;
  const view = render(<AppLibraryProvider repository={repository}><Component m={{}} notify={f.notify} /></AppLibraryProvider>);
  const editor = screen.getByRole('textbox', { name: names[surface] });
  await selectOriginal(surface);
  return { ...view, editor };
}
async function save(surface, editor, value) {
  fireEvent.change(editor, { target: { value } });
  if (surface === 'side') fireEvent.blur(editor);
  await waitFor(async () => expect(screen.getByTestId(surface === 'side' ? 'scratch-side-save-status' : 'scratch-save-status')).toHaveAttribute('data-save-state', 'saved'), { timeout: 3000 });
}

it.each(['workspace', 'side'])('%s writes through the selected repository and preserves unknown raw fields', async surface => {
  const f = await fixture();
  const { editor } = await mount(f, surface);
  await save(surface, editor, 'Saved note $& {{input}}');
  const note = await f.repository.readRecord('scratch-notes', 'note');
  expect(note).toMatchObject({ content: 'Saved note $& {{input}}', status: 'future-status', tags: ['tag', 'tag'], future: { retain: [1, 2] } });
  expect(note).not.toHaveProperty('color');
  expect(note).not.toHaveProperty('linkedPrompts');
  unchangedLegacy(f);
});

it.each(['workspace', 'side'])('%s retains an offline draft and retries in the same library', async surface => {
  const f = await fixture();
  const { editor } = await mount(f, surface);
  f.setOffline(true);
  fireEvent.change(editor, { target: { value: 'Offline note' } });
  if (surface === 'side') fireEvent.blur(editor);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry saving' })).toBeInTheDocument(), { timeout: 3000 });
  expect(editor).toHaveValue('Offline note');
  unchangedLegacy(f);
  f.setOffline(false);
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  await waitFor(async () => expect((await f.repository.readRecord('scratch-notes', 'note')).content).toBe('Offline note'));
  expect((await f.repository.readDomain('scratch-notes')).length).toBe(2);
});

it.each(['workspace', 'side'])('%s rejects a stale edit while preserving the typed text', async surface => {
  const f = await fixture(), other = f.client(); await other.open();
  const { editor } = await mount(f, surface);
  await other.saveRecord('scratch-notes', { ...await other.readRecord('scratch-notes', 'note'), content: 'Other client' });
  // Even a different component refreshing the repository must not rebase this editor.
  await f.repository.readDomain('scratch-notes');
  fireEvent.change(editor, { target: { value: 'Retained stale draft' } });
  if (surface === 'side') fireEvent.blur(editor);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry saving' })).toBeInTheDocument(), { timeout: 3000 });
  expect(editor).toHaveValue('Retained stale draft');
  expect((await other.readRecord('scratch-notes', 'note')).content).toBe('Other client');
  unchangedLegacy(f);
});

it('Scratch deletion uses the displayed version and keeps a failed confirmation open', async () => {
  const f = await fixture(), other = f.client(); await other.open();
  await mount(f, 'workspace');
  await other.saveRecord('scratch-notes', { ...await other.readRecord('scratch-notes', 'note'), content: 'Other client' });
  await f.repository.readDomain('scratch-notes');
  fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete note' }));
  await waitFor(() => expect(screen.getByTestId('scratch-save-status')).toHaveAttribute('data-save-state', 'error'));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect((await other.readRecord('scratch-notes', 'note')).content).toBe('Other client');
  unchangedLegacy(f);
});

it.each(['workspace', 'side'])('%s keeps newer typing dirty until its own acknowledgement', async surface => {
  const f = await fixture();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const entered = vi.fn();
  const held = { ...f.repository, saveRecord: async (...args) => { entered(); await barrier; return f.repository.saveRecord(...args); } };
  const { editor } = await mount(f, surface, held);
  fireEvent.change(editor, { target: { value: 'First note edit' } });
  if (surface === 'side') fireEvent.blur(editor);
  await waitFor(() => expect(entered).toHaveBeenCalledOnce(), { timeout: 3000 });
  const status = screen.getByTestId(surface === 'side' ? 'scratch-side-save-status' : 'scratch-save-status');
  expect(status).toHaveAttribute('data-save-state', 'saving');
  fireEvent.change(editor, { target: { value: 'Newer note edit' } });
  await act(async () => { release(); });
  expect(editor).toHaveValue('Newer note edit');
  expect(status).toHaveAttribute('data-save-state', 'dirty');
  if (surface === 'side') fireEvent.blur(editor);
  await waitFor(() => expect(status).toHaveAttribute('data-save-state', 'saved'), { timeout: 3000 });
  expect((await f.repository.readRecord('scratch-notes', 'note')).content).toBe('Newer note edit');
  unchangedLegacy(f);
});

it('failed panel text survives reopening and stays scoped to its library', async () => {
  const f = await fixture();
  const View = ({ show }) => <AppLibraryProvider repository={f.repository}>{show && <ScratchSidePanel m={{}} notify={f.notify} />}</AppLibraryProvider>;
  const view = render(<View show />);
  await selectOriginal('side');
  f.setOffline(true);
  fireEvent.change(screen.getByRole('textbox', { name: names.side }), { target: { value: 'Kept panel text' } });
  view.rerender(<View show={false} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  f.setOffline(false);
  view.rerender(<View show />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: names.side })).toHaveValue('Kept panel text'));
  await waitFor(async () => expect((await f.repository.readRecord('scratch-notes', 'note')).content).toBe('Kept panel text'));
  view.unmount();
  const other = await fixture();
  await mount(other, 'side');
  expect(screen.getByRole('textbox', { name: names.side })).toHaveValue('Original note');
});

it('a deleted note is never recreated when its failed panel draft is reopened', async () => {
  const f = await fixture(), other = f.client(); await other.open();
  const View = ({ show }) => <AppLibraryProvider repository={f.repository}>{show && <ScratchSidePanel m={{}} />}</AppLibraryProvider>;
  const view = render(<View show />);
  await selectOriginal('side');
  const observed = await other.readRecord('scratch-notes', 'note');
  const { APP_RECORD_VERSION } = await import('../lib/appLibraryRepository.js');
  await other.deleteRecord('scratch-notes', 'note', observed[APP_RECORD_VERSION]);
  fireEvent.change(screen.getByRole('textbox', { name: names.side }), { target: { value: 'Keep deleted draft' } });
  view.rerender(<View show={false} />);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  view.rerender(<View show />);
  await waitFor(() => expect(screen.getByRole('textbox', { name: names.side })).toHaveValue('Keep deleted draft'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry saving' })).toBeInTheDocument());
  expect(await other.readRecord('scratch-notes', 'note')).toBeNull();
});

it('new notes are created explicitly, and an empty selected library never imports the browser default', async () => {
  const f = await fixture({ empty: true });
  render(<AppLibraryProvider repository={f.repository}><ScratchSidePanel m={{}} /></AppLibraryProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'New Scratch note' })).not.toBeDisabled());
  expect(await f.repository.readDomain('scratch-notes')).toEqual([]);
  expect(screen.getByRole('textbox', { name: names.side })).toHaveAttribute('readonly');
  fireEvent.click(screen.getByRole('button', { name: 'New Scratch note' }));
  await waitFor(async () => expect(await f.repository.readDomain('scratch-notes')).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('textbox', { name: names.side })).not.toHaveAttribute('readonly'));
  unchangedLegacy(f);
});

it('duplicate creates a new identity and preserves unknown note fields', async () => {
  const f = await fixture({ status: 'working' }); await mount(f, 'workspace');
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
  await waitFor(() => expect(f.notify, screen.getByTestId('scratch-save-status').textContent).toHaveBeenCalledWith('Duplicated note: Folder note'));
  const notes = await f.repository.readDomain('scratch-notes');
  expect(notes.find(note => note.name === 'Folder note copy')).toMatchObject({ content: 'Original note', status: 'working', tags: ['tag', 'tag'], future: { retain: [1, 2] } });
  expect(notes.find(note => note.name === 'Folder note copy').id).not.toBe('note');
  unchangedLegacy(f);
});

it('the record store rejects a multi-note mutation before writing either record', async () => {
  const f = await fixture(), store = createScratchRepositoryStore(f.repository);
  const { payload } = await store.load();
  expect((await store.persist({ ...payload, pads: payload.pads.map(pad => ({ ...pad, content: 'No partial write' })) },
    { previousState: payload, preferLocalIds: ['note', 'second'] })).ok).toBe(false);
  expect((await f.repository.readRecord('scratch-notes', 'note')).content).toBe('Original note');
  expect((await f.repository.readRecord('scratch-notes', 'second')).content).toBe('Second text');
});


it('an unsupported future enum is preserved and duplication fails without inventing a replacement', async () => {
  const f = await fixture(); await mount(f, 'workspace');
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
  await waitFor(() => expect(screen.getByTestId('scratch-save-status')).toHaveAttribute('data-save-state', 'error'));
  expect(await f.repository.readDomain('scratch-notes')).toHaveLength(2);
  expect((await f.repository.readRecord('scratch-notes', 'note')).status).toBe('future-status');
  expect(await f.repository.pending()).toEqual([]);
  expect(screen.getByRole('textbox', { name: names.workspace })).toHaveValue('Original note');
});

it.each(['workspace', 'side'])('%s retries a failed creation using one identity', async surface => {
  const f = await fixture(); await mount(f, surface);
  f.setOffline(true);
  if (surface === 'workspace') {
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note name' }), { target: { value: 'Retry creation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }));
  } else fireEvent.click(screen.getByRole('button', { name: 'New Scratch note' }));
  await waitFor(() => expect(screen.getByTestId(surface === 'workspace' ? 'scratch-save-status' : 'scratch-side-save-status')).toHaveAttribute('data-save-state', 'error'));
  f.setOffline(false);
  fireEvent.click(screen.getByRole('button', { name: surface === 'workspace' ? 'Create' : 'New Scratch note', exact: true }));
  await waitFor(async () => expect(await f.repository.readDomain('scratch-notes')).toHaveLength(3));
  unchangedLegacy(f);
});

it('rename success waits for acknowledgement and a failed rename keeps the dialog', async () => {
  const f = await fixture(); await mount(f, 'workspace');
  fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Note name' }), { target: { value: 'Retained name' } });
  f.setOffline(true);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename', exact: true }));
  await waitFor(() => expect(screen.getByTestId('scratch-save-status')).toHaveAttribute('data-save-state', 'error'));
  expect(screen.getByRole('textbox', { name: 'Note name' })).toHaveValue('Retained name');
  expect(f.notify).not.toHaveBeenCalledWith('Renamed note: Retained name');
  f.setOffline(false);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await f.repository.readRecord('scratch-notes', 'note')).name).toBe('Retained name');
});

it('a competing write during final readback cannot produce a Saved receipt for different text', async () => {
  const f = await fixture(), other = f.client(); await other.open();
  let intervene = false;
  const repository = { ...f.repository, readDomain: async domain => {
    if (intervene) {
      intervene = false;
      await other.saveRecord('scratch-notes', { ...await other.readRecord('scratch-notes', 'note'), content: 'Later client edit' });
    }
    return f.repository.readDomain(domain);
  } };
  const store = createScratchRepositoryStore(repository), { payload } = await store.load();
  intervene = true;
  const result = await store.persist({ ...payload, pads: payload.pads.map(pad => pad.id === 'note' ? { ...pad, content: 'First saved edit' } : pad) },
    { previousState: payload, preferLocalIds: ['note'] });
  expect(result.ok).toBe(false);
  expect(result.error.message).toMatch(/changed again/);
  expect((await other.readRecord('scratch-notes', 'note')).content).toBe('Later client edit');
});


it.each(['workspace', 'side'])('%s retries a failed selected-library load without touching legacy notes', async surface => {
  const f = await fixture(); f.setOffline(true);
  const Component = surface === 'workspace' ? ScratchWorkspace : ScratchSidePanel;
  render(<AppLibraryProvider repository={f.repository}><Component m={{}} /></AppLibraryProvider>);
  const retry = await screen.findByRole('button', { name: surface === 'workspace' ? 'Retry loading' : 'Retry loading notes' });
  expect(screen.getByRole('textbox', { name: names[surface] })).toHaveAttribute('readonly');
  unchangedLegacy(f);
  f.setOffline(false);
  fireEvent.click(retry);
  await selectOriginal(surface);
  expect(screen.getByRole('textbox', { name: names[surface] })).not.toHaveAttribute('readonly');
  unchangedLegacy(f);
});

it('a pending rename locks its form until the selected library acknowledges it', async () => {
  const f = await fixture();
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const entered = vi.fn();
  const held = { ...f.repository, saveRecord: async (...args) => { entered(); await barrier; return f.repository.saveRecord(...args); } };
  await mount(f, 'workspace', held);
  fireEvent.click(screen.getByRole('button', { name: 'Rename', exact: true }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Note name' }), { target: { value: 'Confirmed name' } });
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rename', exact: true }));
  await waitFor(() => expect(entered).toHaveBeenCalledOnce());
  expect(screen.getByRole('textbox', { name: 'Note name' })).toBeDisabled();
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(f.notify).not.toHaveBeenCalledWith('Renamed note: Confirmed name');
  await act(async () => { release(); });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await f.repository.readRecord('scratch-notes', 'note')).name).toBe('Confirmed name');
});

it.each(['edit', 'delete'])('updating another note cannot rebase an open editor over a competing %s', async action => {
  const f = await fixture(), other = f.client(); await other.open();
  let intervene = false;
  const repository = { ...f.repository, readDomain: async domain => {
    if (intervene) {
      intervene = false;
      const note = await other.readRecord('scratch-notes', 'note');
      if (action === 'edit') await other.saveRecord('scratch-notes', { ...note, content: 'Competing open note' });
      else {
        const { APP_RECORD_VERSION } = await import('../lib/appLibraryRepository.js');
        await other.deleteRecord('scratch-notes', 'note', note[APP_RECORD_VERSION]);
      }
    }
    return f.repository.readDomain(domain);
  } };
  const store = createScratchRepositoryStore(repository);
  const { payload } = await store.load();
  const before = { ...payload, activePadId: 'note' };
  intervene = true;
  const changed = await store.persist({ ...before, pads: before.pads.map(pad => pad.id === 'second' ? { ...pad, name: 'Other renamed note' } : pad) },
    { previousState: before, preferLocalIds: ['second'] });
  expect(changed.ok).toBe(true);
  expect(changed.state.pads.find(pad => pad.id === 'note').content).toBe('Original note');
  const stale = await store.persist({ ...changed.state, pads: changed.state.pads.map(pad => pad.id === 'note' ? { ...pad, content: 'Older editor text' } : pad) },
    { previousState: changed.state, preferLocalIds: ['note'] });
  expect(stale.ok).toBe(false);
  expect((await other.readRecord('scratch-notes', 'note'))?.content ?? null).toBe(action === 'edit' ? 'Competing open note' : null);
});

it('closing a reopened panel before its read finishes cannot save an empty initialization buffer', async () => {
  const f = await fixture();
  let hold = false, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const saveRecord = vi.fn((...args) => f.repository.saveRecord(...args));
  const repository = { ...f.repository, saveRecord, readDomain: async (...args) => {
    if (hold) await barrier;
    return f.repository.readDomain(...args);
  } };
  const View = ({ show }) => <AppLibraryProvider repository={repository}>{show && <ScratchSidePanel m={{}} />}</AppLibraryProvider>;
  const view = render(<View show />);
  await selectOriginal('side');
  view.rerender(<View show={false} />);
  hold = true;
  view.rerender(<View show />);
  view.rerender(<View show={false} />);
  await act(async () => { release(); });
  expect(saveRecord).not.toHaveBeenCalled();
  expect((await f.repository.readRecord('scratch-notes', 'note')).content).toBe('Original note');
});
