import { writeLibraryLocalItem } from './libraryWriteCoordinator.js';
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
  const seen = new Set();
  if (!Array.isArray(value)) return result;
  for (const item of value.slice(0, 100)) {
    const artwork = safeArtwork(item);
    const key = identity(artwork);
    if (!key || seen.has(key)) continue;
    if (byteSize([...result, artwork]) > MAX_RECENT_ARTWORK_BYTES) continue;
    result.push(artwork); seen.add(key);
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
    writeLibraryLocalItem(localStorage, RECENT_ARTWORK_KEY, JSON.stringify(normalizeRecentArtwork(artwork)));
    window.dispatchEvent(new CustomEvent(RECENT_ARTWORK_EVENT));
    return { ok: true, error: '' };
  } catch {
    return { ok: false, error: 'Recently used artwork could not be updated. Your saved artwork is unchanged.' };
  }
}
export function rememberArtwork(value) {
  const artwork = safeArtwork(value);
  if (!identity(artwork)) return { ok: true, error: '' };
  return writeHistory([artwork, ...readRecentArtwork()]);
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
  const clear = () => { const result = writeHistory([]); setError(result.error); return result.ok; };
  return { entries, clear, error };
}
