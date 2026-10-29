import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DRAFT_RECOVERY_STORAGE_KEY as key, useDraftRecoveryCapture } from '../hooks/useDraftRecoveryCapture.js';
import { libraryEditBuffers } from '../lib/libraryEditBuffers.js';
import { libraryWriteCoordinator, writeLibraryLocalItem, removeLibraryLocalItem } from '../lib/libraryWriteCoordinator.js';
import { registerSessionRecoveryCapture } from '../lib/draftRecoveryCapture.js';

let unregister;
beforeEach(() => { unregister = registerSessionRecoveryCapture(libraryEditBuffers); });
afterEach(() => { cleanup(); unregister(); vi.restoreAllMocks(); sessionStorage.clear(); });
const memory = rows => rows.find(row => row.id.startsWith('draft-recovery:')).value;
const stored = rows => rows.find(row => row.id === 'draft-recovery-store').value.entries[key];

it('retains raw malformed session recovery and the independent live buffer without reading other keys', () => {
  const raw = '{"editor":{"raw":"partial previous draft"},';
  sessionStorage.setItem(key, raw);
  sessionStorage.setItem('unrelated-auth-fixture', 'must not be read');
  const read = vi.spyOn(Storage.prototype, 'getItem');
  const live = { editor: { raw: 'Newer unsaved recovery' }, future: { bytes: ['unknown', null] } };
  const tab = renderHook(() => useDraftRecoveryCapture(live));
  const snapshot = libraryEditBuffers.read();
  expect(memory(snapshot)).toEqual(live);
  expect(stored(snapshot)).toBe(raw);
  expect(read.mock.calls).toEqual([[key]]);
  tab.unmount();
  expect(libraryEditBuffers.read()).toHaveLength(1);
  unregister();
  expect(libraryEditBuffers.read()).toEqual([]);
});

it('captures absence explicitly and rejects inaccessible session storage', () => {
  renderHook(() => useDraftRecoveryCapture(null));
  expect(stored(libraryEditBuffers.read())).toBeNull();
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
  expect(() => libraryEditBuffers.read()).toThrow('Denied');
  spy.mockRestore();
  expect(stored(libraryEditBuffers.read())).toBeNull();
});

it('detects external raw changes, current memory edits, and unmounts during capture', () => {
  sessionStorage.setItem(key, '{"editor":{"raw":"before"}}');
  const tab = renderHook(({ value }) => useDraftRecoveryCapture(value), { initialProps: { value: null } });
  const before = libraryEditBuffers.read();
  sessionStorage.setItem(key, '{"editor":{"raw":"after"}}');
  expect(() => libraryEditBuffers.assertUnchanged(before)).toThrow('editor changed');
  const rawChanged = libraryEditBuffers.read();
  tab.rerender({ value: { editor: { raw: 'memory only' } } });
  expect(() => libraryEditBuffers.assertUnchanged(rawChanged)).toThrow('editor changed');
  const liveChanged = libraryEditBuffers.read();
  tab.unmount();
  expect(() => libraryEditBuffers.assertUnchanged(liveChanged)).toThrow('editor changed');
});

it.each(['write', 'dismiss'])('rejects recovery %s during the barrier and retains saved bytes', async action => {
  const original = '{"editor":{"raw":"retained"}}';
  sessionStorage.setItem(key, original);
  renderHook(() => useDraftRecoveryCapture(JSON.parse(original)));
  await expect(libraryWriteCoordinator.withPausedWrites(() => {
    const snapshot = libraryEditBuffers.read();
    expect(() => action === 'write' ? writeLibraryLocalItem(sessionStorage, key, '{}')
      : removeLibraryLocalItem(sessionStorage, key)).toThrow('paused');
    libraryEditBuffers.assertUnchanged(snapshot);
  })).rejects.toMatchObject({ code: 'LIBRARY_CAPTURE_CHANGED' });
  expect(sessionStorage.getItem(key)).toBe(original);
  writeLibraryLocalItem(sessionStorage, key, '{}');
  expect(sessionStorage.getItem(key)).toBe('{}');
});
