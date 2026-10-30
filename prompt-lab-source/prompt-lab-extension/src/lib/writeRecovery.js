import { logWarn } from './logger.js';
import { runLibraryWrite } from './libraryWriteCoordinator.js';

export const RECORDS_CHANGED_EVENT = 'pl:records-changed';

const pending = new Map();
const running = new Map();
const latest = new Map();
const listeners = new Set();
let retryPromise = null;

function publish() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      logWarn('pending write listener', error);
    }
  }
}

export const getPendingWriteCount = () => pending.size;

export function subscribeToPendingWrites(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Retain only local write operations. A retry never re-enters provider execution.
// Same-record operations are ordered, and a newer edit supersedes an older retry.
export function writeWithRecovery(key, operation) {
  const job = { operation };
  latest.set(key, job);
  const previous = running.get(key) || Promise.resolve();
  const attempt = runLibraryWrite(async permit => {
    await previous.catch(() => {});
    let result;
    try {
      result = await operation(permit);
    } catch (error) {
      if (latest.get(key) === job) {
        pending.set(key, job);
        publish();
      }
      throw error;
    }
    if (latest.get(key) === job && pending.delete(key)) {
      publish();
      window.dispatchEvent(new CustomEvent(RECORDS_CHANGED_EVENT));
    }
    return result;
  }, { key: `records:${key}` }).catch(error => {
    // A pause can reject before the queued operation starts. Retain it using
    // the same retry path as a storage failure, without invoking it early.
    if (latest.get(key) === job && pending.get(key) !== job) {
      pending.set(key, job);
      publish();
    }
    throw error;
  });
  const completion = attempt.finally(() => {
    if (running.get(key) === completion) running.delete(key);
    if (latest.get(key) === job && !pending.has(key)) latest.delete(key);
  });
  running.set(key, completion);
  return completion;
}

export function retryPendingWrites() {
  if (retryPromise) return retryPromise;
  const jobs = [...pending].filter(([key, job]) => latest.get(key) === job);
  retryPromise = Promise.allSettled(jobs.map(([key, job]) => writeWithRecovery(key, job.operation)))
    .finally(() => { retryPromise = null; });
  return retryPromise;
}
