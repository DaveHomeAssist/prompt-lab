import { LibraryError } from '../../../library-storage/contract.mjs';

export const COMMAND_OUTBOX_DATABASE = 'prompt_lab_command_outbox';
const STORE = 'commands';

// This store never opens another app's profile or falls back to volatile memory.
// Transaction completion acknowledges local pending storage, not a folder save.
export function createIndexedCommandStore({ indexedDB = globalThis.indexedDB, database = COMMAND_OUTBOX_DATABASE, openTimeoutMs = 5000 } = {}) {
  if (!Number.isInteger(openTimeoutMs) || openTimeoutMs < 1 || openTimeoutMs > 30_000) throw new TypeError('A bounded database open timeout is required.');
  let connection;
  async function open() {
    if (!indexedDB) throw new LibraryError('OUTBOX_UNAVAILABLE', 'Durable pending storage is unavailable.', 503);
    if (!connection) {
      connection = new Promise((resolve, reject) => {
        const request = indexedDB.open(database, 1);
        let abandoned = false;
        const refuse = () => { abandoned = true; clearTimeout(timer); reject(new LibraryError('OUTBOX_UNAVAILABLE', 'Durable pending storage could not be opened.', 503)); };
        const timer = setTimeout(refuse, openTimeoutMs);
        request.onblocked = refuse;
        request.onupgradeneeded = () => {
          if (abandoned) { request.transaction.abort(); return; }
          const store = request.result.createObjectStore(STORE, { keyPath: ['libraryId', 'operationId'] });
          store.createIndex('libraryId', 'libraryId');
        };
        request.onerror = refuse;
        request.onsuccess = () => {
          const db = request.result;
          clearTimeout(timer);
          if (abandoned) { db.close(); return; }
          db.onversionchange = () => { db.close(); connection = undefined; };
          resolve(db);
        };
      }).catch(error => { connection = undefined; throw error; });
    }
    return connection;
  }
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try {
        tx = db.transaction(STORE, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
        tx.oncomplete = () => resolve(structuredClone(result));
        tx.onabort = () => reject(failure ?? new LibraryError('OUTBOX_WRITE_FAILED', 'Pending-command storage did not commit. Keep the draft and retry.', 503));
        tx.onerror = event => { event.preventDefault(); tx.abort(); };
        if (mode === 'readwrite' && tx.durability !== 'strict') {
          failure = new LibraryError('OUTBOX_UNSUPPORTED', 'This browser cannot acknowledge durable pending writes.', 503); tx.abort(); return;
        }
        operation(tx.objectStore(STORE), value => { result = value; }, error => { failure = error; tx.abort(); });
      } catch {
        if (tx) tx.abort();
        else reject(new LibraryError('OUTBOX_UNAVAILABLE', 'Durable pending storage is unavailable.', 503));
      }
    });
  }
  return {
    read(libraryId, operationId) {
      return transaction('readonly', (store, done) => { const request = store.get([libraryId, operationId]); request.onsuccess = () => done(request.result ?? null); });
    },
    list(libraryId) {
      return transaction('readonly', (store, done) => { const request = store.index('libraryId').getAll(libraryId); request.onsuccess = () => done(request.result); });
    },
    write(value, expectedVersion) {
      const entry = structuredClone(value);
      return transaction('readwrite', (store, done, abort) => {
        const request = store.get([entry.libraryId, entry.operationId]);
        request.onsuccess = () => {
          if ((request.result?.version ?? null) !== expectedVersion) {
            abort(new LibraryError('OUTBOX_CONFLICT', 'Another window changed this pending command.', 409)); return;
          }
          try { store.put(entry); done(entry); }
          catch { abort(new LibraryError('OUTBOX_WRITE_FAILED', 'Pending-command storage rejected the record.', 503)); }
        };
      });
    },
    async close() { const db = await connection; db?.close(); connection = undefined; },
  };
}
