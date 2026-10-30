import { canonical, hash, LibraryError } from './contract.mjs';
import { normalizeLifecycleRequest } from './lifecycle-request.mjs';
import { normalizeFolderRequest } from './folder-request.mjs';
import { normalizePackRequest } from './pack-request.mjs';
import { normalizeRecordRequest } from './record-request.mjs';
import { normalizeCreateRequest } from './create-request.mjs';
import { normalizeEditRequest } from './edit-request.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
const intentModes = new Set(['record', 'create', 'edit', 'lifecycle', 'folder', 'pack']);
const modes = ['snapshot', 'import', 'select', 'restore', 'reconcile', 'edit', 'create', 'lifecycle', 'record', 'folder', 'pack'];

export function normalizeCommandRequest(value) {
  if (!object(value) || !modes.includes(value.mode) || !id(value.libraryId)
    || (value.expectedRevision !== null && !address(value.expectedRevision))) fail('INVALID_COMMAND', 'A library, base revision and supported command are required.');
  canonical(value);
  const request = structuredClone(value), mode = request.mode;
  if (mode === 'pack') {
    const { mode: operation, ...input } = request;
    return { ...normalizePackRequest(input), mode: operation };
  }
  if (mode === 'folder') {
    const { mode: operation, ...input } = request;
    return { ...normalizeFolderRequest(input), mode: operation };
  }
  if (mode === 'record') {
    const { mode: operation, ...input } = request;
    return { ...normalizeRecordRequest(input), mode: operation };
  }
  if (mode === 'lifecycle') {
    const { mode: operation, ...input } = request;
    return { ...normalizeLifecycleRequest(input), mode: operation };
  }
  if (mode === 'create') {
    const { mode: operation, ...input } = request;
    return { ...normalizeCreateRequest(input), mode: operation };
  }
  if (mode === 'edit') {
    const { mode: operation, ...input } = request;
    return { ...normalizeEditRequest(input), mode: operation };
  }
  const allowed = ['mode', 'libraryId', 'expectedRevision', ...(mode === 'restore' ? ['checkpointId']
    : mode === 'reconcile' ? ['incoming', 'resolutions'] : mode === 'select' ? ['resolutions'] : ['sourceText', 'sourceInventory', 'resolutions'])];
  if (Object.keys(request).some(key => !allowed.includes(key))) fail('INVALID_COMMAND', 'Unknown command options cannot enter the outbox.');
  if (mode !== 'restore') {
    request.resolutions ??= {};
    if (!object(request.resolutions)) fail('INVALID_COMMAND', 'Command choices must be an object.');
  }
  if (['snapshot', 'import'].includes(mode) && typeof request.sourceText !== 'string') fail('INVALID_COMMAND', 'Complete source text is required.');
  if (mode === 'restore' && !address(request.checkpointId)) fail('INVALID_COMMAND', 'A checkpoint address is required.');
  if (mode === 'reconcile' && !address(request.incoming?.manifestHash)) fail('INVALID_COMMAND', 'A complete incoming transfer is required.');
  return request;
}

export async function commandFingerprint(value) {
  const request = normalizeCommandRequest(value);
  if (request.mode === 'reconcile') {
    const { inspectTransfer } = await import('./transfer.mjs');
    const incoming = await inspectTransfer(request.incoming);
    if (incoming.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'The incoming branch belongs to another library.');
    delete request.incoming;
    request.incomingManifestHash = incoming.manifestHash;
  }
  return hash(request);
}

export async function commandReviewHash(review) {
  if (!object(review) || review.commitAvailable !== true || !address(review.fingerprint) || !address(review.sourceHash)) {
    fail('REVIEW_REQUIRED', 'A complete committable review is required before queuing.');
  }
  const stable = structuredClone(review);
  delete stable.previewId; delete stable.expiresAt;
  return hash(stable);
}

const envelope = entry => ({ libraryId: entry.libraryId, baseRevision: entry.baseRevision, operationId: entry.operationId,
  request: entry.request, fingerprint: entry.fingerprint, reviewHash: entry.reviewHash, sourceHash: entry.sourceHash });
async function seal(entry) {
  const next = structuredClone(entry); delete next.recordHash;
  return { ...next, recordHash: await hash(next) };
}

function checkReceipt(receipt, entry) {
  if (!object(receipt) || receipt.operationId !== entry.operationId || receipt.libraryId !== entry.libraryId
    || receipt.parentRevision !== entry.baseRevision || receipt.checkpointId !== entry.baseRevision
    || receipt.fingerprint !== entry.fingerprint || receipt.sourceHash !== entry.sourceHash
    || receipt.operation !== entry.request.mode || !address(receipt.revision) || !address(receipt.stateHash)
    || receipt.state !== 'committed' || receipt.verified !== true) fail('RECEIPT_MISMATCH', 'Operation receipt does not match the queued command.');
  canonical(receipt);
}

export async function inspectOutboxEntry(value) {
  const entry = structuredClone(value);
  if (!object(entry) || entry.format !== 'promptlab-command-outbox' || ![2, 3].includes(entry.schemaVersion)
    || !id(entry.libraryId) || !id(entry.operationId) || !Number.isSafeInteger(entry.version) || entry.version < 1
    || !['awaiting-review', 'pending', 'failed', 'committed'].includes(entry.state) || !Number.isFinite(Date.parse(entry.createdAt))) {
    fail('INVALID_OUTBOX', 'Pending-command storage requires recovery; preserve it without replaying.');
  }
  const { recordHash, ...record } = entry;
  if (recordHash !== await hash(record) || entry.commandHash !== await hash(envelope(entry))) fail('OUTBOX_CORRUPT', 'Pending-command integrity check failed.');
  const request = normalizeCommandRequest(entry.request);
  if (entry.schemaVersion === 3 && !intentModes.has(request.mode)) fail('OUTBOX_CORRUPT', 'A retained app intent must be an explicit record, prompt, folder or pack command.');
  const unreviewed = entry.schemaVersion === 3 && intentModes.has(request.mode) && entry.reviewHash === null && entry.sourceHash === null
    && ['awaiting-review', 'failed'].includes(entry.state);
  if (request.libraryId !== entry.libraryId || request.expectedRevision !== entry.baseRevision
    || entry.fingerprint !== await commandFingerprint(request)
    || (!unreviewed && (entry.state === 'awaiting-review' || !address(entry.reviewHash) || !address(entry.sourceHash)))) fail('OUTBOX_CORRUPT', 'Pending-command identity or input differs.');
  if (entry.state === 'committed') checkReceipt(entry.receipt, entry);
  else if (entry.receipt !== null) fail('OUTBOX_CORRUPT', 'A pending command cannot claim a committed receipt.');
  return entry;
}

/** Store methods use atomic compare-and-swap; there is no memory fallback. */
export function createCommandOutbox(store, { now = () => Date.now() } = {}) {
  const active = new Map();
  async function read(libraryId, operationId) {
    if (!id(libraryId) || !id(operationId)) fail('INVALID_COMMAND', 'Library and operation identity are required.');
    const value = await store.read(libraryId, operationId);
    if (value === null) return null;
    const entry = await inspectOutboxEntry(value);
    if (entry.libraryId !== libraryId || entry.operationId !== operationId) fail('WRONG_LIBRARY', 'Outbox storage returned another command.');
    return entry;
  }
  async function update(original, patch) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await read(original.libraryId, original.operationId);
      if (!current || current.commandHash !== original.commandHash) fail('OUTBOX_CHANGED', 'The retained command changed; review is required.');
      if (current.state === 'committed') {
        if (patch.receipt && canonical(patch.receipt) !== canonical(current.receipt)) fail('RECEIPT_MISMATCH', 'Conflicting operation receipts require recovery.');
        return current;
      }
      const next = await seal({ ...current, ...patch, version: current.version + 1 });
      try { await store.write(next, current.version); return next; }
      catch (error) { if (error.code !== 'OUTBOX_CONFLICT') throw error; }
    }
    fail('OUTBOX_BUSY', 'Another window is updating this pending command.');
  }
  async function retainReview(original, review) {
    if (review?.libraryId !== original.libraryId || review.expectedRevision !== original.baseRevision || review.mode !== original.request.mode
      || review.fingerprint !== original.fingerprint || !Number.isFinite(review.expiresAt) || review.expiresAt <= now()) {
      fail('REVIEW_CHANGED', 'The retained edit needs a current review for its original input.');
    }
    const reviewHash = await commandReviewHash(review), sourceHash = review.sourceHash;
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await read(original.libraryId, original.operationId);
      if (!current || current.fingerprint !== original.fingerprint || current.baseRevision !== original.baseRevision) {
        fail('OUTBOX_CHANGED', 'The retained edit changed before review.');
      }
      if (current.reviewHash !== null) {
        if (current.reviewHash !== reviewHash || current.sourceHash !== sourceHash) fail('REVIEW_CHANGED', 'Another window retained a different review.');
        return current;
      }
      const next = { ...current, reviewHash, sourceHash, state: 'pending', lastError: null, version: current.version + 1 };
      next.commandHash = await hash(envelope(next));
      const sealed = await seal(next);
      if (review.expiresAt <= now()) fail('REVIEW_REQUIRED', 'The review expired before it could be stored.');
      try { await store.write(sealed, current.version); return sealed; }
      catch (error) { if (error.code !== 'OUTBOX_CONFLICT') throw error; }
    }
    fail('OUTBOX_BUSY', 'Another window is reviewing this retained edit.');
  }
  async function replay(libraryId, operationId, transport) {
    let entry = await read(libraryId, operationId);
    if (!entry) fail('OUTBOX_NOT_FOUND', 'The pending command is unavailable.');
    if (entry.state === 'committed') return entry;
    try {
      const identity = await transport.identity();
      if (identity.libraryId !== entry.libraryId) fail('WRONG_LIBRARY', 'Reconnect to the library that owns this pending command.');
      if (entry.reviewHash === null) {
        // Another window may have reviewed or committed this same intent while
        // identity was in flight. Read its durable proof before trusting a receipt.
        const current = await read(libraryId, operationId);
        if (!current || current.fingerprint !== entry.fingerprint || current.baseRevision !== entry.baseRevision) fail('OUTBOX_CHANGED', 'The retained edit changed.');
        entry = current;
        if (entry.reviewHash === null) {
          if (identity.revision !== entry.baseRevision) fail('REVISION_CONFLICT', 'The library changed. Keep the offline edit and review the conflict.');
          entry = await retainReview(entry, await transport.preview(structuredClone(entry.request)));
        }
        if (entry.state === 'committed') return entry;
      }
      let receipt = await transport.operation(entry.operationId);
      if (!receipt) {
        if (identity.revision !== entry.baseRevision) fail('REVISION_CONFLICT', 'The library changed. Keep the pending command and review the conflict.');
        const review = await transport.preview(structuredClone(entry.request));
        if (review.libraryId !== entry.libraryId || review.expectedRevision !== entry.baseRevision
          || review.fingerprint !== entry.fingerprint || await commandReviewHash(review) !== entry.reviewHash) {
          fail('REVIEW_CHANGED', 'The command review changed. Keep the original and review again.');
        }
        receipt = await transport.apply({ previewId: review.previewId, libraryId, expectedRevision: entry.baseRevision,
          fingerprint: entry.fingerprint, idempotencyKey: entry.operationId });
      }
      checkReceipt(receipt, entry);
      // No committed acknowledgement until the receipt is durably stored too.
      return await update(entry, { state: 'committed', receipt, lastError: null });
    } catch (error) {
      const code = typeof error.code === 'string' && /^[A-Z_]{1,64}$/.test(error.code) ? error.code : 'SERVICE_UNAVAILABLE';
      try { await update(entry, { state: 'failed', lastError: { code } }); }
      catch { /* The original durable command remains pending if status storage fails. */ }
      throw error;
    }
  }
  return {
    read,
    async stage({ request: value, operationId }) {
      const request = normalizeCommandRequest(value);
      if (!intentModes.has(request.mode) || !id(operationId)) fail('REVIEW_REQUIRED', 'Only explicit record, prompt, folder and pack commands may be retained before service review.');
      const entry = { format: 'promptlab-command-outbox', schemaVersion: 3, libraryId: request.libraryId,
        baseRevision: request.expectedRevision, operationId, request, fingerprint: await commandFingerprint(request),
        reviewHash: null, sourceHash: null, createdAt: new Date(now()).toISOString(), version: 1,
        state: 'awaiting-review', receipt: null, lastError: null };
      entry.commandHash = await hash(envelope(entry));
      const sealed = await seal(entry);
      try { await store.write(sealed, null); return sealed; }
      catch (error) {
        if (error.code !== 'OUTBOX_CONFLICT') throw error;
        const current = await read(entry.libraryId, operationId);
        if (!current || current.fingerprint !== entry.fingerprint || current.baseRevision !== entry.baseRevision) {
          fail('IDEMPOTENCY_CONFLICT', 'This operation already names a different retained edit.');
        }
        return current;
      }
    },
    async list(libraryId) {
      if (!id(libraryId)) fail('INVALID_COMMAND', 'Select the pending command library.');
      const rows = await store.list(libraryId), result = [];
      for (const row of rows) {
        const entry = await inspectOutboxEntry(row);
        if (entry.libraryId !== libraryId) fail('WRONG_LIBRARY', 'Outbox storage returned another library.');
        result.push(entry);
      }
      return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId));
    },
    async enqueue({ request: value, review: valueReview, operationId }) {
      const request = normalizeCommandRequest(value), review = structuredClone(valueReview);
      if (!id(operationId) || review?.libraryId !== request.libraryId || review.expectedRevision !== request.expectedRevision
        || review.mode !== request.mode || !Number.isFinite(review.expiresAt) || review.expiresAt <= now()) fail('REVIEW_REQUIRED', 'Queue the exact current reviewed command.');
      const fingerprint = await commandFingerprint(request), reviewHash = await commandReviewHash(review);
      if (fingerprint !== review.fingerprint) fail('REVIEW_CHANGED', 'The command input differs from its review.');
      const entry = { format: 'promptlab-command-outbox', schemaVersion: 2, libraryId: request.libraryId,
        baseRevision: request.expectedRevision, operationId, request, fingerprint, reviewHash, sourceHash: review.sourceHash,
        createdAt: new Date(now()).toISOString(), version: 1, state: 'pending', receipt: null, lastError: null };
      entry.commandHash = await hash(envelope(entry));
      const sealed = await seal(entry);
      if (review.expiresAt <= now()) fail('REVIEW_REQUIRED', 'The review expired before the pending command could be stored.');
      try { await store.write(sealed, null); return sealed; }
      catch (error) {
        if (error.code !== 'OUTBOX_CONFLICT') throw error;
        const existing = await read(entry.libraryId, operationId);
        if (!existing || existing.commandHash !== entry.commandHash) fail('IDEMPOTENCY_CONFLICT', 'This operation identity already names different input.');
        return existing;
      }
    },
    replay(libraryId, operationId, transport) {
      const key = canonical([libraryId, operationId]);
      if (active.has(key)) return active.get(key);
      const promise = replay(libraryId, operationId, transport).finally(() => active.delete(key));
      active.set(key, promise); return promise;
    },
  };
}
