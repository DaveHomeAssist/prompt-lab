import {
  filterEvalRuns,
  normalizeEntityId as normalizePromptId,
  normalizeEvalRunRecord,
  normalizeTestCaseRecord,
} from './lib/evalSchema.js';
import { logWarn } from './lib/logger.js';
import { hashText } from './lib/utils.js';

const DB_NAME = 'prompt_lab_local';
const EXPERIMENT_STORE = 'experiments';
const EVAL_RUN_STORE = 'eval_runs';
const TEST_CASE_STORE = 'test_cases';
const VERSION = 3;
const EXPERIMENT_LS_KEY = 'pl2-experiment-fallback';
const EVAL_RUN_LS_KEY = 'pl2-eval-run-fallback';
const TEST_CASE_LS_KEY = 'pl2-test-case-fallback';

let dbPromise;

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EXPERIMENT_STORE)) {
        const store = db.createObjectStore(EXPERIMENT_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('label', 'label');
      }
      if (!db.objectStoreNames.contains(EVAL_RUN_STORE)) {
        const store = db.createObjectStore(EVAL_RUN_STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('promptId', 'promptId');
        store.createIndex('mode', 'mode');
        store.createIndex('provider', 'provider');
      }
      if (!db.objectStoreNames.contains(TEST_CASE_STORE)) {
        const store = db.createObjectStore(TEST_CASE_STORE, { keyPath: 'id' });
        store.createIndex('promptId', 'promptId');
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function readFallback(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeFallback(key, records) {
  try {
    localStorage.setItem(key, JSON.stringify(records));
  } catch (e) {
    logWarn('localStorage write failed', e);
  }
}

function txRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export function normalizeExperimentRecord(record) {
  return {
    id: record.id || crypto.randomUUID(),
    createdAt: record.createdAt || new Date().toISOString(),
    label: String(record.label || 'Untitled experiment').trim(),
    variants: Array.isArray(record.variants) ? record.variants : [],
    keyInputSnapshot: String(record.keyInputSnapshot || '').slice(0, 1200),
    outcome: record.outcome || { winnerVariantId: null },
    notes: String(record.notes || ''),
  };
}

export async function saveExperiment(record) {
  const normalized = normalizeExperimentRecord(record);
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const next = [normalized, ...readFallback(EXPERIMENT_LS_KEY)].slice(0, 500);
    writeFallback(EXPERIMENT_LS_KEY, next);
    return normalized;
  }
  const tx = db.transaction(EXPERIMENT_STORE, 'readwrite');
  tx.objectStore(EXPERIMENT_STORE).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function listExperiments(filters = {}) {
  const {
    search = '',
    dateFrom = '',
    dateTo = '',
  } = filters;
  const q = String(search || '').trim().toLowerCase();
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (!db) {
    records = readFallback(EXPERIMENT_LS_KEY);
  } else {
    const tx = db.transaction(EXPERIMENT_STORE, 'readonly');
    const store = tx.objectStore(EXPERIMENT_STORE);
    records = (await txRequest(store.getAll())) || [];
  }
  return records
    .filter((row) => {
      const rowDate = row.createdAt ? new Date(row.createdAt).getTime() : 0;
      if (dateFrom && rowDate < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && rowDate > new Date(`${dateTo}T23:59:59`).getTime()) return false;
      if (q) {
        const hay = `${row.label} ${row.notes}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getExperimentById(id) {
  if (!id) return null;
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    return readFallback(EXPERIMENT_LS_KEY).find((entry) => entry.id === id) || null;
  }
  const tx = db.transaction(EXPERIMENT_STORE, 'readonly');
  const store = tx.objectStore(EXPERIMENT_STORE);
  return txRequest(store.get(id));
}

export async function saveEvalRun(record) {
  const normalized = normalizeEvalRunRecord(record);
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const next = [normalized, ...readFallback(EVAL_RUN_LS_KEY)].slice(0, 1000);
    writeFallback(EVAL_RUN_LS_KEY, next);
    return normalized;
  }
  const tx = db.transaction(EVAL_RUN_STORE, 'readwrite');
  tx.objectStore(EVAL_RUN_STORE).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function listEvalRuns(filters = {}) {
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (!db) {
    records = readFallback(EVAL_RUN_LS_KEY);
  } else {
    const tx = db.transaction(EVAL_RUN_STORE, 'readonly');
    const store = tx.objectStore(EVAL_RUN_STORE);
    records = (await txRequest(store.getAll())) || [];
  }
  return filterEvalRuns(records, filters);
}

export async function getEvalRunById(id) {
  if (!id) return null;
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    return readFallback(EVAL_RUN_LS_KEY).find((entry) => entry.id === id) || null;
  }
  const tx = db.transaction(EVAL_RUN_STORE, 'readonly');
  const store = tx.objectStore(EVAL_RUN_STORE);
  return txRequest(store.get(id));
}

export async function saveTestCase(record) {
  const normalized = normalizeTestCaseRecord(record);
  if (!normalized.promptId || !normalized.input.trim()) {
    throw new Error('Test cases require a promptId and input.');
  }
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const existing = readFallback(TEST_CASE_LS_KEY).filter((entry) => entry.id !== normalized.id);
    const next = [normalized, ...existing].slice(0, 1000);
    writeFallback(TEST_CASE_LS_KEY, next);
    return normalized;
  }
  const tx = db.transaction(TEST_CASE_STORE, 'readwrite');
  tx.objectStore(TEST_CASE_STORE).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function listTestCases(filters = {}) {
  const {
    promptId = '',
    limit = 200,
  } = filters;
  const promptFilter = normalizePromptId(promptId);
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (!db) {
    records = readFallback(TEST_CASE_LS_KEY);
  } else {
    const tx = db.transaction(TEST_CASE_STORE, 'readonly');
    const store = tx.objectStore(TEST_CASE_STORE);
    records = (await txRequest(store.getAll())) || [];
  }
  return records
    .map(normalizeTestCaseRecord)
    .filter((row) => !promptFilter || row.promptId === promptFilter)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
}

export async function deleteTestCase(id) {
  if (!id) return;
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    writeFallback(TEST_CASE_LS_KEY, readFallback(TEST_CASE_LS_KEY).filter((entry) => entry.id !== id));
    return;
  }
  const tx = db.transaction(TEST_CASE_STORE, 'readwrite');
  tx.objectStore(TEST_CASE_STORE).delete(id);
  await txDone(tx);
}

export {
  filterEvalRuns,
  hashText,
  normalizeEvalRunRecord,
  normalizeTestCaseRecord,
};
