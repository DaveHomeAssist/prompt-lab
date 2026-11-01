import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { saveJson, storageKeys } from '../lib/storage.js';
import { LIBRARY_DELETED_PREFIX, filterDeletedLibraryRecords, markLibraryCleared, markLibraryDeleted, readLibraryDeletionState } from '../lib/libraryDeletion.js';
import { createSyncEngine, queueKey, stateKey } from '../lib/sync/syncEngine.js';
import { notifyLocalWrite } from '../lib/storage.js';
import { startSettingsJournal } from '../lib/settingsJournal.js';
import {
  LIBRARY_JOURNAL_DB, LIBRARY_JOURNAL_RECORD, LIBRARY_JOURNAL_REVISION_KEY, LIBRARY_JOURNAL_STORE,
  applyLibraryJournalRecord, createLibraryJournal, libraryJournalSupported, mergeLibraryEntries, planLibraryJournalBoot, startLibraryJournal,
} from '../lib/libraryJournal.js';

vi.mock('../lib/legacyLibraryMigration.js', async (importOriginal) => ({
  ...await importOriginal(), shouldAttemptLegacyWebMigration: () => false,
}));

import { createFakeIndexedDb } from './helpers/fakeIndexedDb.js';

let idb;
const stops = [];
const boot = async (options = {}) => {
  const started = await startLibraryJournal({ storage: localStorage, idb, ...options });
  stops.push(started.stop);
  return started;
};
// A Library write queues its journal commit in a microtask; wait for it.
const settled = async (journal) => {
  await Promise.resolve();
  return journal.flush();
};
const journalRecord = () => idb.rows()?.get(LIBRARY_JOURNAL_RECORD);
const localEntries = () => Object.fromEntries(Array.from({ length: localStorage.length }, (_, index) => {
  const key = localStorage.key(index);
  return [key, localStorage.getItem(key)];
}));
const replaceLocal = (entries) => {
  localStorage.clear();
  for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
};
const ids = (key) => JSON.parse(localStorage.getItem(key)).map((row) => row.id);

beforeEach(() => {
  localStorage.clear();
  idb = createFakeIndexedDb();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.__TAURI_INTERNALS__;
});

describe('library journal boot decision', () => {
  const local = (revision, entries = { a: '1' }) => ({ revision, entries });
  it.each([
    ['no journal yet', local(0), null, 'journal'],
    ['journal ahead of localStorage', local(3), { revision: 4, entries: { a: '1' } }, 'restore'],
    ['localStorage ahead of journal', local(5), { revision: 4, entries: { a: '1' } }, 'journal'],
    ['same revision, mirror differs from committed journal', local(4, { a: '2' }), { revision: 4, entries: { a: '1' } }, 'restore'],
    ['same revision and contents', local(4), { revision: 4, entries: { a: '1' } }, 'current'],
  ])('%s', (_, localState, record, action) => {
    expect(planLibraryJournalBoot(localState, record)).toBe(action);
  });
});

describe('desktop library journal', () => {
  const saveArgs = { title: 'Durable fixture', raw: 'Keep this draft', enhanced: 'Keep this draft', tags: [] };
  const desktopLibrary = async () => {
    window.__TAURI_INTERNALS__ = {};
    vi.stubGlobal('indexedDB', idb);
    localStorage.setItem(storageKeys.library, '[]');
    const started = await boot();
    await settled(started.journal);
    const notify = vi.fn();
    const hook = renderHook(() => usePromptLibrary(notify));
    return { ...started, hook, notify };
  };

  it('restores acknowledged rows when the mirror loses data but keeps the committed revision', async () => {
    localStorage.setItem(storageKeys.library, '[]');
    const first = await boot(); await settled(first.journal);
    saveJson(storageKeys.library, [{ id: 'acknowledged-import', title: 'Retain imported identity' }]);
    await settled(first.journal);
    const revision = localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY);
    const record = journalRecord();
    first.stop();
    localStorage.setItem(storageKeys.library, '[]');
    expect(localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY)).toBe(revision);
    const restarted = await boot(); await settled(restarted.journal);
    expect(ids(storageKeys.library)).toEqual(['acknowledged-import']);
    expect(restarted.outcome.action).toBe('restore');
    expect(journalRecord()).toEqual(record);
  });

  it('withholds success until strict commit and coalesces duplicate clicks', async () => {
    const { hook, notify } = await desktopLibrary();
    idb.state.holdCommits = true;
    let pending;
    await act(async () => {
      pending = hook.result.current.doSave(saveArgs);
      expect(hook.result.current.doSave(saveArgs)).toBe(pending);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(hook.result.current.saving).toBe(true);
    expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved/));
    expect(JSON.parse(journalRecord().entries[storageKeys.library])).toEqual([]);
    idb.state.holdCommits = false;
    await act(async () => {
      for (const tx of idb.transactions) tx.release?.();
      expect((await pending).id).toBeTruthy();
    });
    expect(hook.result.current.saving).toBe(false);
    expect(notify).toHaveBeenCalledWith('Saved Durable fixture as version 1.');
    expect(JSON.parse(journalRecord().entries[storageKeys.library])).toHaveLength(1);
  });

  it('keeps failed saves recoverable and retries without duplicate identity or version', async () => {
    const { hook, notify } = await desktopLibrary();
    idb.state.failCommits = true;
    await act(async () => { expect(await hook.result.current.doSave(saveArgs)).toBeNull(); });
    const staged = hook.result.current.library[0];
    expect(staged.original).toBe(saveArgs.raw);
    expect(hook.result.current.saveError).toMatch(/Save failed.*Keep this window open/);
    expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved/));
    expect(JSON.parse(journalRecord().entries[storageKeys.library])).toEqual([]);
    idb.state.failCommits = false;
    await act(async () => { expect((await hook.result.current.doSave(saveArgs)).id).toBe(staged.id); });
    expect(hook.result.current.library).toHaveLength(1);
    expect(hook.result.current.library[0].currentVersionId).toBe(staged.currentVersionId);
    expect(hook.result.current.saveError).toBe('');
  });

  it('preserves the last committed state when a pending write is interrupted before acknowledgement', async () => {
    const { hook, notify, stop } = await desktopLibrary();
    const baseline = localEntries();
    idb.state.holdCommits = true;
    let pending;
    await act(async () => {
      pending = hook.result.current.doSave(saveArgs);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    idb.state.holdCommits = false;
    idb.state.failCommits = true;
    await act(async () => {
      for (const tx of idb.transactions) tx.release?.();
      expect(await pending).toBeNull();
    });
    expect(notify).not.toHaveBeenCalledWith(expect.stringMatching(/^Saved/));
    hook.unmount();
    stop();
    replaceLocal(baseline);
    idb.state.failCommits = false;
    const restarted = await boot();
    await settled(restarted.journal);
    expect(ids(storageKeys.library)).toEqual([]);
    expect(JSON.parse(journalRecord().entries[storageKeys.library])).toEqual([]);
  });

  it('retries a failed edited version once and restores acknowledged data after lost local batching', async () => {
    const { hook, journal, stop } = await desktopLibrary();
    let first;
    await act(async () => { first = await hook.result.current.doSave(saveArgs); });
    await settled(journal);
    const beforeEdit = localEntries();
    const edit = { ...saveArgs, editingId: first.id, expectedVersionId: first.versionId, enhanced: 'Durable edited body' };
    idb.state.failCommits = true;
    await act(async () => { expect(await hook.result.current.doSave(edit)).toBeNull(); });
    const failedVersion = hook.result.current.library[0].currentVersionId;
    idb.state.failCommits = false;
    await act(async () => {
      const retried = await hook.result.current.doSave(edit);
      expect(retried.id).toBe(first.id);
      expect(retried.versionId).toBe(failedVersion);
      expect(retried.versionNumber).toBe(2);
    });
    hook.unmount();
    stop();
    replaceLocal(beforeEdit);
    const restarted = await boot();
    expect(restarted.outcome.action).toBe('restore');
    const restored = JSON.parse(localStorage.getItem(storageKeys.library));
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: first.id, currentVersionId: failedVersion, enhanced: edit.enhanced });
  });

  it('does not acknowledge a save when desktop journaling never started', async () => {
    window.__TAURI_INTERNALS__ = {};
    const hook = renderHook(() => usePromptLibrary(vi.fn()));
    await act(async () => { expect(await hook.result.current.doSave(saveArgs)).toBeNull(); });
    expect(hook.result.current.saveError).toMatch(/Save failed/);
    expect(hook.result.current.library[0].original).toBe(saveArgs.raw);
  });

  it('is enabled only inside the Tauri shell', () => {
    expect(libraryJournalSupported()).toBe(false);
    window.__TAURI_INTERNALS__ = {};
    vi.stubGlobal('indexedDB', idb);
    expect(libraryJournalSupported()).toBe(true);
  });

  it('journals every Library write in one strict commit per turn and ignores other keys', async () => {
    const { journal, outcome } = await boot();
    expect(outcome).toMatchObject({ action: 'journal', localRevision: 0, journalRevision: null });
    await settled(journal);
    const before = idb.transactions.filter((tx) => tx.mode === 'readwrite').length;

    saveJson(storageKeys.library, [{ id: 'saved' }]);
    saveJson(storageKeys.collections, ['Work']);
    markLibraryDeleted(['gone']);
    saveJson('pl2-provider-settings', { provider: 'ollama' });
    await settled(journal);

    const writes = idb.transactions.filter((tx) => tx.mode === 'readwrite');
    expect(writes).toHaveLength(before + 1);
    expect(writes.every((tx) => tx.options.durability === 'strict')).toBe(true);
    const record = journalRecord();
    expect(Object.keys(record.entries).sort()).toEqual([`${LIBRARY_DELETED_PREFIX}gone`, storageKeys.collections, storageKeys.library].sort());
    expect(localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY)).toBe(String(record.revision));
  });

  it('restores Library writes that localStorage dropped before the restart', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([{ id: 'kept' }]));
    const first = await boot();
    await settled(first.journal);
    const onDisk = localEntries();

    saveJson(storageKeys.library, [{ id: 'kept' }, { id: 'new' }]);
    saveJson(storageKeys.collections, ['Fresh']);
    await settled(first.journal);
    first.stop();
    // The WebView closed before its batched localStorage commit reached disk.
    replaceLocal(onDisk);

    const second = await boot();
    expect(second.outcome).toMatchObject({ action: 'restore', journalRevision: journalRecord().revision });
    expect(ids(storageKeys.library)).toEqual(['kept', 'new']);
    expect(JSON.parse(localStorage.getItem(storageKeys.collections))).toEqual(['Fresh']);
    expect(localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY)).toBe(String(journalRecord().revision));
  });

  it('keeps localStorage writes the journal failed to commit', async () => {
    const first = await boot();
    await settled(first.journal);
    idb.state.failCommits = true;
    saveJson(storageKeys.library, [{ id: 'local-only' }]);
    await expect(settled(first.journal)).rejects.toThrow('Synthetic commit failure');
    expect(journalRecord().entries[storageKeys.library]).toBeUndefined();
    first.stop();

    idb.state.failCommits = false;
    const second = await boot();
    expect(second.outcome.action).toBe('journal');
    await settled(second.journal);
    expect(ids(storageKeys.library)).toEqual(['local-only']);
    expect(JSON.parse(journalRecord().entries[storageKeys.library])).toEqual([{ id: 'local-only' }]);
  });

  it('never drops a deletion marker when restoring', () => {
    localStorage.setItem(`${LIBRARY_DELETED_PREFIX}removed`, '1');
    localStorage.setItem(storageKeys.trash, '[{"id":"stale"}]');
    applyLibraryJournalRecord(localStorage, { revision: 4, entries: { [storageKeys.library]: '[]' } });
    expect(localStorage.getItem(`${LIBRARY_DELETED_PREFIX}removed`)).toBe('1');
    expect(localStorage.getItem(storageKeys.trash)).toBeNull();
    expect(localStorage.getItem(storageKeys.library)).toBe('[]');
    expect(localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY)).toBe('4');
  });

  it('moves past a journal that is ahead of localStorage instead of skipping the write', async () => {
    const first = await boot();
    await settled(first.journal);
    first.stop();
    journalRecord().revision = 9;
    localStorage.setItem(storageKeys.library, '[{"id":"latest"}]');

    const journal = createLibraryJournal({ storage: localStorage, idb });
    await expect(journal.commit()).resolves.toBe(10);
    expect(journalRecord()).toMatchObject({ revision: 10, entries: { [storageKeys.library]: '[{"id":"latest"}]' } });
    expect(localStorage.getItem(LIBRARY_JOURNAL_REVISION_KEY)).toBe('10');
  });

  it('starts without the journal when it does not answer', async () => {
    idb.state.hangOpen = true;
    localStorage.setItem(storageKeys.library, '[{"id":"local"}]');
    const { outcome } = await boot({ timeoutMs: 20 });
    expect(outcome.action).toBe('unavailable');
    expect(ids(storageKeys.library)).toEqual(['local']);
  });

  it('retries a slow boot read before starting without the journal', async () => {
    localStorage.setItem(storageKeys.library, '[{"id":"local"}]');
    const first = await boot();
    await settled(first.journal);
    first.stop();
    idb.state.openDelayMs = 50;
    const { outcome } = await boot({ timeoutMs: 20 });
    expect(outcome.action).not.toBe('unavailable');
    expect(outcome.attempts).toBe(3);
    expect(ids(storageKeys.library)).toEqual(['local']);
  });

  it('gives up after the bounded boot retries when the journal never answers', async () => {
    idb.state.hangOpen = true;
    const started = Date.now();
    const { outcome } = await boot({ timeoutMs: 20 });
    expect(outcome).toMatchObject({ action: 'unavailable', attempts: 3, error: 'Library journal did not answer in time.' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('journals saves made through usePromptLibrary', async () => {
    localStorage.setItem(storageKeys.library, '[]');
    const { journal } = await boot();
    await settled(journal);
    vi.useFakeTimers();
    const hook = renderHook(() => usePromptLibrary(vi.fn()));
    act(() => hook.result.current.setLibrary([{ id: 'from-ui', title: 'From UI', original: 'Body', enhanced: 'Body' }]));
    act(() => vi.advanceTimersByTime(150));
    vi.useRealTimers();
    await settled(journal);
    expect(JSON.parse(journalRecord().entries[storageKeys.library]).map((row) => row.id)).toEqual(['from-ui']);
  });
});

// Like the settings journal's R-20 fix: a write made before this device has
// read the journal (failed boot read) must not replace the whole record.
describe('library journal writes after a failed boot read', () => {
  const row = (id, updatedAt = '2026-11-01T10:00:00.000Z', title = id) => ({ id, title, updatedAt });
  const STATE = 'pl2-sync-state:user_A';

  it('keeps the journal\'s rows, markers and order and restores them on the next boot', async () => {
    const first = await boot();
    localStorage.setItem(storageKeys.library, JSON.stringify([row('a'), row('b')]));
    localStorage.setItem(storageKeys.collections, JSON.stringify(['Work']));
    localStorage.setItem(`${LIBRARY_DELETED_PREFIX}gone`, '1');
    localStorage.setItem(STATE, '{"shadow":{"prompt:a":{},"prompt:b":{}}}');
    saveJson(storageKeys.library, JSON.parse(localStorage.getItem(storageKeys.library)));
    await settled(first.journal);
    first.stop();

    // Local Storage lost everything; the journal answers only after boot gave up.
    localStorage.clear();
    idb.state.openDelayMs = 80;
    const blind = await boot({ timeoutMs: 10 });
    expect(blind.outcome.action).toBe('unavailable');
    localStorage.setItem(STATE, '{"shadow":{}}');
    saveJson(storageKeys.library, [row('c')]);
    await new Promise(resolve => setTimeout(resolve, 150));
    await settled(blind.journal);

    const entries = journalRecord().entries;
    expect(JSON.parse(entries[storageKeys.library]).map(r => r.id)).toEqual(['c', 'a', 'b']);
    expect(entries[storageKeys.collections]).toBe('["Work"]');
    expect(entries[`${LIBRARY_DELETED_PREFIX}gone`]).toBe('1');
    // This device's sync state describes only [c]; it must not pair with the merge.
    expect(entries[STATE]).toBeUndefined();
    blind.stop();

    idb.state.openDelayMs = 0;
    const next = await boot();
    expect(next.outcome.action).toBe('restore');
    expect(ids(storageKeys.library)).toEqual(['c', 'a', 'b']);
    expect(localStorage.getItem(STATE)).toBeNull();
  });

  it('replaces the record as before once the boot read succeeded', async () => {
    localStorage.setItem(storageKeys.library, JSON.stringify([row('a'), row('b')]));
    const { journal } = await boot();
    await settled(journal);
    saveJson(storageKeys.library, [row('b')]);
    await settled(journal);
    expect(JSON.parse(journalRecord().entries[storageKeys.library]).map(r => r.id)).toEqual(['b']);
  });

  it('#293 Codex P1: prompts saved after the loss stay visible when an older Clear marker comes back', async () => {
    const first = await boot();
    saveJson(storageKeys.library, [row('old')]);
    const generation = markLibraryCleared(localStorage);
    saveJson(storageKeys.library, [{ ...row('kept'), metadata: { libraryGeneration: generation } }]);
    await settled(first.journal);
    first.stop();

    localStorage.clear();
    idb.state.openDelayMs = 80;
    const blind = await boot({ timeoutMs: 10 });
    expect(blind.outcome.action).toBe('unavailable');
    // No Clear marker locally, so the new prompt is saved under generation '0'.
    saveJson(storageKeys.library, [row('new')]);
    saveJson(storageKeys.trash, [row('binned')]);
    await new Promise(resolve => setTimeout(resolve, 150));
    await settled(blind.journal);
    blind.stop();

    idb.state.openDelayMs = 0;
    expect((await boot()).outcome.action).toBe('restore');
    const visible = (key) => filterDeletedLibraryRecords(JSON.parse(localStorage.getItem(key) || '[]'), readLibraryDeletionState(localStorage)).map(r => r.id);
    expect(visible(storageKeys.library)).toEqual(['new', 'kept']);
    expect(visible(storageKeys.trash)).toEqual(['binned']);
    expect(JSON.parse(localStorage.getItem(storageKeys.library)).some(r => r.id === 'old')).toBe(false);
  });

  describe('mergeLibraryEntries', () => {
    const lib = storageKeys.library;
    const trash = storageKeys.trash;
    it('keeps this device\'s copy unless the journal\'s is strictly newer', () => {
      const merged = mergeLibraryEntries(
        { [lib]: JSON.stringify([row('a', '2026-11-01T12:00:00.000Z', 'journal'), row('b', '2026-11-01T09:00:00.000Z', 'journal')]) },
        { [lib]: JSON.stringify([row('b', '2026-11-01T10:00:00.000Z', 'mine'), row('a', '2026-11-01T11:00:00.000Z', 'mine')]) },
      );
      expect(JSON.parse(merged[lib]).map(r => `${r.id}:${r.title}`)).toEqual(['b:mine', 'a:journal']);
    });
    it('leaves a prompt where this device moved it between Library and trash', () => {
      const merged = mergeLibraryEntries(
        { [lib]: JSON.stringify([row('a'), row('x')]), [trash]: JSON.stringify([row('b')]) },
        { [lib]: JSON.stringify([row('b')]), [trash]: JSON.stringify([row('a')]) },
      );
      expect(JSON.parse(merged[lib]).map(r => r.id)).toEqual(['b', 'x']);
      expect(JSON.parse(merged[trash]).map(r => r.id)).toEqual(['a']);
    });
    it('keeps the sync state when the journal adds nothing', () => {
      const fresh = { [lib]: JSON.stringify([row('a')]), 'pl2-sync-state:u': '{}', 'pl2-sync-queue:u': '[]' };
      expect(mergeLibraryEntries({ [lib]: JSON.stringify([row('a')]), 'pl2-sync-state:u': '{"old":1}' }, fresh)).toEqual(fresh);
    });
    it('never takes the journal\'s sync state', () => {
      const merged = mergeLibraryEntries({ 'pl2-sync-state:u': '{"old":1}', [lib]: '[]' }, { [lib]: '[]' });
      expect(merged).toEqual({ [lib]: '[]' });
    });
  });
});

// R-28 / R-29: the engine tells the Library journal about its state and
// outbox itself, once per sync.
describe('sync state reaches the Library journal from the engine', () => {
  const emptyServer = () => ({
    pull: async () => [], push: async (device, items) => items.map(item => ({ kind: item.kind, item_id: item.item_id, status: 'applied', version: 1 })),
    manifest: async () => [], fetchItems: async () => [],
  });
  const engine = (transport, now = () => Date.now()) => createSyncEngine({ storage: localStorage, transport, userId: 'u1', deviceId: 'd1', notifyWrite: notifyLocalWrite, now });

  it('R-29: with only the Library journal running, a sync commits its state and outbox', async () => {
    localStorage.setItem(storageKeys.library, '[]');
    const { journal } = await boot();
    await settled(journal);
    await engine(emptyServer()).syncOnce();
    await settled(journal);
    // A later sync that only changes the state (the manifest check is due).
    const firstState = localStorage.getItem(stateKey('u1'));
    await engine(emptyServer(), () => Date.now() + 7 * 24 * 3600 * 1000).syncOnce();
    await settled(journal);
    expect(localStorage.getItem(stateKey('u1'))).not.toBe(firstState);
    const entries = journalRecord().entries;
    expect(entries[stateKey('u1')]).toBe(localStorage.getItem(stateKey('u1')));
    expect(JSON.parse(entries[stateKey('u1')]).initialized).toBe(true);
    expect(Object.hasOwn(entries, queueKey('u1'))).toBe(localStorage.getItem(queueKey('u1')) !== null);
  });

  it('R-28: one Library commit per sync however often the state is saved', async () => {
    localStorage.setItem(storageKeys.library, '[]');
    const { journal } = await boot();
    // The desktop also runs the settings journal, which watches every Storage write.
    const settings = await startSettingsJournal({ storage: localStorage, idb });
    stops.push(settings.stop);
    await settled(journal);
    const clock = () => Date.now();
    await engine(emptyServer(), clock).syncOnce(); // first run
    await settled(journal);
    // A slow transport spreads the saves of one sync over several turns.
    const slow = { ...emptyServer(), pull: async () => { await new Promise(r => setTimeout(r, 5)); return []; } };
    let saves = 0;
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === stateKey('u1')) saves += 1; return realSet.call(this, key, value); };
    const before = journalRecord().revision;
    try {
      await engine(slow, clock).syncOnce();
      await settled(journal);
    } finally { Storage.prototype.setItem = realSet; }
    expect(saves).toBeGreaterThan(1);
    expect(journalRecord().revision - before).toBe(1);
  });
});
