import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScratchWorkspace from '../ScratchWorkspace.jsx';
import ScratchSidePanel from '../ScratchSidePanel.jsx';
import { createFakeIndexedDb } from './helpers/fakeIndexedDb.js';
import { createLibraryJournal, LIBRARY_JOURNAL_RECORD } from '../lib/libraryJournal.js';
import { createScratchJournal, getScratchDurability, SCRATCH_JOURNAL_RECORD, startScratchJournal } from '../lib/scratchJournal.js';
import { buildDefaultScratchPayload, migrateScratchStorage, persistScratchState, SCRATCH_KEY, SCRATCH_SCHEMA_VERSION_KEY } from '../lib/scratchSchema.js';

let idb;
const stops = [];
const boot = async options => {
  const started = await startScratchJournal({ storage: localStorage, idb, ...options });
  stops.push(started.stop);
  return started;
};
const mirror = () => Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index); return [key, localStorage.getItem(key)];
}));
const replaceMirror = entries => { localStorage.clear(); Object.entries(entries).forEach(([key, value]) => localStorage.setItem(key, value)); };
const seed = () => {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify(buildDefaultScratchPayload('Previously committed note', 1000)));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '4');
};
const edit = content => ({ ...JSON.parse(localStorage.getItem(SCRATCH_KEY)), pads: [{
  ...JSON.parse(localStorage.getItem(SCRATCH_KEY)).pads[0], content, updatedAt: 2000, timestamp: 2000,
}] });
beforeEach(() => { localStorage.clear(); idb = createFakeIndexedDb(); window.__TAURI_INTERNALS__ = {}; });
afterEach(() => {
  cleanup(); stops.splice(0).forEach(stop => stop()); delete window.__TAURI_INTERNALS__;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('recovers an acknowledged Scratch snapshot when WebView2 loses its localStorage batch', async () => {
  seed(); const first = await boot(); const before = mirror();
  const saved = persistScratchState(edit('Survives native restart'));
  await saved.durable;
  first.stop(); replaceMirror(before);
  const restarted = await boot();
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY))).toEqual(saved.state);
  expect(restarted.outcome.action).toBe('restore');
  expect(saved.durable).toBeInstanceOf(Promise);
  expect(localStorage.getItem(SCRATCH_SCHEMA_VERSION_KEY)).toBe('4');
  expect(idb.transactions.filter(tx => tx.mode === 'readwrite').every(tx => tx.options.durability === 'strict')).toBe(true);
});

it('keeps Library and Scratch records and recovery scopes independent', async () => {
  localStorage.setItem('pl2-library', '[{"id":"library"}]'); seed();
  const library = createLibraryJournal({ storage: localStorage, idb });
  const scratch = createScratchJournal({ storage: localStorage, idb });
  await library.restore(); await library.flush(); await scratch.restore(); await scratch.flush();
  const rows = idb.rows();
  expect(rows.get(LIBRARY_JOURNAL_RECORD).entries).not.toHaveProperty(SCRATCH_KEY);
  expect(rows.get(SCRATCH_JOURNAL_RECORD).entries).not.toHaveProperty('pl2-library');
  localStorage.setItem('pl2-library', '[{"id":"newer-library"}]');
  localStorage.removeItem(SCRATCH_KEY); localStorage.removeItem('pl2-scratch-journal-revision');
  await scratch.restore();
  expect(localStorage.getItem('pl2-library')).toBe('[{"id":"newer-library"}]');
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY)).pads[0].content).toBe('Previously committed note');
});

it('an aborted Scratch write leaves the last strict snapshot intact for restart', async () => {
  seed(); const first = await boot(); const before = mirror();
  idb.state.failCommits = true;
  const failed = persistScratchState(edit('Unacknowledged draft'));
  await expect(failed.durable).rejects.toThrow('Synthetic commit failure');
  expect(getScratchDurability().status).toBe('error');
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY)).pads[0].content).toBe('Unacknowledged draft');
  first.stop(); replaceMirror(before); idb.state.failCommits = false;
  await boot();
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY)).pads[0].content).toBe('Previously committed note');
});

it.each(['workspace', 'side panel'])('%s shows Saving until strict completion, then visible failure and a successful retry', async surface => {
  seed(); await boot();
  render(surface === 'workspace' ? <ScratchWorkspace m={{}} /> : <ScratchSidePanel m={{}} />);
  const editor = screen.getByRole('textbox', { name: surface === 'workspace' ? 'Scratchpad' : 'Scratch note text' });
  const status = () => screen.getByTestId(surface === 'workspace' ? 'scratch-save-status' : 'scratch-side-save-status');
  idb.state.holdCommits = true;
  fireEvent.change(editor, { target: { value: 'Retry this durable draft' } });
  await waitFor(() => expect(status()).toHaveTextContent('Saving'), { timeout: 1500 });
  expect(status()).not.toHaveTextContent(/^Saved$/);
  expect(status()).toHaveAttribute('data-save-state', 'saving');
  expect(idb.rows().get(SCRATCH_JOURNAL_RECORD).entries[SCRATCH_KEY]).not.toContain('Retry this durable draft');
  idb.state.failCommits = true; idb.state.holdCommits = false;
  await act(async () => { idb.transactions.forEach(tx => tx.release?.()); });
  await waitFor(() => expect(status()).toHaveTextContent('Save failed'));
  expect(status()).toHaveAttribute('data-save-state', 'error');
  expect(editor).toHaveValue('Retry this durable draft');
  idb.state.failCommits = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving', exact: true }));
  await waitFor(() => expect(status()).toHaveTextContent('Saved'));
  expect(status()).toHaveAttribute('data-save-state', 'saved');
  expect(idb.rows().get(SCRATCH_JOURNAL_RECORD).entries[SCRATCH_KEY]).toContain('Retry this durable draft');
});

it('keeps legacy bytes until the replacement migration has a strict commit', async () => {
  localStorage.setItem('pl2-pad', 'Legacy note bytes');
  const started = await boot(); idb.state.holdCommits = true;
  const migrated = migrateScratchStorage();
  expect(migrated.payload.pads[0].content).toBe('Legacy note bytes');
  expect(localStorage.getItem('pl2-pad')).toBe('Legacy note bytes');
  await Promise.resolve(); await Promise.resolve();
  idb.state.holdCommits = false;
  idb.transactions.forEach(tx => tx.release?.());
  await started.journal.flush();
  await waitFor(() => expect(localStorage.getItem('pl2-pad')).toBeNull());
  expect(idb.rows().get(SCRATCH_JOURNAL_RECORD).entries[SCRATCH_KEY]).toContain('Legacy note bytes');
});

it('preserves legacy notes through an aborted migration and restart before retry', async () => {
  localStorage.setItem('pl2-pad', 'Legacy recovery bytes');
  const first = await boot(); const before = mirror(); idb.state.failCommits = true;
  migrateScratchStorage();
  await expect(first.journal.flush()).rejects.toThrow('Synthetic commit failure');
  expect(localStorage.getItem('pl2-pad')).toBe('Legacy recovery bytes');
  first.stop(); replaceMirror(before); idb.state.failCommits = false;
  const restarted = await boot();
  expect(localStorage.getItem('pl2-pad')).toBe('Legacy recovery bytes');
  expect(migrateScratchStorage().payload.pads[0].content).toBe('Legacy recovery bytes');
  await restarted.journal.flush();
  expect(JSON.parse(idb.rows().get(SCRATCH_JOURNAL_RECORD).entries[SCRATCH_KEY]).pads[0].content).toBe('Legacy recovery bytes');
});

it('recovers note metadata and deletion tombstones without resurrecting a deleted note', async () => {
  seed();
  const payload = JSON.parse(localStorage.getItem(SCRATCH_KEY));
  payload.pads.push({ ...payload.pads[0], id: 'deleted', name: 'Remove this note' });
  localStorage.setItem(SCRATCH_KEY, JSON.stringify(payload));
  const first = await boot(); const before = mirror();
  const next = { ...payload, pads: [{ ...payload.pads[0], name: 'Renamed', color: 'violet', pinned: true, tags: ['retained'] }] };
  const saved = persistScratchState(next, { removedIds: ['deleted'], preferLocalIds: ['default'] });
  await saved.durable;
  first.stop(); replaceMirror(before); await boot();
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY))).toEqual(saved.state);
  expect(saved.state.pads.map(pad => pad.id)).toEqual(['default']);
  expect(saved.state.tombstones.deleted).toBeGreaterThan(0);
});

it.each(['workspace', 'side panel'])('%s keeps newer typing dirty when an older strict commit completes', async surface => {
  seed(); await boot();
  render(surface === 'workspace' ? <ScratchWorkspace m={{}} /> : <ScratchSidePanel m={{}} />);
  const editor = screen.getByRole('textbox', { name: surface === 'workspace' ? 'Scratchpad' : 'Scratch note text' });
  const status = () => screen.getByTestId(surface === 'workspace' ? 'scratch-save-status' : 'scratch-side-save-status');
  idb.state.holdCommits = true;
  fireEvent.change(editor, { target: { value: 'First pending edit' } });
  await waitFor(() => expect(status()).toHaveTextContent('Saving'), { timeout: 1500 });
  fireEvent.change(editor, { target: { value: 'Newer unsaved edit' } });
  idb.state.holdCommits = false;
  await act(async () => { idb.transactions.forEach(tx => tx.release?.()); });
  expect(status()).toHaveTextContent('Unsaved changes');
  expect(editor).toHaveValue('Newer unsaved edit');
  await waitFor(() => expect(status()).toHaveTextContent('Saved'), { timeout: 1500 });
  expect(idb.rows().get(SCRATCH_JOURNAL_RECORD).entries[SCRATCH_KEY]).toContain('Newer unsaved edit');
});

it('does not overwrite notes after unavailable startup and can retry loading storage', async () => {
  seed(); const before = mirror(); idb.state.hangOpen = true;
  await boot({ timeoutMs: 10 });
  render(<ScratchWorkspace m={{}} />);
  const editor = screen.getByRole('textbox', { name: 'Scratchpad' });
  expect(editor).toHaveAttribute('readonly');
  expect(persistScratchState(edit('Must not overwrite')).ok).toBe(false);
  const after = mirror();
  delete after['pl2-diagnostics-v1'];
  expect(after).toEqual(before);
  expect(localStorage.getItem('pl2-diagnostics-v1')).toContain('storage_warning');
  idb.state.hangOpen = false;
  vi.stubGlobal('indexedDB', idb);
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading', exact: true }));
  await waitFor(() => expect(editor).not.toHaveAttribute('readonly'));
  expect(editor).toHaveValue('Previously committed note');
  vi.unstubAllGlobals();
});
