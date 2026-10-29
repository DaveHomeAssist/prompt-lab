import { canonical, MAX_BYTES } from '../../../library-storage/contract.mjs';

const changed = () => Object.assign(new Error('An editor changed during preservation capture. Retry the capture.'), { code: 'LIBRARY_CAPTURE_CHANGED' });

export function createLibraryEditBuffers() {
  const readers = new Map(), timers = new Map();
  let suspended = false;
  function register(id, read) {
    if (typeof id !== 'string' || !id || readers.has(id) || typeof read !== 'function') throw new TypeError('A unique buffer identity and reader are required.');
    readers.set(id, read);
    return () => { if (readers.get(id) === read) readers.delete(id); };
  }
  function arm(token, job) {
    job.timer = setTimeout(() => { timers.delete(token); job.callback(); }, job.delay);
  }
  function schedule(callback, delay) {
    const token = {}, job = { callback, delay, timer: null };
    timers.set(token, job);
    if (!suspended) arm(token, job);
    return token;
  }
  function cancel(token) {
    const job = timers.get(token);
    if (job) { clearTimeout(job.timer); timers.delete(token); }
  }
  function read() {
    const serialized = canonical([...readers].sort(([a], [b]) => a.localeCompare(b)).map(([id, get]) => ({ id, value: get() })));
    if (new TextEncoder().encode(serialized).length > MAX_BYTES) throw Object.assign(new Error('Editor capture exceeds the preservation limit.'), { code: 'PAYLOAD_TOO_LARGE' });
    return JSON.parse(serialized);
  }
  function suspend() {
    if (suspended) throw changed();
    suspended = true;
    for (const job of timers.values()) clearTimeout(job.timer);
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true; suspended = false;
      for (const [token, job] of timers) arm(token, job);
    };
  }
  return { register, schedule, cancel, read, suspend,
    assertUnchanged: snapshot => { if (canonical(read()) !== canonical(snapshot)) throw changed(); } };
}

export const libraryEditBuffers = createLibraryEditBuffers();
export const setLibraryBufferTimeout = (callback, delay) => libraryEditBuffers.schedule(callback, delay);
export const clearLibraryBufferTimeout = token => libraryEditBuffers.cancel(token);
