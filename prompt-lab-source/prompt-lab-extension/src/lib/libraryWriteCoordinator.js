import { isLocalContentKey } from '../../../library-storage/content-keys.mjs';

const error = code => Object.assign(new Error({
  LIBRARY_WRITES_PAUSED: 'Library writes are paused for a preservation check. Keep your draft and retry shortly.',
  LIBRARY_WRITES_PENDING: 'Some library changes have not been saved. Retry those writes before continuing.',
  LIBRARY_CAPTURE_BUSY: 'A library preservation check is already running.',
  LIBRARY_CAPTURE_CHANGED: 'A write was attempted during the preservation check. Retry the check.',
  LIBRARY_CAPTURE_TIMEOUT: 'The library preservation check did not finish in time.',
  LIBRARY_WRITE_FAILED: 'A library write did not complete.',
}[code] || 'Library write coordination failed.'), { code });

// This coordinates one JavaScript context only. It is not a browser-origin,
// native-process or iCloud lock, and cannot authorize migration activation.
export function createLibraryWriteCoordinator() {
  const active = new Set();
  const unresolved = new Set();
  const latest = new Map();
  const waiters = new Set();
  let paused = null;
  let synchronousPermit;
  let completed = 0;
  const wake = () => { for (const resolve of waiters) resolve(); waiters.clear(); };

  function assertWritable(parent = synchronousPermit) {
    if (!paused || active.has(parent)) return;
    paused.interference = true;
    throw error('LIBRARY_WRITES_PAUSED');
  }

  function withPermit(permit, operation) {
    if (!active.has(permit)) throw error('LIBRARY_WRITES_PAUSED');
    const previous = synchronousPermit;
    synchronousPermit = permit;
    try { return operation(); } finally { synchronousPermit = previous; }
  }

  // Register before invoking the operation, including before any queued or
  // deferred work. Explicit live permits allow its nested writes to finish.
  function run(operation, { parent = synchronousPermit, key } = {}) {
    const token = Object.freeze({});
    if (key) latest.set(key, token);
    try { assertWritable(parent); } catch (cause) {
      if (key) { unresolved.add(key); latest.delete(key); }
      return Promise.reject(cause);
    }
    active.add(token);
    let result;
    try { result = withPermit(token, () => operation(token)); } catch (cause) { result = Promise.reject(cause); }
    const finish = failed => {
      if (failed && paused) paused.failed = true;
      if (key && latest.get(key) === token) {
        if (failed) unresolved.add(key); else unresolved.delete(key);
        latest.delete(key);
      }
      active.delete(token);
      completed += 1;
      wake();
    };
    return Promise.resolve(result).then(value => {
      if (value === false) { finish(true); throw error('LIBRARY_WRITE_FAILED'); }
      finish(false);
      return value;
    }, cause => { finish(true); throw cause; });
  }

  async function withPausedWrites(read, { timeoutMs = 30_000 } = {}) {
    if (typeof read !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new TypeError('A reader and a timeout from 1 to 60000 milliseconds are required.');
    }
    if (paused) throw error('LIBRARY_CAPTURE_BUSY');
    const state = { interference: false, failed: false };
    paused = state;
    const before = completed;
    const startedAt = new Date().toISOString();
    const deadline = Date.now() + timeoutMs;
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); wake(); }, timeoutMs);
    const check = () => {
      if (abort.signal.aborted || Date.now() >= deadline) throw error('LIBRARY_CAPTURE_TIMEOUT');
      if (state.interference) throw error('LIBRARY_CAPTURE_CHANGED');
      if (state.failed || unresolved.size) throw error('LIBRARY_WRITES_PENDING');
    };
    try {
      while (active.size) {
        if (abort.signal.aborted || Date.now() >= deadline) throw error('LIBRARY_CAPTURE_TIMEOUT');
        await new Promise(resolve => waiters.add(resolve));
      }
      check();
      // Do not race the reader against a timer: releasing the pause while a
      // timed-out reader is still running would allow a mixed-time snapshot.
      const value = await read({ signal: abort.signal, check });
      check();
      return { value, coordination: {
        scope: 'current-context', startedAt, completedAt: new Date().toISOString(),
        writesDrained: completed - before, activationReady: false,
      } };
    } finally {
      clearTimeout(timer);
      paused = null;
      wake();
    }
  }

  return { run, assertWritable, withPermit, withPausedWrites,
    status: () => ({ paused: Boolean(paused), active: active.size, unresolved: unresolved.size }) };
}

export const libraryWriteCoordinator = createLibraryWriteCoordinator();
export const runLibraryWrite = (operation, options) => libraryWriteCoordinator.run(operation, options);
export const withLibraryWritePermit = (permit, operation) => libraryWriteCoordinator.withPermit(permit, operation);
export function assertLibraryContentWritable(key, parent) {
  if (isLocalContentKey(key)) libraryWriteCoordinator.assertWritable(parent);
}
export function writeLibraryLocalItem(storage, key, value, parent) {
  assertLibraryContentWritable(key, parent);
  storage.setItem(key, value);
}
export function removeLibraryLocalItem(storage, key, parent) {
  assertLibraryContentWritable(key, parent);
  storage.removeItem(key);
}
