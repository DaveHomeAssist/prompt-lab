import { LIBRARY_JOURNAL_DB, LIBRARY_JOURNAL_STORE } from '../../lib/libraryJournal.js';

// Minimal IndexedDB: staged puts reach the database only when a transaction
// completes, so a failed commit leaves the previous journal in place.
export function createFakeIndexedDb() {
  const databases = new Map();
  const transactions = [];
  const state = { failCommits: false, holdCommits: false, hangOpen: false };
  const later = (callback) => Promise.resolve().then(callback);
  const request = () => ({ result: undefined, error: null });

  function transaction(data, storeName, mode, options = {}) {
    const table = data.stores.get(storeName);
    const staged = [];
    const tx = { mode, options, error: null };
    let finished = false;
    let outstanding = 0;
    const settle = () => later(() => {
      if (outstanding || finished) return;
      if (mode === 'readwrite' && state.holdCommits) { tx.release = settle; return; }
      finished = true;
      if (state.failCommits) {
        tx.error = new Error('Synthetic commit failure');
        tx.onabort?.();
        return;
      }
      for (const [key, value] of staged) table.rows.set(key, structuredClone(value));
      tx.oncomplete?.();
    });
    tx.objectStore = () => ({
      get(key) {
        const req = request();
        outstanding += 1;
        later(() => {
          req.result = structuredClone(table.rows.get(key));
          outstanding -= 1;
          req.onsuccess?.();
          settle();
        });
        return req;
      },
      put(value) { staged.push([value[table.keyPath], value]); },
    });
    transactions.push(tx);
    settle();
    return tx;
  }

  function open(name, version) {
    const req = request();
    if (state.hangOpen) return req;
    later(() => {
      let data = databases.get(name);
      const upgrade = !data || data.version < version;
      if (!data) databases.set(name, data = { version, stores: new Map() });
      req.result = {
        objectStoreNames: { contains: (store) => data.stores.has(store) },
        createObjectStore: (store, { keyPath }) => data.stores.set(store, { keyPath, rows: new Map() }),
        transaction: (store, mode, options) => transaction(data, store, mode, options),
      };
      if (upgrade) {
        data.version = version;
        req.onupgradeneeded?.();
      }
      req.onsuccess?.();
    });
    return req;
  }

  return { open, transactions, state, rows: () => databases.get(LIBRARY_JOURNAL_DB)?.stores.get(LIBRARY_JOURNAL_STORE)?.rows };
}
