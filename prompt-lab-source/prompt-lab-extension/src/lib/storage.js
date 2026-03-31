import { logWarn } from './logger.js';

export const storageKeys = Object.freeze({
  library: 'pl2-library',
  collections: 'pl2-collections',
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
    logWarn(`saveJson "${key}"`, e);
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
    return true;
  } catch (e) {
    logWarn(`removeKey "${key}"`, e);
    return false;
  }
}
