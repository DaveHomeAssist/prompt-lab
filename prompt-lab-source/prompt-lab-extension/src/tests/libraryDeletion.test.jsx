import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applyLibraryJournalRecord, readLibraryState } from '../lib/libraryJournal.js';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { onLocalWrite, storageKeys } from '../lib/storage.js';
import { LIBRARY_CLEAR_PREFIX, LIBRARY_DELETED_PREFIX, LIBRARY_DELETED_BATCH_PREFIX, filterDeletedLibraryRecords, markLibraryDeleted, markLibraryCleared, readLibraryDeletionState } from '../lib/libraryDeletion.js';

vi.mock('../lib/legacyLibraryMigration.js', async (importOriginal) => ({
  ...await importOriginal(), shouldAttemptLegacyWebMigration: () => false,
}));

const entry = (id, extra = {}) => ({ id, title: id, original: 'Private prompt body', enhanced: 'Private prompt body', ...extra });
const event = (key, newValue = null) => window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
const flush = () => act(() => vi.advanceTimersByTime(150));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(storageKeys.library, '[]');
  vi.useFakeTimers();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('suppresses permanent deletion across stale tabs, delayed writes, replayed events and reload', () => {
  const original = entry('deleted', { deletedAt: new Date().toISOString(), tombstoneVersion: 1 });
  localStorage.setItem(storageKeys.trash, JSON.stringify([original]));
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const second = renderHook(() => usePromptLibrary(vi.fn()));
  act(() => expect(first.result.current.permanentlyDelete('deleted')).toBe(true));
  flush(); // Second tab still has a pending stale snapshot.
  expect(JSON.parse(localStorage.getItem(storageKeys.trash))).toEqual([]);
  act(() => {
    localStorage.setItem(storageKeys.trash, JSON.stringify([original]));
    event(storageKeys.trash, '[]'); // Ignore event payload; use current metadata.
    event(`${LIBRARY_DELETED_PREFIX}deleted`);
    event(storageKeys.trash, JSON.stringify([original]));
  });
  expect(first.result.current.trash).toEqual([]);
  expect(second.result.current.trash).toEqual([]);
  flush();
  const reloaded = renderHook(() => usePromptLibrary(vi.fn()));
  expect(reloaded.result.current.trash).toEqual([]);
  const markers = Object.keys(localStorage).filter((key) => key.startsWith(LIBRARY_DELETED_PREFIX));
  expect(markers).toEqual([`${LIBRARY_DELETED_PREFIX}deleted`]);
  expect(localStorage.getItem(markers[0])).toBe('1');
});

it('clear generations reject stale unknown records while allowing an intentional new save', () => {
  localStorage.setItem(storageKeys.library, JSON.stringify([entry('old')]));
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const second = renderHook(() => usePromptLibrary(vi.fn()));
  act(() => expect(first.result.current.clearLibrary()).toBe(true));
  flush();
  expect(JSON.parse(localStorage.getItem(storageKeys.library))).toEqual([]);
  act(() => {
    localStorage.setItem(storageKeys.library, JSON.stringify([entry('old'), entry('never-seen')]));
    event(storageKeys.library);
  });
  expect(second.result.current.library).toEqual([]);
  act(() => second.result.current.setLibrary([entry('new')]));
  flush();
  expect(JSON.parse(localStorage.getItem(storageKeys.library)).map((row) => row.id)).toEqual(['new']);
  const reloaded = renderHook(() => usePromptLibrary(vi.fn()));
  expect(reloaded.result.current.library.map((row) => row.id)).toEqual(['new']);
  expect(readLibraryDeletionState().generation).not.toBe('0');
});

it('retains nonconflicting edits and does not repeat deletion on duplicate events', () => {
  localStorage.setItem(storageKeys.library, JSON.stringify([entry('left')]));
  const tab = renderHook(() => usePromptLibrary(vi.fn()));
  act(() => {
    localStorage.setItem(storageKeys.library, JSON.stringify([entry('right')]));
    event(storageKeys.library);
    event(storageKeys.library);
  });
  expect(tab.result.current.library.map((row) => row.id).sort()).toEqual(['left', 'right']);
});

it('reports rejected deletion metadata and preserves the recoverable entry', () => {
  localStorage.setItem(storageKeys.trash, JSON.stringify([entry('kept', { deletedAt: new Date().toISOString() })]));
  const notify = vi.fn();
  const tab = renderHook(() => usePromptLibrary(notify));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  act(() => expect(tab.result.current.permanentlyDelete('kept')).toBe(false));
  expect(tab.result.current.trash).toHaveLength(1);
  expect(notify).toHaveBeenCalledWith('Permanent deletion failed. The prompt remains recoverable.');
  act(() => expect(tab.result.current.clearLibrary()).toBe(false));
});

it('orders clear generations monotonically without relying on wall-clock time', () => {
  const first = markLibraryCleared();
  vi.setSystemTime(new Date('2000-01-01'));
  const second = markLibraryCleared();
  expect(second > first).toBe(true);
  expect(readLibraryDeletionState().generation).toBe(second);
  expect(Object.keys(localStorage).filter((key) => key.startsWith(LIBRARY_CLEAR_PREFIX))).toHaveLength(2);
});

it('permanently deletes several Recently Deleted prompts behind one counted confirmation', () => {
  const now = new Date().toISOString();
  localStorage.setItem(storageKeys.trash, JSON.stringify([
    entry('gone-1', { deletedAt: now, tombstoneVersion: 1 }),
    entry('gone-2', { deletedAt: now, tombstoneVersion: 1 }),
    entry('kept', { deletedAt: now, tombstoneVersion: 1 }),
  ]));
  const notify = vi.fn();
  const hook = renderHook(() => usePromptLibrary(notify));
  act(() => expect(hook.result.current.permanentlyDeleteEntries(['gone-1', 'gone-2', 'missing'])).toBe(2));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(window.confirm).toHaveBeenCalledWith('Permanently delete 2 prompts? This cannot be undone.');
  expect(hook.result.current.trash.map((item) => item.id)).toEqual(['kept']);
  expect(notify).toHaveBeenLastCalledWith('2 prompts permanently deleted.');
});

it('keeps every selected prompt recoverable when bulk permanent deletion is cancelled', () => {
  const now = new Date().toISOString();
  localStorage.setItem(storageKeys.trash, JSON.stringify([
    entry('a', { deletedAt: now }), entry('b', { deletedAt: now }),
  ]));
  window.confirm.mockReturnValue(false);
  const hook = renderHook(() => usePromptLibrary(vi.fn()));
  act(() => expect(hook.result.current.permanentlyDeleteEntries(['a', 'b'])).toBe(0));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(hook.result.current.trash.map((item) => item.id)).toEqual(['a', 'b']);
});

it('opening a prompt records the access without changing updatedAt', () => {
  localStorage.setItem(storageKeys.library, JSON.stringify([entry('opened', { updatedAt: '2025-12-02T12:00:00.000Z' })]));
  const { result } = renderHook(() => usePromptLibrary(vi.fn()));
  act(() => result.current.trackRecentAccess('opened'));
  const opened = result.current.library.find(item => item.id === 'opened');
  expect(opened.updatedAt).toBe('2025-12-02T12:00:00.000Z');
  expect(opened.lastAccessedAt).toBeTruthy();
});

// Allow enough additional storage for one legacy tombstone, but not a second.
// This models a full origin without making unrelated setup writes fail.
it.each([0, 1, 2])('keeps the entire batch recoverable with capacity for %i individual tombstones', (capacity) => {
  const originals = ['quota-a', 'quota-b', 'quota-c'].map((id) => entry(id, { deletedAt: new Date().toISOString() }));
  localStorage.setItem(storageKeys.trash, JSON.stringify(originals));
  localStorage.setItem(`${LIBRARY_DELETED_PREFIX}previous`, '1');
  const notify = vi.fn();
  const tab = renderHook(() => usePromptLibrary(notify));
  flush();
  const before = { ...localStorage };
  const size = () => Object.entries(localStorage).reduce((total, [key, value]) => total + key.length + value.length, 0);
  const limit = size() + capacity * (`${LIBRARY_DELETED_PREFIX}quota-a`.length + 1);
  const setItem = Storage.prototype.setItem;
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    const old = this.getItem(key);
    const delta = String(value).length - (old?.length || 0) + (old === null ? key.length : 0);
    if (size() + delta > limit) throw new DOMException('Controlled storage exhaustion', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
  act(() => expect(tab.result.current.permanentlyDeleteEntries(originals.map(({ id }) => id))).toBe(0));
  expect(notify).toHaveBeenLastCalledWith('Permanent deletion failed. The prompts remain recoverable.');
  expect({ ...localStorage }).toEqual(before);
  expect([...readLibraryDeletionState().deletedIds]).toEqual(['previous']);
  act(() => event(storageKeys.trash));
  expect(tab.result.current.trash.map(({ id }) => id)).toEqual(originals.map(({ id }) => id));
  write.mockRestore();
  tab.unmount();
  const reloaded = renderHook(() => usePromptLibrary(vi.fn()));
  expect(reloaded.result.current.trash.map(({ id }) => id)).toEqual(originals.map(({ id }) => id));
  act(() => expect(reloaded.result.current.restoreDeleted('quota-a')).toMatchObject({ id: 'quota-a' }));
});

it('publishes complete batches, preserves legacy markers, and restores them from the desktop journal', () => {
  const snapshots = [];
  const stop = onLocalWrite(() => snapshots.push([...readLibraryDeletionState().deletedIds].sort()));
  try {
    markLibraryDeleted(['legacy']);
    markLibraryDeleted(['a', 'b', 'a']);
    markLibraryDeleted(['b', 'c']);
    markLibraryDeleted([]);
  } finally { stop(); }
  expect(snapshots).toEqual([['legacy'], ['a', 'b', 'legacy'], ['a', 'b', 'c', 'legacy']]);
  const batches = Object.keys(localStorage).filter((key) => key.startsWith(LIBRARY_DELETED_BATCH_PREFIX));
  expect(batches).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem(batches[0]))).toEqual(['a', 'b']);
  const entries = readLibraryState(localStorage);
  expect(entries[batches[0]]).toBe(localStorage.getItem(batches[0]));
  localStorage.clear();
  applyLibraryJournalRecord(localStorage, { revision: 1, entries });
  expect(filterDeletedLibraryRecords(['legacy', 'a', 'b', 'c', 'kept'].map((id) => entry(id))).map(({ id }) => id)).toEqual(['kept']);
});

it('never notifies journal observers when the batch write is rejected', () => {
  const listener = vi.fn();
  const stop = onLocalWrite(listener);
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  try {
    expect(() => markLibraryDeleted(['a', 'b'])).toThrow('Full');
    expect(listener).not.toHaveBeenCalled();
    expect(readLibraryDeletionState().deletedIds.size).toBe(0);
  } finally { write.mockRestore(); stop(); }
});

it.each([false, true])('keeps successful batches deleted through stale reconciliation and reload (cleanup fails: %s)', (cleanupFails) => {
  const originals = ['a', 'b', 'kept'].map((id) => entry(id, { deletedAt: new Date().toISOString() }));
  localStorage.setItem(storageKeys.trash, JSON.stringify(originals));
  const notify = vi.fn();
  const first = renderHook(() => usePromptLibrary(notify));
  const second = renderHook(() => usePromptLibrary(vi.fn()));
  flush();
  const setItem = Storage.prototype.setItem;
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (cleanupFails && key === storageKeys.trash) throw new DOMException('Full', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
  act(() => expect(first.result.current.permanentlyDeleteEntries(['a', 'b', 'a', 'missing'])).toBe(2));
  expect(notify).toHaveBeenLastCalledWith(cleanupFails
    ? 'Deletion recorded, but stored content cleanup failed. Free browser storage and retry.'
    : '2 prompts permanently deleted.');
  write.mockRestore();
  const batchKey = Object.keys(localStorage).find((key) => key.startsWith(LIBRARY_DELETED_BATCH_PREFIX));
  act(() => {
    localStorage.setItem(storageKeys.trash, JSON.stringify(originals));
    event(batchKey);
    event(batchKey); // Duplicate events must be harmless.
    event(storageKeys.trash);
  });
  expect(second.result.current.trash.map(({ id }) => id)).toEqual(['kept']);
  flush();
  first.unmount();
  second.unmount();
  const reloaded = renderHook(() => usePromptLibrary(vi.fn()));
  expect(reloaded.result.current.trash.map(({ id }) => id)).toEqual(['kept']);
});

it('ignores malformed batch markers without treating the batch token as a prompt ID', () => {
  for (const [id, value] of Object.entries({ a: '{', b: '{}', c: '["kept", 1]' })) {
    localStorage.setItem(`${LIBRARY_DELETED_BATCH_PREFIX}${id}`, value);
  }
  expect(filterDeletedLibraryRecords(['a', 'b', 'c', 'kept'].map((id) => entry(id)))).toHaveLength(4);
});
