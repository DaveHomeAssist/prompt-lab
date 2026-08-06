import { storageKeys } from './storage.js';
import { buildNativeLibraryExport } from './libraryExport.js';

export const LIBRARY_ENVELOPE_SCHEMA_VERSION = 1;

export class LibraryRepositoryError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'LibraryRepositoryError';
    this.code = code;
    this.cause = cause;
  }
}

function parseJson(raw, label) {
  try {
    return raw == null ? null : JSON.parse(raw);
  } catch (error) {
    throw new LibraryRepositoryError('malformed', `${label} contains malformed JSON.`, error);
  }
}

function validateEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LibraryRepositoryError('malformed', 'Library storage envelope is invalid.');
  }
  if (value.schemaVersion !== LIBRARY_ENVELOPE_SCHEMA_VERSION) {
    throw new LibraryRepositoryError('unsupported-schema', `Library schema version ${value.schemaVersion ?? 'unknown'} is not supported.`);
  }
  if (!Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.records) || !Array.isArray(value.collections)) {
    throw new LibraryRepositoryError('malformed', 'Library storage envelope is incomplete.');
  }
  return value;
}

function makeEnvelope({ records, collections, revision, savedAt = new Date().toISOString(), deviceId = 'local' }) {
  return {
    schemaVersion: LIBRARY_ENVELOPE_SCHEMA_VERSION,
    revision,
    savedAt,
    deviceId,
    records: Array.isArray(records) ? records : [],
    collections: Array.isArray(collections) ? collections : [],
  };
}

function storageMessage(error) {
  if (error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message || ''))) {
    return 'Local storage is full. Export or remove data, then retry.';
  }
  return 'Local storage is unavailable. Library changes were not saved.';
}

export function createLocalLibraryRepository({
  storage = globalThis.localStorage,
  eventTarget = globalThis.window,
  now = () => new Date().toISOString(),
  deviceId = 'local',
} = {}) {
  if (!storage) throw new LibraryRepositoryError('unavailable', 'Local storage is unavailable.');

  const readEnvelope = () => {
    const raw = storage.getItem(storageKeys.libraryEnvelope);
    return raw == null ? null : validateEnvelope(parseJson(raw, 'Library storage'));
  };

  const writeRaw = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      throw new LibraryRepositoryError('storage-failed', storageMessage(error), error);
    }
  };

  const backup = (reason = 'manual') => {
    let envelope = null;
    try {
      envelope = readEnvelope();
    } catch {
      // A malformed envelope is preserved separately by load().
    }
    if (!envelope) {
      const legacyRecords = parseJson(storage.getItem(storageKeys.library), 'Legacy library');
      const legacyCollections = parseJson(storage.getItem(storageKeys.collections), 'Legacy collections');
      envelope = makeEnvelope({
        records: Array.isArray(legacyRecords) ? legacyRecords : [],
        collections: Array.isArray(legacyCollections) ? legacyCollections : [],
        revision: 0,
        savedAt: now(),
        deviceId,
      });
    }
    const snapshot = { backedUpAt: now(), reason, envelope };
    writeRaw(storageKeys.libraryBackup, snapshot);
    return snapshot;
  };

  const save = ({ records = [], collections = [] } = {}, { expectedRevision = null, backupReason = '' } = {}) => {
    const current = readEnvelope();
    const currentRevision = current?.revision || 0;
    if (expectedRevision != null && currentRevision > expectedRevision) {
      throw new LibraryRepositoryError(
        'revision-conflict',
        `A newer library revision (${currentRevision}) exists. Reload before saving revision ${expectedRevision}.`,
      );
    }
    if (backupReason) backup(backupReason);

    const envelope = makeEnvelope({
      records,
      collections,
      revision: currentRevision + 1,
      savedAt: now(),
      deviceId,
    });
    writeRaw(storageKeys.libraryEnvelope, envelope);

    const warnings = [];
    try { storage.setItem(storageKeys.library, JSON.stringify(envelope.records)); } catch (error) { warnings.push(storageMessage(error)); }
    try { storage.setItem(storageKeys.collections, JSON.stringify(envelope.collections)); } catch (error) { warnings.push(storageMessage(error)); }
    return { envelope, warnings };
  };

  const load = () => {
    try {
      const envelope = readEnvelope();
      if (envelope) return { envelope, migrated: false, warning: '', hasStoredData: true };
    } catch (error) {
      const raw = storage.getItem(storageKeys.libraryEnvelope);
      try { writeRaw(storageKeys.libraryCorruptBackup, { capturedAt: now(), raw }); } catch { /* Preserve best effort only. */ }
      let backupSnapshot = null;
      try { backupSnapshot = parseJson(storage.getItem(storageKeys.libraryBackup), 'Library backup'); } catch { backupSnapshot = null; }
      if (backupSnapshot?.envelope) {
        return {
          envelope: validateEnvelope(backupSnapshot.envelope),
          migrated: false,
          warning: `${error.message} A valid backup is available for recovery.`,
          recoveryAvailable: true,
          hasStoredData: true,
        };
      }
      let mirroredRecords = null;
      let mirroredCollections = null;
      try {
        mirroredRecords = parseJson(storage.getItem(storageKeys.library), 'Legacy library');
        mirroredCollections = parseJson(storage.getItem(storageKeys.collections), 'Legacy collections');
      } catch { /* Fall through to an empty recovery state. */ }
      if (Array.isArray(mirroredRecords)) {
        const mirroredEnvelope = makeEnvelope({
          records: mirroredRecords,
          collections: Array.isArray(mirroredCollections) ? mirroredCollections : [],
          revision: 0,
          savedAt: now(),
          deviceId,
        });
        try { writeRaw(storageKeys.libraryBackup, { backedUpAt: now(), reason: 'corrupt-envelope-mirror', envelope: mirroredEnvelope }); } catch { /* Best effort. */ }
        return {
          envelope: mirroredEnvelope,
          migrated: false,
          warning: `${error.message} The compatibility mirror is available for recovery.`,
          recoveryAvailable: true,
          hasStoredData: true,
        };
      }
      return {
        envelope: makeEnvelope({ records: [], collections: [], revision: 0, savedAt: now(), deviceId }),
        migrated: false,
        warning: error.message,
        recoveryAvailable: false,
        hasStoredData: false,
      };
    }

    let legacyRecords = null;
    let legacyCollections = null;
    try {
      legacyRecords = parseJson(storage.getItem(storageKeys.library), 'Legacy library');
      legacyCollections = parseJson(storage.getItem(storageKeys.collections), 'Legacy collections');
    } catch (error) {
      return {
        envelope: makeEnvelope({ records: [], collections: [], revision: 0, savedAt: now(), deviceId }),
        migrated: false,
        warning: error.message,
        recoveryAvailable: false,
        hasStoredData: false,
      };
    }

    const hasLegacyData = Array.isArray(legacyRecords) || Array.isArray(legacyCollections);
    const envelope = makeEnvelope({
      records: Array.isArray(legacyRecords) ? legacyRecords : [],
      collections: Array.isArray(legacyCollections) ? legacyCollections : [],
      revision: 0,
      savedAt: now(),
      deviceId,
    });
    if (!hasLegacyData) return { envelope, migrated: false, warning: '', hasStoredData: false };

    backup('pre-envelope-migration');
    const persisted = save(envelope, { expectedRevision: 0 });
    return { envelope: persisted.envelope, migrated: true, warning: '', hasStoredData: true };
  };

  const subscribe = (listener) => {
    if (!eventTarget?.addEventListener || typeof listener !== 'function') return () => {};
    const onStorage = (event) => {
      if (event.key !== storageKeys.libraryEnvelope || !event.newValue) return;
      try {
        listener(validateEnvelope(parseJson(event.newValue, 'Library storage')));
      } catch (error) {
        listener(null, error);
      }
    };
    eventTarget.addEventListener('storage', onStorage);
    return () => eventTarget.removeEventListener('storage', onStorage);
  };

  const recoverBackup = () => {
    const snapshot = parseJson(storage.getItem(storageKeys.libraryBackup), 'Library backup');
    if (!snapshot?.envelope) throw new LibraryRepositoryError('backup-missing', 'No valid library backup is available.');
    const backupEnvelope = validateEnvelope(snapshot.envelope);
    const current = (() => { try { return readEnvelope(); } catch { return null; } })();
    if (!current) storage.removeItem(storageKeys.libraryEnvelope);
    return save(
      { records: backupEnvelope.records, collections: backupEnvelope.collections },
      { expectedRevision: current?.revision || 0 },
    );
  };

  return {
    load,
    save,
    subscribe,
    backup,
    export: ({ records = [], collections = [], ...options } = {}) => buildNativeLibraryExport({ library: records, collections, ...options }),
    import: (snapshot, options = {}) => save(snapshot, { ...options, backupReason: options.backupReason || 'pre-import' }),
    recoverBackup,
  };
}
