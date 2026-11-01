import { useEffect, useState } from 'react';
import { safeArtwork } from './libraryPresentation.js';

export const RECENT_ARTWORK_KEY = 'pl2-recent-artwork';
export const RECENT_ARTWORK_EVENT = 'pl-recent-artwork';
export const MAX_RECENT_ARTWORK = 12;
export const MAX_RECENT_ARTWORK_BYTES = 256 * 1024;
const byteSize = value => new TextEncoder().encode(JSON.stringify(value)).length;
const identity = artwork => artwork.image || artwork.emoji || artwork.icon;

export function normalizeRecentArtwork(value) {
  const result = [];
  const distinct = new Map();
  if (!Array.isArray(value)) return result;
  for (const item of value.slice(0, 100)) {
    const artwork = safeArtwork(item);
    const key = identity(artwork);
    if (!key) continue;
    const existing = distinct.get(key);
    if (existing) {
      if (item.pinned === true) existing.pinned = true;
    } else distinct.set(key, { ...artwork, ...(item.pinned === true ? { pinned: true } : {}) });
  }
  const choices = [...distinct.values()];
  for (const artwork of [...choices.filter(item => item.pinned), ...choices.filter(item => !item.pinned)]) {
    if (byteSize([...result, artwork]) > MAX_RECENT_ARTWORK_BYTES) continue;
    result.push(artwork);
    if (result.length === MAX_RECENT_ARTWORK) break;
  }
  return result;
}

export function readRecentArtwork() {
  try {
    const raw = localStorage.getItem(RECENT_ARTWORK_KEY);
    if (!raw || new TextEncoder().encode(raw).length > MAX_RECENT_ARTWORK_BYTES) return [];
    return normalizeRecentArtwork(JSON.parse(raw));
  } catch { return []; }
}
function writeHistory(artwork) {
  try {
    localStorage.setItem(RECENT_ARTWORK_KEY, JSON.stringify(normalizeRecentArtwork(artwork)));
    window.dispatchEvent(new CustomEvent(RECENT_ARTWORK_EVENT));
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: 'Recently used artwork could not be updated. Your saved artwork is unchanged.' };
  }
}
export function rememberArtwork(value) {
  const artwork = safeArtwork(value);
  if (!identity(artwork)) return { ok: true, error: '' };
  const history = readRecentArtwork();
  const pinned = history.find(item => identity(item) === identity(artwork))?.pinned;
  const next = normalizeRecentArtwork([{ ...artwork, ...(pinned ? { pinned: true } : {}) }, ...history]);
  if (!next.some(item => identity(item) === identity(artwork))) {
    return { ok: false, error: 'The artwork was saved, but Recently used is full of pinned choices. Unpin or remove a choice to remember another.' };
  }
  return writeHistory(next);
}
export function setRecentArtworkPinned(value, pinned) {
  const key = identity(safeArtwork(value));
  const next = readRecentArtwork().map(item => identity(item) === key ? { ...item, pinned: pinned === true } : item);
  const normalized = normalizeRecentArtwork(next);
  if (next.some(item => item.pinned && !normalized.some(choice => identity(choice) === identity(item)))) {
    return { ok: false, error: 'There is not enough space to pin this artwork. Remove a choice and try again.' };
  }
  return writeHistory(normalized);
}
export function removeRecentArtwork(value) {
  const key = identity(safeArtwork(value));
  return writeHistory(readRecentArtwork().filter(item => identity(item) !== key));
}
export function useRecentArtwork() {
  const [entries, setEntries] = useState(readRecentArtwork);
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = event => {
      if (event.type === 'storage' && event.key !== RECENT_ARTWORK_KEY && event.key !== null) return;
      setEntries(readRecentArtwork()); setError('');
    };
    window.addEventListener('storage', refresh);
    window.addEventListener(RECENT_ARTWORK_EVENT, refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener(RECENT_ARTWORK_EVENT, refresh); };
  }, []);
  const act = result => { setError(result.error); return result.ok; };
  const clear = () => act(writeHistory(readRecentArtwork().filter(item => item.pinned)));
  const togglePin = value => act(setRecentArtworkPinned(value, !value.pinned));
  const remove = value => act(removeRecentArtwork(value));
  return { entries, clear, togglePin, remove, error };
}
