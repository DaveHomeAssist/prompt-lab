import { canonical, hash, LibraryError, makeObject } from '../../../library-storage/contract.mjs';
import { createCommandOutbox, normalizeCommandRequest } from '../../../library-storage/command-outbox.mjs';
import { inspectSourceInventory, COORDINATED_INVENTORY_VERSION } from '../../../library-storage/source-inventory.mjs';
import { inspectSourceBinding } from '../../../library-storage/source-binding.mjs';
import { inspectTransfer } from '../../../library-storage/transfer.mjs';
import { captureAppLibrarySourcesWithOriginDrain } from './librarySourceCapture.js';
import { createIndexedCommandStore } from './libraryCommandOutbox.js';
import { hasSessionRecoveryCapture } from './draftRecoveryCapture.js';

export const MIGRATION_DATABASE = 'prompt_lab_library_migrations';
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

// Derive the import's prompt/trash arrays from the same raw capture. The other
// stores remain in the bound inventory, without normalization or replica union.
export async function migrationWorkspace(inventory) {
  const inspected = await inspectSourceInventory(inventory);
  const clients = inspected.captures['client-buffers']?.records;
  if (inspected.manifest.schemaVersion !== COORDINATED_INVENTORY_VERSION
    || !inspected.manifest.sourceReadComplete || !Array.isArray(clients)
    || !clients.length || !clients.every(hasSessionRecoveryCapture)) {
    fail('SOURCE_INCOMPLETE', 'Capture every source and open editor before copying the library.');
  }
  const entries = inspected.captures['local-content'].entries;
  const rows = key => {
    let value;
    try { value = entries[key] === null ? [] : JSON.parse(entries[key]); }
    catch { fail('INVALID_SOURCE', 'A captured prompt list needs recovery before migration.'); }
    if (!Array.isArray(value)) fail('INVALID_SOURCE', 'A captured prompt list needs recovery before migration.');
    return value;
  };
  return { library: rows('pl2-library'), trash: rows('pl2-library-trash') };
}

async function inspectBackup(value, libraryId, operationId) {
  if (!value || value.format !== 'promptlab-app-migration' || value.schemaVersion !== 1
    || value.libraryId !== libraryId || value.operationId !== operationId || value.version !== 1
    || Object.keys(value).some(key => !['format', 'schemaVersion', 'version', 'libraryId', 'operationId',
      'baseRevision', 'sourceText', 'sourceInventory', 'coordination', 'recordHash'].includes(key))) {
    fail('MIGRATION_BACKUP_INVALID', 'The migration backup needs recovery. Keep the original app data.');
  }
  const { recordHash, ...record } = value;
  if (recordHash !== await hash(record)) fail('MIGRATION_BACKUP_INVALID', 'The migration backup failed its integrity check.');
  const workspace = await migrationWorkspace(value.sourceInventory);
  if (canonical(workspace) !== value.sourceText) fail('MIGRATION_BACKUP_INVALID', 'The backup and captured prompt lists differ.');
  const clients = value.sourceInventory.objects[value.sourceInventory.manifest.sources.find(row => row.id === 'client-buffers').hash].data.records;
  if (value.coordination?.scope !== 'cooperating-origin-clients' || value.coordination.protocolVersion !== 1
    || value.coordination.activationReady !== false
    || Object.keys(value.coordination).some(key => !['scope', 'protocolVersion', 'activationReady', 'clientIds'].includes(key))
    || canonical(value.coordination.clientIds) !== canonical(clients.map(row => row.clientId).sort())) {
    fail('MIGRATION_BACKUP_INVALID', 'The backup does not account for every participating editor.');
  }
  normalizeCommandRequest({ mode: 'import', libraryId, expectedRevision: value.baseRevision,
    sourceText: value.sourceText, sourceInventory: value.sourceInventory });
  return structuredClone(value);
}

/** App-owned capture, recoverable copy and readback. No activation side effects. */
export function createAppLibraryMigration({ transport,
  backups = createIndexedCommandStore({ database: MIGRATION_DATABASE }),
  outbox = createCommandOutbox(createIndexedCommandStore()),
  capture = captureAppLibrarySourcesWithOriginDrain,
} = {}) {
  if (!transport || ['identity', 'preview', 'apply', 'operation', 'transfer'].some(name => typeof transport[name] !== 'function')) {
    throw new TypeError('A selected library service with complete readback is required.');
  }
  async function read(libraryId, operationId) {
    if (!id(libraryId) || !id(operationId)) fail('INVALID_IDENTITY', 'Select a library and migration operation.');
    const backup = await backups.read(libraryId, operationId);
    if (!backup) fail('MIGRATION_BACKUP_MISSING', 'The migration backup is unavailable. Keep the original app data.');
    return inspectBackup(backup, libraryId, operationId);
  }
  const requestFor = (backup, resolutions = {}) => normalizeCommandRequest({ mode: 'import', libraryId: backup.libraryId,
    expectedRevision: backup.baseRevision, sourceText: backup.sourceText, sourceInventory: backup.sourceInventory, resolutions });

  async function verify(backup, committed) {
    const identity = await transport.identity();
    if (identity.libraryId !== backup.libraryId) fail('WRONG_LIBRARY', 'Reconnect to the selected library before verification.');
    // Read the current complete graph: a newer commit may follow our copy.
    // Verify the retained operation, never silently rerun it against that head.
    const transferred = await inspectTransfer(await transport.transfer(identity.revision));
    if (transferred.libraryId !== backup.libraryId || transferred.revision !== identity.revision
      || canonical(transferred.state.operations[backup.operationId] ?? null) !== canonical(committed.receipt)) {
      fail('MIGRATION_READBACK_FAILED', 'The copied operation could not be verified. The source backup is retained.');
    }
    const binding = await inspectSourceBinding(transferred.state.objects, committed.receipt.sourceBinding);
    const source = await makeObject('source', backup.sourceText);
    if (binding.binding.source !== source.hash || canonical(binding.inventory) !== canonical(backup.sourceInventory)) {
      fail('MIGRATION_READBACK_FAILED', 'The destination does not contain the exact captured source.');
    }
    // inspectSourceBinding hashes every capture and validates the raw workspace
    // binding. Exact capture equality covers IDs, order, references and history.
    return { format: 'promptlab-migration-copy-verification', schemaVersion: 1,
      libraryId: backup.libraryId, operationId: backup.operationId, backupHash: backup.recordHash,
      copiedRevision: committed.receipt.revision, verifiedRevision: transferred.revision,
      sourceHash: source.hash, sourceInventoryHash: backup.sourceInventory.manifestHash,
      sourceBinding: committed.receipt.sourceBinding,
      captureObjectsVerified: Object.keys(backup.sourceInventory.objects).length,
      sourceReadbackVerified: true, activationReady: false };
  }
  return {
    read,
    async prepare({ libraryId, operationId, sourceIdentity, archives, drainTimeoutMs, timeoutMs }) {
      if (!id(libraryId) || !id(operationId) || !id(sourceIdentity)) fail('INVALID_IDENTITY', 'Select a library, migration operation and source.');
      if (await backups.read(libraryId, operationId)) fail('MIGRATION_EXISTS', 'Resume the retained migration or start a new operation.');
      const identity = await transport.identity();
      if (identity.libraryId !== libraryId) fail('WRONG_LIBRARY', 'The selected service belongs to another library.');
      const { inventory, coordination } = structuredClone(await capture({ sourceIdentity,
        archives: archives === undefined ? undefined : structuredClone(archives), drainTimeoutMs, timeoutMs }));
      if (inventory?.manifest?.sourceIdentity !== sourceIdentity) fail('SOURCE_BINDING_MISMATCH', 'The capture belongs to another source.');
      const sourceText = canonical(await migrationWorkspace(inventory));
      const record = { format: 'promptlab-app-migration', schemaVersion: 1, version: 1,
        libraryId, operationId, baseRevision: identity.revision, sourceText, sourceInventory: inventory, coordination };
      const backup = { ...record, recordHash: await hash(record) };
      await inspectBackup(backup, libraryId, operationId);
      try { await backups.write(backup, null); }
      catch {
        throw new LibraryError('MIGRATION_BACKUP_FAILED', 'The source backup could not be saved. Your current library is unchanged. Retry before copying.', 503);
      }
      const retained = await read(libraryId, operationId);
      if (retained.recordHash !== backup.recordHash) fail('MIGRATION_BACKUP_INVALID', 'The saved migration backup differs from the captured source.');
      return { libraryId, operationId, backupHash: retained.recordHash,
        capturedAt: inventory.manifest.capturedAt, sourceIdentity, activationReady: false };
    },
    async review({ libraryId, operationId, resolutions }) {
      const backup = await read(libraryId, operationId);
      // Initial migration preserves the existing catalog, including deliberate
      // duplicate IDs, titles and bodies. Use source occurrences, not ID aliases.
      if (resolutions === undefined && backup.baseRevision === null) {
        const workspace = JSON.parse(backup.sourceText), object = await makeObject('workspace', workspace);
        resolutions = Object.fromEntries(workspace.library.map((_, index) => [JSON.stringify([object.hash, 'library', index]), { action: 'keep' }]));
      }
      const request = requestFor(backup, resolutions);
      const review = await transport.preview(request);
      return { backupHash: backup.recordHash, request, review };
    },
    async copy({ libraryId, operationId, reviewed }) {
      const backup = await read(libraryId, operationId);
      if (reviewed?.backupHash !== backup.recordHash
        || canonical(reviewed.request) !== canonical(requestFor(backup, reviewed.request?.resolutions))) {
        fail('REVIEW_CHANGED', 'Review the retained migration source before copying it.');
      }
      await outbox.enqueue({ request: reviewed.request, review: reviewed.review, operationId });
      const committed = await outbox.replay(libraryId, operationId, transport);
      return verify(backup, committed);
    },
    async resume({ libraryId, operationId }) {
      const backup = await read(libraryId, operationId);
      const queued = await outbox.read(libraryId, operationId);
      if (!queued || canonical(queued.request) !== canonical(requestFor(backup, queued.request.resolutions))) {
        fail('MIGRATION_NOT_QUEUED', 'Review the retained source before resuming its copy.');
      }
      return verify(backup, await outbox.replay(libraryId, operationId, transport));
    },
  };
}
