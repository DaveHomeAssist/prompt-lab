import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { storageKeys } from '../lib/storage.js';
import { LIBRARY_CLEAR_PREFIX, LIBRARY_DELETED_PREFIX, markLibraryCleared, readLibraryDeletionState } from '../lib/libraryDeletion.js';

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
