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
  libraryDensity: 'pl2-density',
  libraryAccent: 'pl2-accent',
  librarySignature: 'pl2-signature',
  // Prompt Packs v1 uses a NEW key (not the spec's `pl2-loaded-packs`)
  // because that name is already taken by the legacy starter-pack tracker
  // in lib/seedTransform.js — flat string[] of pack ids. Reusing the
  // legacy key would silently clobber starter-pack state on first import.
  // Documented in lib/packs/store.js header.
  packsV1: 'pl2-packs-v1',
});

export function getCorruptBackupKey(key, timestamp = new Date().toISOString()) {
  return `${key}:corrupt-backup:${timestamp}`;
}

function backupCorruptJson(key, rawValue) {
  const backupKey = getCorruptBackupKey(key);
  try {
    localStorage.setItem(backupKey, rawValue);
    return backupKey;
  } catch (e) {
    logWarn(`backupCorruptJson "${key}"`, e);
    return null;
  }
}

export function loadJsonWithRecovery(key, fallback = null, options = {}) {
  let value;
  try {
    value = localStorage.getItem(key);
  } catch (e) {
    logWarn(`loadJson "${key}"`, e);
    return { value: fallback, corrupted: false, backupKey: null };
  }

  if (!value) return { value: fallback, corrupted: false, backupKey: null };

  try {
    return { value: JSON.parse(value), corrupted: false, backupKey: null };
  } catch (e) {
    logWarn(`loadJson "${key}"`, e);
    return {
      value: fallback,
      corrupted: true,
      backupKey: options.backupCorrupt ? backupCorruptJson(key, value) : null,
    };
  }
}

export function loadJson(key, fallback = null) {
  return loadJsonWithRecovery(key, fallback).value;
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

export function getAnticipation() {
  try { return JSON.parse(localStorage.getItem('pl2-anticipation') || '{}'); } catch { return {}; }
}

export function setAnticipation(data) {
  try {
    localStorage.setItem('pl2-anticipation', JSON.stringify(data));
    return true;
  } catch (e) {
    logWarn('setAnticipation "pl2-anticipation"', e);
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
