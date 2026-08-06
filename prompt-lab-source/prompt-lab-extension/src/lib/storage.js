import { logWarn } from './logger.js';

export const storageKeys = Object.freeze({
  library: 'pl2-library',
  collections: 'pl2-collections',
  libraryEnvelope: 'pl2-library-envelope',
  libraryBackup: 'pl2-library-backup',
  libraryCorruptBackup: 'pl2-library-corrupt-backup',
  libraryView: 'pl2-library-view',
  librarySearch: 'pl2-library-search',
  libraryActiveTag: 'pl2-library-active-tag',
  libraryActiveCollection: 'pl2-library-active-collection',
  sortBy: 'pl2-sort-by',
  mode: 'pl2-mode',
  pad: 'pl2-pad',
  experimentHistory: 'pl2-experiment-history',
  billing: 'pl2-billing',
  telemetry: 'pl2-telemetry',
});

export function loadJson(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    logWarn(`loadJson "${key}"`, e);
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      logWarn(`saveJson "${key}" — storage quota exceeded. Data may not be saved.`);
    } else {
      logWarn(`saveJson "${key}"`, e);
    }
    return false;
  }
}

export function probeStorage(storage = globalThis.localStorage) {
  const key = `pl2-storage-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const value = 'prompt-lab-storage-ok';
  try {
    if (!storage) throw new Error('Local storage is unavailable.');
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) {
      throw new Error('Local storage did not return the verification value.');
    }
    storage.removeItem(key);
    return { ok: true, message: 'Local storage ready.' };
  } catch (error) {
    try { storage?.removeItem(key); } catch { /* best-effort cleanup */ }
    const quotaExceeded = error?.name === 'QuotaExceededError'
      || String(error?.message || '').toLowerCase().includes('quota');
    return {
      ok: false,
      message: quotaExceeded
        ? 'Local storage is full. Export or remove data before continuing.'
        : 'Local storage is unavailable. Changes may not survive restart.',
      error,
    };
  }
}

export function getAnticipation() {
  try { return JSON.parse(localStorage.getItem('pl2-anticipation') || '{}'); } catch { return {}; }
}

export function setAnticipation(data) {
  localStorage.setItem('pl2-anticipation', JSON.stringify(data));
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    logWarn(`removeKey "${key}"`, e);
    return false;
  }
}
