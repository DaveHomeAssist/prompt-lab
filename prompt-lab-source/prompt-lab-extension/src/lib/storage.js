import { logWarn } from './logger.js';

export const storageKeys = Object.freeze({
  library: 'pl2-library',
  collections: 'pl2-collections',
  mode: 'pl2-mode',
  pad: 'pl2-pad',
  experimentHistory: 'pl2-experiment-history',
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
    logWarn(`saveJson "${key}"`, e);
    return false;
  }
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
