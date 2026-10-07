import { logWarn } from './logger.js';

export const storageKeys = Object.freeze({
  library: 'pl2-library',
  trash: 'pl2-library-trash',
  collections: 'pl2-collections',
  sortBy: 'pl2-sort-by',
  mode: 'pl2-mode',
  pad: 'pl2-pad',
  experimentHistory: 'pl2-experiment-history',
  billing: 'pl2-billing',
  telemetry: 'pl2-telemetry',
  packs: 'pl2-packs',
  loadedPacks: 'pl2-loaded-packs',
});

const writeListeners = new Set();

// Observers run after a localStorage write has succeeded. The desktop Library
// journal uses this to follow every Library writer without wrapping Storage.
export function onLocalWrite(listener) {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

export function notifyLocalWrite(key) {
  for (const listener of writeListeners) {
    try {
      listener(key);
    } catch (e) {
      logWarn(`local write listener "${key}"`, e);
    }
  }
}

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
    notifyLocalWrite(key);
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

export function getAnticipation() {
  try { return JSON.parse(localStorage.getItem('pl2-anticipation') || '{}'); } catch { return {}; }
}

export function setAnticipation(data) {
  localStorage.setItem('pl2-anticipation', JSON.stringify(data));
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
    notifyLocalWrite(key);
    return true;
  } catch (e) {
    logWarn(`removeKey "${key}"`, e);
    return false;
  }
}
