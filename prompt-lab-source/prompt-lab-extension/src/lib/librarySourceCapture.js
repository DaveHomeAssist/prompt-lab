import { canonical, LibraryError, MAX_BYTES } from '../../../library-storage/contract.mjs';
import { captureSourceInventory, EXTENSION_DRAFT_KEYS, INDEXED_SOURCES } from '../../../library-storage/source-inventory.mjs';
import { libraryWriteCoordinator } from './libraryWriteCoordinator.js';
import { startAppCaptureParticipant } from './libraryOriginCapture.js';

const sourceError = code => new LibraryError(code, 'Source capture could not complete. Original data is unchanged.');
const encoder = new TextEncoder();

function checkTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw sourceError('INVALID_SOURCE');
}

// Do not call the ordinary store openers: they create/upgrade databases and
// their fallback readers can hide failures or normalize away unknown fields.
export function readExistingIndexedSource({ database, store }, { idb = globalThis.indexedDB, timeoutMs = 10_000 } = {}) {
  checkTimeout(timeoutMs);
  if (!INDEXED_SOURCES.some(source => source.database === database && source.store === store)) {
    return Promise.reject(sourceError('UNSELECTED_SOURCE'));
  }
  if (typeof idb?.databases !== 'function' || typeof idb?.open !== 'function') {
    return Promise.reject(sourceError('SOURCE_CAPABILITY_UNAVAILABLE'));
  }
  return new Promise((resolve, reject) => {
    let settled = false, db, transaction;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { try { transaction?.abort(); } catch { /* Already completed. */ } }
      db?.close();
      if (error) reject(error instanceof LibraryError ? error : sourceError('SOURCE_UNAVAILABLE'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(sourceError('SOURCE_TIMEOUT')), timeoutMs);
    Promise.resolve().then(() => idb.databases()).then(databases => {
      if (settled) return;
      if (!Array.isArray(databases)) throw sourceError('INVALID_SOURCE');
      const existing = databases.find(item => item.name === database);
      if (!existing) return finish(null, { state: 'absent', reason: 'Database absent from this origin at enumeration.' });
      if (!Number.isInteger(existing.version) || existing.version < 1) throw sourceError('INVALID_SOURCE');
      // No version argument: never request an upgrade. Deletion between the
      // listing and open would create a database, so abort that upgrade too.
      const request = idb.open(database);
      request.onupgradeneeded = () => {
        request.transaction.abort();
        finish(sourceError('SOURCE_CHANGED'));
      };
      request.onerror = () => finish(sourceError('SOURCE_UNAVAILABLE'));
      request.onblocked = () => finish(sourceError('SOURCE_BLOCKED'));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        db.onversionchange = () => finish(sourceError('SOURCE_CHANGED'));
        try {
          if (db.version !== existing.version) throw sourceError('SOURCE_CHANGED');
          if (!db.objectStoreNames.contains(store)) {
            return finish(null, { state: 'absent', reason: 'Object store absent from the existing database.', databaseVersion: db.version });
          }
          transaction = db.transaction(store, 'readonly');
          const objectStore = transaction.objectStore(store);
          const records = [], primaryKeys = [];
          const result = { state: 'present', databaseVersion: db.version, keyPath: objectStore.keyPath,
            autoIncrement: objectStore.autoIncrement, primaryKeys, records };
          let complete = false, bytes = encoder.encode(canonical(result)).length;
          const cursor = objectStore.openCursor();
          cursor.onerror = () => finish(sourceError('SOURCE_UNAVAILABLE'));
          cursor.onsuccess = () => {
            if (settled) return;
            try {
              const entry = cursor.result;
              if (!entry) { complete = true; return; }
              // Reject unsupported structured-clone values and capacity excess
              // explicitly. Never coerce, truncate or return a partial capture.
              bytes += encoder.encode(canonical(entry.value)).length + encoder.encode(canonical(entry.primaryKey)).length + 2;
              if (bytes > MAX_BYTES) throw sourceError('PAYLOAD_TOO_LARGE');
              records.push(entry.value);
              primaryKeys.push(entry.primaryKey);
              entry.continue();
            } catch (error) { finish(error); }
          };
          transaction.oncomplete = () => complete ? finish(null, result) : finish(sourceError('SOURCE_INCOMPLETE'));
          transaction.onabort = () => finish(sourceError('SOURCE_ABORTED'));
          transaction.onerror = () => finish(sourceError('SOURCE_UNAVAILABLE'));
        } catch (error) { finish(error); }
      };
    }).catch(error => finish(error));
  });
}

export function readExtensionLibraryDrafts(keys, { chromeApi = globalThis.chrome, timeoutMs = 10_000 } = {}) {
  checkTimeout(timeoutMs);
  if (!Array.isArray(keys) || canonical([...keys].sort()) !== canonical([...EXTENSION_DRAFT_KEYS].sort())) {
    return Promise.reject(sourceError('UNSELECTED_SOURCE'));
  }
  if (typeof chromeApi?.storage?.session?.get !== 'function') return Promise.reject(sourceError('SOURCE_CAPABILITY_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error instanceof LibraryError ? error : sourceError('SOURCE_UNAVAILABLE'));
      else resolve(result);
    };
    const timer = setTimeout(() => finish(sourceError('SOURCE_TIMEOUT')), timeoutMs);
    try {
      chromeApi.storage.session.get([...EXTENSION_DRAFT_KEYS], result => {
        // runtime.lastError is valid only during this callback. Its message
        // may contain private data, so retain only our stable error code.
        const failed = Boolean(chromeApi.runtime?.lastError);
        if (settled) return;
        try {
          if (failed) throw sourceError('SOURCE_UNAVAILABLE');
          if (!result || Object.getPrototypeOf(result) !== Object.prototype
            || Object.keys(result).some(key => !EXTENSION_DRAFT_KEYS.includes(key))) throw sourceError('INVALID_SOURCE');
          const entries = Object.fromEntries(EXTENSION_DRAFT_KEYS.map(key => [key, Object.hasOwn(result, key) ? result[key] : null]));
          canonical(entries);
          finish(null, entries);
        } catch (error) { finish(error); }
      });
    } catch (error) { finish(error); }
  });
}

// Explicit read-only app entry point. Merely importing it has no side effects.
// A future migration flow must separately stop writers and verify destination
// parity before activation; this capture cannot establish that barrier.
export function captureAppLibrarySources({ sourceIdentity, archives, capturedAt, clientBuffers, timeoutMs = 10_000 }, environment = globalThis) {
  checkTimeout(timeoutMs);
  const surface = typeof environment.chrome?.runtime?.sendMessage === 'function' ? 'extension'
    : environment.window?.__TAURI_INTERNALS__ ? 'desktop' : 'web';
  return captureSourceInventory({
    surface, sourceIdentity, archives, capturedAt, clientBuffers,
    // Access lazily so denied localStorage is captured as unavailable while
    // independent source families can still be inventoried.
    localStorage: {
      get length() { return environment.localStorage.length; },
      key: index => environment.localStorage.key(index),
      getItem: key => environment.localStorage.getItem(key),
    },
    readIndexedStore: descriptor => readExistingIndexedSource(descriptor, { idb: environment.indexedDB, timeoutMs }),
    readExtensionDrafts: keys => readExtensionLibraryDrafts(keys, { chromeApi: environment.chrome, timeoutMs }),
  });
}

// An explicit intermediate step for the migration flow. Other contexts and
// unsaved UI buffers still require ownership/flush gates before activation.
export async function captureAppLibrarySourcesWithLocalDrain(options) {
  const { value: inventory, coordination } = await libraryWriteCoordinator.withPausedWrites(async () => {
    const result = await captureAppLibrarySources(options);
    if (!result.manifest.sourceReadComplete) throw sourceError('SOURCE_INCOMPLETE');
    return result;
  }, { timeoutMs: options.drainTimeoutMs ?? 30_000 });
  return { inventory, coordination };
}

export async function captureAppLibrarySourcesWithOriginDrain(options) {
  const participant = await startAppCaptureParticipant();
  if (!participant) throw sourceError('SOURCE_CAPABILITY_UNAVAILABLE');
  const { value: inventory, coordination } = await participant.capture(async ({ clientBuffers }) => {
    const result = await captureAppLibrarySources({ ...options, clientBuffers });
    if (!result.manifest.sourceReadComplete) throw sourceError('SOURCE_INCOMPLETE');
    return result;
  }, { timeoutMs: options.drainTimeoutMs ?? 30_000 });
  return { inventory, coordination };
}
