/**
 * Persist run-emitter lifecycle events as RunRecords in the runs store.
 * Terminal events only — run:end / run:error — so no dangling 'running' rows.
 */
import { on } from './runEmitter.js';
import { saveRunRecord } from '../experimentStore.js';
import { logWarn } from './logger.js';

let initialized = false;
let unsubscribeLegacy = [];

// A trace owns its store even if the initiating panel closes. finish() drains
// terminal writes and reports failure to the caller instead of assuming that
// one browser task turn is sufficient for an acknowledged save.
export function createRunPersistence({ traceId, saveRecord }) {
  if (!traceId || typeof saveRecord !== 'function') throw new TypeError('A trace and record writer are required.');
  const writes = [];
  const persistTrace = payload => {
    if (payload?.trace_id !== traceId || !payload.run_id) return;
    writes.push(Promise.resolve().then(() => saveRecord(payload)).then(
      () => ({ ok: true }), error => ({ ok: false, error }),
    ));
  };
  const unsubscribe = [on('run:end', persistTrace), on('run:error', persistTrace)];
  let finished;
  return {
    finish() {
      if (!finished) {
        unsubscribe.forEach(stop => stop());
        finished = Promise.all(writes).then(results => {
          const failed = results.find(result => !result.ok);
          if (failed) throw failed.error;
        });
      }
      return finished;
    },
  };
}

function persist(payload) {
  if (!payload?.run_id) return;
  saveRunRecord(payload).catch((caught) => logWarn('persist run record', caught));
}

export function initRunPersistence() {
  if (initialized) return;
  initialized = true;
  unsubscribeLegacy = [on('run:end', persist), on('run:error', persist)];
}

export function resetRunPersistenceForTests() {
  unsubscribeLegacy.forEach(stop => stop());
  unsubscribeLegacy = [];
  initialized = false;
}
