import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import usePromptLibrary from '../hooks/usePromptLibrary.js';
import { normalizeEntry } from '../lib/promptSchema.js';
import { storageKeys } from '../lib/storage.js';

vi.mock('../lib/legacyLibraryMigration.js', async () => ({
  ...await vi.importActual('../lib/legacyLibraryMigration.js'),
  shouldAttemptLegacyWebMigration: () => false,
}));

const entry = () => normalizeEntry({
  id: 'shared', title: 'Shared prompt', original: 'Old body', enhanced: 'Old body',
  currentVersionId: 'initial-version', metadata: { libraryGeneration: '0' },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});
const payload = (body, extra = {}) => ({
  editingId: 'shared', expectedVersionId: 'initial-version', title: 'Shared prompt', raw: body, enhanced: body, ...extra,
});
const stored = () => JSON.parse(localStorage.getItem(storageKeys.library));
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(150); });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem(storageKeys.library, JSON.stringify([entry()]));
});
afterEach(() => vi.useRealTimers());

it('rejects a stale Favorite write, adopts the newer body, and allows an explicit retry', async () => {
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const notify = vi.fn();
  const stale = renderHook(() => usePromptLibrary(notify));
  await flush();
  act(() => { expect(first.result.current.doSave(payload('New body'))).toBeTruthy(); });
  const saved = stored()[0];
  act(() => stale.result.current.setFavorite('shared'));
  await flush();
  expect(stored()[0]).toEqual(saved);
  expect(stale.result.current.library[0].enhanced).toBe('New body');
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('Library changed in another tab'));
  act(() => stale.result.current.setFavorite('shared'));
  await flush();
  expect(stored()[0]).toMatchObject({ enhanced: 'New body', favorite: true, currentVersionId: saved.currentVersionId });
});

it('rejects a stale whole-library save without dropping a prompt created by another tab', async () => {
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const stale = renderHook(() => usePromptLibrary(vi.fn()));
  await flush();
  act(() => first.result.current.doSave(payload('Independent prompt', { editingId: null })));
  const saved = stored();
  act(() => { expect(stale.result.current.doSave(payload('Stale editor body'))).toBeNull(); });
  await flush();
  expect(stored()).toEqual(saved);
});

it('keeps a stale editor blocked after storage events have adopted the newer Library version', async () => {
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const stale = renderHook(() => usePromptLibrary(vi.fn()));
  await flush();
  act(() => first.result.current.doSave(payload('New body')));
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: storageKeys.library, newValue: localStorage.getItem(storageKeys.library) })));
  const saved = stored()[0];
  act(() => { expect(stale.result.current.doSave(payload('Keep this draft'))).toBeNull(); });
  expect(stale.result.current.saveError).toContain('newer version');
  expect(stored()[0]).toEqual(saved);
  act(() => stale.result.current.doSave(payload('Keep this draft', { editingId: null, copyAsNew: true })));
  expect(stored()).toHaveLength(2);
  expect(stored().find(row => row.id === 'shared')).toEqual(saved);
});

it('cancels queued stale metadata when an external update arrives before its background write', async () => {
  const first = renderHook(() => usePromptLibrary(vi.fn()));
  const stale = renderHook(() => usePromptLibrary(vi.fn()));
  await flush();
  act(() => stale.result.current.setFavorite('shared'));
  act(() => first.result.current.doSave(payload('New body')));
  const saved = stored()[0];
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: storageKeys.library, newValue: localStorage.getItem(storageKeys.library) })));
  await flush();
  expect(stored()[0]).toEqual(saved);
});

it('does not overwrite unreadable external Library data with the stale in-memory copy', async () => {
  const stale = renderHook(() => usePromptLibrary(vi.fn()));
  await flush();
  localStorage.setItem(storageKeys.library, '{incomplete');
  act(() => stale.result.current.setFavorite('shared'));
  await flush();
  expect(localStorage.getItem(storageKeys.library)).toBe('{incomplete');
  act(() => { expect(stale.result.current.doSave(payload('Keep this draft'))).toBeNull(); });
  expect(localStorage.getItem(storageKeys.library)).toBe('{incomplete');
});
