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
const RUNS_STORE = 'runs';
const VERSION = 4;
const EXPERIMENT_LS_KEY = 'pl2-experiment-fallback';
const EVAL_RUN_LS_KEY = 'pl2-eval-run-fallback';
export const EVAL_RUN_SIGNAL_KEY = 'pl2-eval-run-signal';
const TEST_CASE_LS_KEY = 'pl2-test-case-fallback';
const RUNS_LS_KEY = 'pl2-run-fallback';

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
      if (!db.objectStoreNames.contains(RUNS_STORE)) {
        const store = db.createObjectStore(RUNS_STORE, { keyPath: 'run_id' });
        store.createIndex('trace_id', 'trace_id');
        store.createIndex('started_at', 'started_at');
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
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
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

function signalEvalRunsChanged(runId) {
  try {
    localStorage.setItem(EVAL_RUN_SIGNAL_KEY, JSON.stringify({ runId, at: Date.now() }));
  } catch {
    // IndexedDB remains authoritative when the lightweight cross-tab signal
    // cannot be written.
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

export async function saveRunRecord(record) {
  if (!record || !record.run_id) return null;
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const next = [record, ...readFallback(RUNS_LS_KEY).filter((row) => row.run_id !== record.run_id)].slice(0, 1000);
    writeFallback(RUNS_LS_KEY, next);
    return record;
  }
  const tx = db.transaction(RUNS_STORE, 'readwrite');
  tx.objectStore(RUNS_STORE).put(record);
  await txDone(tx);
  return record;
}

export async function listRunsByTrace(traceId) {
  const id = String(traceId || '').trim();
  if (!id) return [];
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (!db) {
    records = readFallback(RUNS_LS_KEY).filter((row) => row.trace_id === id);
  } else {
    const tx = db.transaction(RUNS_STORE, 'readonly');
    records = (await txRequest(tx.objectStore(RUNS_STORE).index('trace_id').getAll(id))) || [];
  }
  return records.sort((left, right) => (left.started_at || 0) - (right.started_at || 0));
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
    const existing = readFallback(EXPERIMENT_LS_KEY).filter((entry) => entry.id !== normalized.id);
    const next = [normalized, ...existing].slice(0, 500);
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
    const next = [normalized, ...readFallback(EVAL_RUN_LS_KEY).filter((entry) => entry.id !== normalized.id)].slice(0, 1000);
    writeFallback(EVAL_RUN_LS_KEY, next);
    signalEvalRunsChanged(normalized.id);
    return normalized;
  }
  const tx = db.transaction(EVAL_RUN_STORE, 'readwrite');
  tx.objectStore(EVAL_RUN_STORE).put(normalized);
  await txDone(tx);
  signalEvalRunsChanged(normalized.id);
  return normalized;
}

export async function patchEvalRun(id, patch) {
  const existing = await getEvalRunById(id);
  if (!existing) return null;
  return saveEvalRun({ ...existing, ...(patch && typeof patch === 'object' ? patch : {}) });
}

export async function linkEvalRunToPrompt(id, promptId, promptVersionId = null) {
  const normalizedPromptId = normalizePromptId(promptId);
  if (!id || !normalizedPromptId) return null;
  return patchEvalRun(id, {
    promptId: normalizedPromptId,
    promptVersionId: normalizePromptId(promptVersionId),
  });
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
  normalizeEvalRunRecord,
  normalizeTestCaseRecord,
};
