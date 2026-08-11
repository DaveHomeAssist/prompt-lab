/**
 * Persist run-emitter lifecycle events as RunRecords in the runs store.
 * Terminal events only — run:end / run:error — so no dangling 'running' rows.
 */
import { on } from './runEmitter.js';
import { saveRunRecord } from '../experimentStore.js';
import { logWarn } from './logger.js';

let initialized = false;

function persist(payload) {
  if (!payload?.run_id) return;
  saveRunRecord(payload).catch((caught) => logWarn('persist run record', caught));
}

export function initRunPersistence() {
  if (initialized) return;
  initialized = true;
  on('run:end', persist);
  on('run:error', persist);
}

export function resetRunPersistenceForTests() {
  initialized = false;
}
