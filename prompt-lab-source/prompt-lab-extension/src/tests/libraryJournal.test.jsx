import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { saveJson, storageKeys } from '../lib/storage.js';
import { LIBRARY_DELETED_PREFIX, markLibraryDeleted } from '../lib/libraryDeletion.js';
import {
  LIBRARY_JOURNAL_DB, LIBRARY_JOURNAL_RECORD, LIBRARY_JOURNAL_REVISION_KEY, LIBRARY_JOURNAL_STORE,
  applyLibraryJournalRecord, createLibraryJournal, libraryJournalSupported, planLibraryJournalBoot, startLibraryJournal,
} from '../lib/libraryJournal.js';

vi.mock('../lib/legacyLibraryMigration.js', async (importOriginal) => ({
  ...await importOriginal(), shouldAttemptLegacyWebMigration: () => false,
}));

// Minimal IndexedDB: staged puts reach the database only when a transaction
// completes, so a failed commit leaves the previous journal in place.
function createFakeIndexedDb() {
  const databases = new Map();
  const transactions = [];
  const state = { failCommits: false, holdCommits: false, hangOpen: false };
  const later = (callback) => Promise.resolve().then(callback);
  const request = () => ({ result: undefined, error: null });

  function transaction(data, storeName, mode, options = {}) {
    const table = data.stores.get(storeName);
    const staged = [];
    const tx = { mode, options, error: null };
    let finished = false;
    let outstanding = 0;
    const settle = () => later(() => {
      if (outstanding || finished) return;
      if (mode === 'readwrite' && state.holdCommits) { tx.release = settle; return; }
      finished = true;
      if (state.failCommits) {
        tx.error = new Error('Synthetic commit failure');
        tx.onabort?.();
        return;
      }
      for (const [key, value] of staged) table.rows.set(key, structuredClone(value));
      tx.oncomplete?.();
    });
    tx.objectStore = () => ({
      get(key) {
        const req = request();
        outstanding += 1;
        later(() => {
          req.result = structuredClone(table.rows.get(key));
          outstanding -= 1;
          req.onsuccess?.();
          settle();
        });
        return req;
      },
      put(value) { staged.push([value[table.keyPath], value]); },
    });
    transactions.push(tx);
    settle();
    return tx;
  }

  function open(name, version) {
    const req = request();
    if (state.hangOpen) return req;
    later(() => {
      let data = databases.get(name);
      const upgrade = !data || data.version < version;
      if (!data) databases.set(name, data = { version, stores: new Map() });
      req.result = {
        objectStoreNames: { contains: (store) => data.stores.has(store) },
        createObjectStore: (store, { keyPath }) => data.stores.set(store, { keyPath, rows: new Map() }),
        transaction: (store, mode, options) => transaction(data, store, mode, options),
      };
      if (upgrade) {
        data.version = version;
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    });
    return req;
  }

  return { open, transactions, state, rows: () => databases.get(LIBRARY_JOURNAL_DB)?.stores.get(LIBRARY_JOURNAL_STORE)?.rows };
}

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
    ['same revision, localStorage kept later writes', local(4, { a: '2' }), { revision: 4, entries: { a: '1' } }, 'journal'],
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
    const edit = { ...saveArgs, editingId: first.id, enhanced: 'Durable edited body' };
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
