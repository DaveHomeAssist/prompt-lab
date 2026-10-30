import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeRecentArtwork, readRecentArtwork, rememberArtwork, useRecentArtwork, RECENT_ARTWORK_KEY, MAX_RECENT_ARTWORK_BYTES, setRecentArtworkPinned, removeRecentArtwork } from '../lib/recentArtwork.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
it('keeps twelve valid distinct choices, newest first', () => {
  for (const icon of ['FileText','Folder','Code','Wand2','FlaskConical','BookmarkPlus','Star','Layers','Braces','Zap','Clock','GitBranch','Quote']) rememberArtwork({ icon });
  expect(readRecentArtwork()).toHaveLength(12);
  rememberArtwork({ icon: 'Clock' });
  expect(readRecentArtwork()[0].icon).toBe('Clock');
  expect(readRecentArtwork()).toHaveLength(12);
  expect(normalizeRecentArtwork([{}, { image: 'https://example.com/a.png' }, { emoji: 'not emoji' }])).toEqual([]);
});
it('bounds the serialized image cache and tolerates corrupt data', () => {
  const images = Array.from({ length: 12 }, (_, i) => ({ image: `data:image/png;base64,${String.fromCharCode(65+i).repeat(87000)}` }));
  const result = normalizeRecentArtwork(images);
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThan(12);
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(MAX_RECENT_ARTWORK_BYTES);
  localStorage.setItem(RECENT_ARTWORK_KEY, '{broken'); expect(readRecentArtwork()).toEqual([]);
  localStorage.setItem(RECENT_ARTWORK_KEY, 'x'.repeat(MAX_RECENT_ARTWORK_BYTES+1)); expect(readRecentArtwork()).toEqual([]);
});
it('refreshes mounted pickers, clears only history, and adopts another tab', () => {
  localStorage.setItem('pl2-library', 'preserved');
  const a = renderHook(useRecentArtwork); const b = renderHook(useRecentArtwork);
  act(() => rememberArtwork({ emoji: '🧪' }));
  expect(a.result.current.entries[0].emoji).toBe('🧪'); expect(b.result.current.entries).toEqual(a.result.current.entries);
  act(() => { localStorage.setItem(RECENT_ARTWORK_KEY, JSON.stringify([{ icon: 'Star' }])); window.dispatchEvent(new StorageEvent('storage', { key: RECENT_ARTWORK_KEY })); });
  expect(a.result.current.entries[0].icon).toBe('Star');
  act(() => a.result.current.clear()); expect(b.result.current.entries).toEqual([]);
  expect(localStorage.getItem('pl2-library')).toBe('preserved');
});
it('reports a rejected cache write without claiming it succeeded', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(rememberArtwork({ emoji: '🧪' })).toMatchObject({ ok: false });
  const hook = renderHook(useRecentArtwork); act(() => hook.result.current.clear());
  expect(hook.result.current.error).toContain('could not be updated');
});

it('preserves pins across reuse, eviction and clear, and removes only the chosen history item', () => {
  localStorage.setItem('pl2-library', 'assigned artwork remains');
  rememberArtwork({ emoji: '🧪' }); setRecentArtworkPinned({ emoji: '🧪' }, true);
  for (const icon of ['FileText','Folder','Code','Wand2','FlaskConical','BookmarkPlus','Star','Layers','Braces','Zap','Clock','GitBranch','Quote']) rememberArtwork({ icon });
  expect(readRecentArtwork()).toHaveLength(12);
  expect(readRecentArtwork()[0]).toMatchObject({ emoji: '🧪', pinned: true });
  rememberArtwork({ emoji: '🧪' }); expect(readRecentArtwork()[0].pinned).toBe(true);
  const hook = renderHook(useRecentArtwork);
  act(() => hook.result.current.clear()); expect(hook.result.current.entries).toHaveLength(1);
  act(() => setRecentArtworkPinned({ emoji: '🧪' }, false)); expect(readRecentArtwork()[0].pinned).toBeUndefined();
  act(() => removeRecentArtwork({ emoji: '🧪' })); expect(readRecentArtwork()).toEqual([]);
  expect(localStorage.getItem('pl2-library')).toBe('assigned artwork remains');
});
it('does not evict pins when full and reports how to make room', () => {
  const icons = ['FileText','Folder','Code','Wand2','FlaskConical','BookmarkPlus','Star','Layers','Braces','Zap','Clock','GitBranch'];
  for (const icon of icons) { rememberArtwork({ icon }); setRecentArtworkPinned({ icon }, true); }
  expect(rememberArtwork({ emoji: '🧪' })).toMatchObject({ ok: false });
  expect(readRecentArtwork()).toHaveLength(12); expect(readRecentArtwork().every(item => item.pinned)).toBe(true);
  setRecentArtworkPinned({ icon: 'FileText' }, false);
  expect(rememberArtwork({ emoji: '🧪' }).ok).toBe(true);
  expect(readRecentArtwork().find(item => item.emoji === '🧪')).toBeTruthy();
});
it('retains pin state on duplicate normalization and rejects pin/remove storage writes honestly', () => {
  expect(normalizeRecentArtwork([{ icon: 'Star' }, { icon: 'Star', pinned: true }])).toEqual([{ icon: 'Star', image: '', pinned: true }]);
  rememberArtwork({ icon: 'Star' });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  expect(setRecentArtworkPinned({ icon: 'Star' }, true).ok).toBe(false);
  expect(removeRecentArtwork({ icon: 'Star' }).ok).toBe(false);
  expect(readRecentArtwork()).toEqual([{ icon: 'Star', image: '' }]);
});
