import { APP_RECORD_VERSION } from './lib/appRecordVersion.js';
import { runLibraryWrite, writeLibraryLocalItem } from './lib/libraryWriteCoordinator.js';
import {
  filterEvalRuns,
  normalizeEntityId as normalizePromptId,
  normalizeEvalRunRecord,
  normalizeTestCaseRecord,
} from './lib/evalSchema.js';
import { logWarn } from './lib/logger.js';
import { hashText } from './lib/utils.js';
import { writeWithRecovery } from './lib/writeRecovery.js';

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

function openDb(permit) {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = runLibraryWrite(() => new Promise((resolve, reject) => {
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
  }), { parent: permit }).catch(error => {
    // A temporary capture pause must not cache an unavailable database after
    // writes resume. Preserve the existing fallback for actual open failures.
    if (error.code === 'LIBRARY_WRITES_PAUSED') dbPromise = undefined;
    throw error;
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

function writeFallback(key, records, permit) {
  try {
    writeLibraryLocalItem(localStorage, key, JSON.stringify(records), permit);
  } catch (e) {
    logWarn('localStorage write failed', e);
    throw e;
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
    // An error event precedes transaction abort. Completion tracking must wait
    // for the terminal abort/complete event, not just the failed request.
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function saveRunRecord(record, repository = null) {
  if (!record || !record.run_id) return null;
  const snapshot = { ...record };
  return writeWithRecovery(writeKey(repository, `run:${snapshot.run_id}`), permit => repository ? repository.saveRecord('execution-traces', snapshot) : persistRunRecord(snapshot, permit));
}

async function persistRunRecord(record, permit) {
  const db = await openDb(permit).catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const next = [record, ...readFallback(RUNS_LS_KEY).filter((row) => row.run_id !== record.run_id)];
    writeFallback(RUNS_LS_KEY, next, permit);
    return record;
  }
  const tx = db.transaction(RUNS_STORE, 'readwrite');
  tx.objectStore(RUNS_STORE).put(record);
  await txDone(tx);
  return record;
}

export async function listRunsByTrace(traceId, repository = null) {
  const id = String(traceId || '').trim();
  if (!id) return [];
  const db = repository ? null : await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (repository) {
    records = await repository.readDomain('execution-traces');
    records = records.filter(row => row.trace_id === id);
  } else if (!db) {
    records = readFallback(RUNS_LS_KEY).filter((row) => row.trace_id === id);
  } else {
    const tx = db.transaction(RUNS_STORE, 'readonly');
    records = (await txRequest(tx.objectStore(RUNS_STORE).index('trace_id').getAll(id))) || [];
  }
  return records.sort((left, right) => (left.started_at || 0) - (right.started_at || 0));
}

export function normalizeExperimentRecord(record) {
  return {
    ...record,
    id: record.id || crypto.randomUUID(),
    createdAt: record.createdAt || new Date().toISOString(),
    label: String(record.label || 'Untitled experiment').trim(),
    variants: Array.isArray(record.variants) ? record.variants : [],
    keyInputSnapshot: String(record.keyInputSnapshot || ''),
    outcome: record.outcome || { winnerVariantId: null },
    notes: String(record.notes || ''),
  };
}

export async function saveExperiment(record, repository = null) {
  const normalized = normalizeExperimentRecord(record);
  return writeWithRecovery(writeKey(repository, `experiment:${normalized.id}`), permit => repository ? repository.saveRecord('experiments', normalized) : persistExperiment(normalized, permit));
}

async function persistExperiment(normalized, permit) {
  const db = await openDb(permit).catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const existing = readFallback(EXPERIMENT_LS_KEY).filter((entry) => entry.id !== normalized.id);
    const next = [normalized, ...existing];
    writeFallback(EXPERIMENT_LS_KEY, next, permit);
    return normalized;
  }
  const tx = db.transaction(EXPERIMENT_STORE, 'readwrite');
  tx.objectStore(EXPERIMENT_STORE).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function listExperiments(filters = {}, repository = null) {
  const {
    search = '',
    dateFrom = '',
    dateTo = '',
  } = filters;
  const q = String(search || '').trim().toLowerCase();
  const db = repository ? null : await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (repository) {
    records = await repository.readDomain('experiments');
  } else if (!db) {
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

export async function getExperimentById(id, repository = null) {
  if (!id) return null;
  if (repository) return repository.readRecord('experiments', id);
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    return readFallback(EXPERIMENT_LS_KEY).find((entry) => entry.id === id) || null;
  }
  const tx = db.transaction(EXPERIMENT_STORE, 'readonly');
  const store = tx.objectStore(EXPERIMENT_STORE);
  return txRequest(store.get(id));
}

export async function saveEvalRun(record, repository = null) {
  const normalized = normalizeEvalRunRecord(record);
  return writeWithRecovery(writeKey(repository, `eval:${normalized.id}`), permit => repository ? repository.saveRecord('evaluations', normalized) : persistEvalRun(normalized, permit));
}

async function persistEvalRun(normalized, permit) {
  const db = await openDb(permit).catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const next = [normalized, ...readFallback(EVAL_RUN_LS_KEY).filter((entry) => entry.id !== normalized.id)];
    writeFallback(EVAL_RUN_LS_KEY, next, permit);
    signalEvalRunsChanged(normalized.id);
    return normalized;
  }
  const tx = db.transaction(EVAL_RUN_STORE, 'readwrite');
  tx.objectStore(EVAL_RUN_STORE).put(normalized);
  await txDone(tx);
  signalEvalRunsChanged(normalized.id);
  return normalized;
}

export async function patchEvalRun(id, patch, repository = null) {
  if (!id) return null;
  const existing = repository ? await repository.readObservedRecord('evaluations', id) : await getEvalRunById(id);
  if (!existing) return null;
  return saveEvalRun({ ...existing, ...(patch && typeof patch === 'object' ? patch : {}) }, repository);
}

export async function linkEvalRunToPrompt(id, promptId, promptVersionId = null, repository = null) {
  const normalizedPromptId = normalizePromptId(promptId);
  if (!id || !normalizedPromptId) return null;
  return patchEvalRun(id, {
    promptId: normalizedPromptId,
    promptVersionId: normalizePromptId(promptVersionId),
  }, repository);
}

export async function listEvalRuns(filters = {}, repository = null) {
  const db = repository ? null : await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (repository) {
    records = await repository.readDomain('evaluations');
  } else if (!db) {
    records = readFallback(EVAL_RUN_LS_KEY);
  } else {
    const tx = db.transaction(EVAL_RUN_STORE, 'readonly');
    const store = tx.objectStore(EVAL_RUN_STORE);
    records = (await txRequest(store.getAll())) || [];
  }
  return filterEvalRuns(records, filters);
}

export async function getEvalRunById(id, repository = null) {
  if (!id) return null;
  if (repository) return repository.readRecord('evaluations', id);
  const db = await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    return readFallback(EVAL_RUN_LS_KEY).find((entry) => entry.id === id) || null;
  }
  const tx = db.transaction(EVAL_RUN_STORE, 'readonly');
  const store = tx.objectStore(EVAL_RUN_STORE);
  return txRequest(store.get(id));
}

export async function saveTestCase(record, repository = null) {
  const normalized = normalizeTestCaseRecord(record);
  if (!normalized.promptId || !normalized.input.trim()) {
    throw new Error('Test cases require a promptId and input.');
  }
  return writeWithRecovery(writeKey(repository, `case:${normalized.id}`), permit => repository ? repository.saveRecord('test-cases', normalized) : persistTestCase(normalized, permit));
}

async function persistTestCase(normalized, permit) {
  const db = await openDb(permit).catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    const existing = readFallback(TEST_CASE_LS_KEY).filter((entry) => entry.id !== normalized.id);
    const next = [normalized, ...existing];
    writeFallback(TEST_CASE_LS_KEY, next, permit);
    return normalized;
  }
  const tx = db.transaction(TEST_CASE_STORE, 'readwrite');
  tx.objectStore(TEST_CASE_STORE).put(normalized);
  await txDone(tx);
  return normalized;
}

export async function listTestCases(filters = {}, repository = null) {
  const {
    promptId = '',
    limit = 200,
  } = filters;
  const promptFilter = normalizePromptId(promptId);
  const db = repository ? null : await openDb().catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  let records = [];
  if (repository) {
    records = await repository.readDomain('test-cases');
  } else if (!db) {
    records = readFallback(TEST_CASE_LS_KEY);
  } else {
    const tx = db.transaction(TEST_CASE_STORE, 'readonly');
    const store = tx.objectStore(TEST_CASE_STORE);
    records = (await txRequest(store.getAll())) || [];
  }
  const sorted = records
    .map(normalizeTestCaseRecord)
    .filter((row) => !promptFilter || row.promptId === promptFilter)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  if (limit === null || limit === 'all') return sorted;
  return sorted.slice(0, Math.max(1, Math.min(500, Number(limit) || 200)));
}

export async function deleteTestCase(id, repository = null, expectedVersion) {
  if (!id) return;
  return writeWithRecovery(writeKey(repository, `case:${id}`), permit => repository ? repository.deleteRecord('test-cases', id, expectedVersion) : removeTestCase(id, permit));
}

async function removeTestCase(id, permit) {
  const db = await openDb(permit).catch((e) => { logWarn('IndexedDB unavailable', e); return null; });
  if (!db) {
    writeFallback(TEST_CASE_LS_KEY, readFallback(TEST_CASE_LS_KEY).filter((entry) => entry.id !== id), permit);
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

// The app startup owner supplies this dependency only after whole-app activation
// is qualified. Existing exports keep their browser-store behavior until then.
export function createExperimentStore(repository) {
  if (!repository || typeof repository.libraryId !== 'string'
    || ['readDomain', 'readRecord', 'readObservedRecord', 'saveRecord', 'deleteRecord'].some(key => typeof repository[key] !== 'function')) {
    throw new TypeError('A selected app library repository is required.');
  }
  return Object.freeze({
    saveRunRecord: record => saveRunRecord(record, repository),
    listRunsByTrace: id => listRunsByTrace(id, repository),
    saveExperiment: record => saveExperiment(record, repository),
    listExperiments: filters => listExperiments(filters, repository),
    getExperimentById: id => getExperimentById(id, repository),
    saveEvalRun: record => saveEvalRun(record, repository),
    patchEvalRun: (id, patch) => patchEvalRun(id, patch, repository),
    linkEvalRunToPrompt: (id, promptId, versionId) => linkEvalRunToPrompt(id, promptId, versionId, repository),
    listEvalRuns: filters => listEvalRuns(filters, repository),
    getEvalRunById: id => getEvalRunById(id, repository),
    saveTestCase: record => saveTestCase(record, repository),
    listTestCases: filters => listTestCases(filters, repository),
    deleteTestCase: (id, observed) => deleteTestCase(id, repository, observed?.[APP_RECORD_VERSION]),
  });
}

function writeKey(repository, key) {
  return repository ? `library:${JSON.stringify([repository.libraryId, key])}` : key;
}
