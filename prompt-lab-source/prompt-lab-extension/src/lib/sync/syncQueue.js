// Durable outbox of local changes waiting to reach the account. One entry per
// item (newest change wins locally); retried with capped exponential backoff.
export const BASE_DELAY_MS = 2000;
export const MAX_DELAY_MS = 5 * 60 * 1000;

export function backoffDelay(attempts, random = Math.random) {
  const exponential = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(exponential * (0.8 + random() * 0.4));
}

export function createSyncQueue(storage, key) {
  const read = () => {
    try {
      const value = JSON.parse(storage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  };
  const write = (state) => { storage.setItem(key, JSON.stringify(state)); };
  return {
    entries: () => Object.values(read()).sort((a, b) => a.lamport - b.lamport),
    size: () => Object.keys(read()).length,
    get: (itemKey) => read()[itemKey] || null,
    put(change) {
      const state = read();
      const previous = state[change.key];
      state[change.key] = { ...change, attempts: previous?.attempts || 0, nextAttemptAt: previous?.nextAttemptAt || 0, lastError: previous?.lastError || '' };
      write(state);
    },
    remove(keys) {
      const state = read();
      for (const itemKey of keys) delete state[itemKey];
      write(state);
    },
    // Only drop an entry if it was not replaced by a newer local edit meanwhile.
    acknowledge(itemKey, lamport) {
      const state = read();
      if (state[itemKey] && state[itemKey].lamport === lamport) { delete state[itemKey]; write(state); return true; }
      return false;
    },
    fail(keys, error, now = Date.now(), random = Math.random) {
      const state = read();
      for (const itemKey of keys) {
        const entry = state[itemKey];
        if (!entry) continue;
        entry.attempts = (entry.attempts || 0) + 1;
        entry.nextAttemptAt = now + backoffDelay(entry.attempts, random);
        entry.lastError = String(error || 'Sync failed').slice(0, 200);
      }
      write(state);
    },
    due: (now = Date.now()) => Object.values(read()).filter((entry) => (entry.nextAttemptAt || 0) <= now).sort((a, b) => a.lamport - b.lamport),
  };
}
