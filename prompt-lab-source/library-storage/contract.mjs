// This module does not normalize UI records. The archive is the preservation boundary.
export const FORMAT = 'promptlab-library-package';
export const VERSION = 1;
export const MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const forbidden = new Set(['settings', 'providersettings', 'credentials', 'tokens', 'token', 'apikeys', 'apikey', 'billing', 'telemetry', 'session', 'sessionpl2session']);
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const validHash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

function assertCommitIdentity({ libraryId, operationId, parents, createdAt }) {
  if (!validId(libraryId) || !validId(operationId) || !Array.isArray(parents)
    || parents.some(parent => !validHash(parent)) || new Set(parents).size !== parents.length
    || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
    throw new LibraryError('INVALID_IDENTITY', 'Library and operation IDs, unique parent hashes and a valid creation time are required.');
  }
}

export class LibraryError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function canonical(value, depth = 0) {
  if (depth > 128) throw new LibraryError('INVALID_JSON', 'JSON nesting exceeds 128 levels.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i)) throw new LibraryError('INVALID_JSON', 'Sparse arrays are not supported.');
    return '[' + value.map(item => canonical(item, depth + 1)).join(',') + ']';
  }
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
  }
  throw new LibraryError('INVALID_JSON', 'Only finite JSON values are supported.');
}

export async function hash(value) {
  const bytes = encoder.encode(canonical(value));
  if (bytes.length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Object exceeds 64 MiB.', 413);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function assertWorkspace(workspace) {
  if (!workspace || Object.getPrototypeOf(workspace) !== Object.prototype) throw new LibraryError('INVALID_WORKSPACE', 'Workspace must be a JSON object.');
  for (const key of Object.keys(workspace)) {
    const store = key.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^pl2/, '');
    if (forbidden.has(store)) throw new LibraryError('EXCLUDED_STORE', 'Remove credential, settings, billing and telemetry stores before library transfer.');
  }
  canonical(workspace);
  if (!Array.isArray(workspace.library)) throw new LibraryError('INVALID_WORKSPACE', 'Workspace must include its library array.');
}

export async function makeObject(kind, data) {
  canonical(data);
  const object = { schemaVersion: VERSION, kind, data: structuredClone(data) };
  return { hash: await hash(object), object };
}

export async function readObject(objects, id, kind) {
  if (!Object.hasOwn(objects, id)) throw new LibraryError('MISSING_OBJECT', 'Referenced object is unavailable.', 503);
  canonical(objects[id]);
  const object = structuredClone(objects[id]);
  if (await hash(object) !== id) throw new LibraryError('HASH_MISMATCH', 'Object failed integrity verification.', 503);
  if (object.schemaVersion !== VERSION || object.kind !== kind) throw new LibraryError('UNSUPPORTED_OBJECT', 'Unsupported object format or kind.');
  return structuredClone(object.data);
}

export async function createPackage(sourceText, { libraryId, operationId, parents = [], createdAt = new Date().toISOString(), sourceInventory }) {
  if (sourceInventory !== undefined) sourceInventory = structuredClone(sourceInventory);
  if (typeof sourceText !== 'string' || encoder.encode(sourceText).length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Source must be JSON text up to 64 MiB.', 413);
  let workspace;
  try { workspace = JSON.parse(sourceText); } catch { throw new LibraryError('INVALID_JSON', 'Source is not valid JSON.'); }
  assertWorkspace(workspace);
  assertCommitIdentity({ libraryId, operationId, parents, createdAt });
  const source = await makeObject('source', sourceText);
  const state = await makeObject('workspace', workspace);
  const objects = { [source.hash]: source.object, [state.hash]: state.object };
  let binding;
  if (sourceInventory !== undefined) {
    const { createSourceBinding } = await import('./source-binding.mjs');
    binding = await createSourceBinding({ source: source.hash, workspace: state.hash, inventory: sourceInventory, objects });
    Object.assign(objects, binding.objects);
  }
  const commit = await makeObject('commit', { libraryId, operationId, parents, source: source.hash, state: state.hash, createdAt,
    ...(binding ? { sourceBinding: binding.hash } : {}) });
  return { format: FORMAT, schemaVersion: VERSION, libraryId, head: commit.hash, objects: { ...objects, [commit.hash]: commit.object } };
}

export async function inspectPackage(pkg) {
  if (pkg?.format !== FORMAT || pkg.schemaVersion !== VERSION || !validId(pkg.libraryId) || !validHash(pkg.head)
    || !pkg.objects || Object.getPrototypeOf(pkg.objects) !== Object.prototype) throw new LibraryError('UNSUPPORTED_PACKAGE', 'Unsupported library package.');
  // Own each object at its existing depth boundary. Wrapping the whole package
  // in canonical() would add envelope levels and reject otherwise valid objects.
  pkg = { ...pkg, objects: Object.fromEntries(Object.entries(pkg.objects).map(([id, object]) => {
    canonical(object);
    return [id, structuredClone(object)];
  })) };
  const active = new Set(), visited = new Map();
  async function visit(id) {
    if (active.has(id)) throw new LibraryError('INVALID_ANCESTRY', 'Cyclic commit ancestry.');
    if (visited.has(id)) return;
    active.add(id);
    const commit = await readObject(pkg.objects, id, 'commit');
    assertCommitIdentity(commit);
    if (commit.libraryId !== pkg.libraryId || !commit.operationId || !Array.isArray(commit.parents) || new Set(commit.parents).size !== commit.parents.length) throw new LibraryError('INVALID_ANCESTRY', 'Invalid commit identity or parents.');
    for (const parent of commit.parents) await visit(parent);
    const operation = Object.hasOwn(commit, 'operation') ? commit.operation : 'snapshot';
    const sourceBindings = [...new Set(commit.parents.flatMap(parent => visited.get(parent).sourceBindings))];
    if (Object.hasOwn(commit, 'sourceBinding')) {
      if (operation === 'restore') throw new LibraryError('UNSUPPORTED_OPERATION', 'Restore uses retained ancestry evidence only.');
      const { inspectSourceBinding } = await import('./source-binding.mjs');
      await inspectSourceBinding(pkg.objects, commit.sourceBinding, { source: commit.source, workspace: operation === 'import' ? commit.inputState : commit.state });
      if (!sourceBindings.includes(commit.sourceBinding)) sourceBindings.push(commit.sourceBinding);
    }
    if (commit.selectionPolicy != null && (operation !== 'import' || commit.selectionPolicy !== 'preserve-deletions-v1')) throw new LibraryError('UNSUPPORTED_OPERATION', 'Unsupported selection policy.');
    let result;
    if (operation === 'import') {
      if (commit.parents.length > 1) throw new LibraryError('INVALID_ANCESTRY', 'Import must have one expected parent or an empty library.');
      const manifest = await readObject(pkg.objects, commit.state, 'library-state');
      const plan = await readObject(pkg.objects, commit.importPlan, 'import-plan');
      const parent = commit.parents.length ? visited.get(commit.parents[0]) : null;
      const { planLibraryImport } = await import('./import-plan.mjs');
      const expected = await planLibraryImport({ base: parent?.manifest ?? (parent ? { sources: [{ source: parent.sourceObject, workspace: parent.stateObject }] } : null),
        baseRevision: commit.parents[0] ?? null, incoming: { source: commit.source, workspace: commit.inputState }, objects: pkg.objects, resolutions: plan.resolutions,
        sourceBindings, enforceDeletions: commit.selectionPolicy === 'preserve-deletions-v1' });
      if (expected.unresolved || canonical(expected) !== canonical(plan) || canonical(expected.manifest) !== canonical(manifest)) {
        throw new LibraryError('IMPORT_PLAN_MISMATCH', 'Import commit does not match its complete sources, parent and reviewed choices.', 409);
      }
      result = { stateKind: 'library-state', manifest, workspace: null, sourceText: null };
    } else if (operation === 'restore') {
      if (commit.parents.length !== 1 || !visited.has(commit.restoredCheckpointId)) throw new LibraryError('INVALID_CHECKPOINT', 'Restore must name an ancestor checkpoint and one current parent.', 409);
      const manifest = await readObject(pkg.objects, commit.state, 'library-state');
      const plan = await readObject(pkg.objects, commit.restorePlan, 'restore-plan');
      const { planCheckpointRestore } = await import('./restore-plan.mjs');
      const expected = await planCheckpointRestore({ current: visited.get(commit.parents[0]), checkpoint: visited.get(commit.restoredCheckpointId),
        baseRevision: commit.parents[0], checkpointId: commit.restoredCheckpointId, objects: pkg.objects });
      if (expected.unresolved || commit.source !== expected.source || canonical(expected) !== canonical(plan) || canonical(manifest) !== canonical(expected.manifest)) {
        throw new LibraryError('RESTORE_PLAN_MISMATCH', 'Restore differs from its current parent, checkpoint or deletion evidence.', 409);
      }
      result = { stateKind: 'library-state', manifest, workspace: null, sourceText: null };
    } else if (operation === 'snapshot') {
      if (commit.parents.some(parent => visited.get(parent).stateKind !== 'workspace')) throw new LibraryError('UNSUPPORTED_OPERATION', 'Snapshot replacement cannot discard an imported library graph.');
      const workspace = await readObject(pkg.objects, commit.state, 'workspace');
      assertWorkspace(workspace);
      const sourceText = await readObject(pkg.objects, commit.source, 'source');
      let decoded;
      try { decoded = JSON.parse(sourceText); } catch { throw new LibraryError('INVALID_JSON', 'Archived source is not valid JSON.'); }
      if (typeof sourceText !== 'string' || canonical(decoded) !== canonical(workspace)) throw new LibraryError('SOURCE_MISMATCH', 'Archived source and workspace disagree.');
      result = { stateKind: 'workspace', manifest: null, workspace, sourceText };
    } else throw new LibraryError('UNSUPPORTED_OPERATION', 'Unsupported commit operation.');
    active.delete(id);
    visited.set(id, { ...result, stateObject: commit.state, sourceObject: commit.source, sourceBindings: sourceBindings.sort() });
  }
  await visit(pkg.head);
  // Retained unreachable objects are part of the archive too; never silently drop them.
  for (const [id, object] of Object.entries(pkg.objects)) if (await hash(object) !== id) throw new LibraryError('HASH_MISMATCH', 'Retained object failed integrity verification.', 503);
  return { libraryId: pkg.libraryId, revision: pkg.head, ...visited.get(pkg.head), commits: visited.size, objectCount: Object.keys(pkg.objects).length };
}

const packageFor = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });

async function reviewImport(state, incomingPackage, resolutions) {
  const current = state.revision ? await inspectPackage(packageFor(state)) : null;
  const incomingCommit = incomingPackage.objects[incomingPackage.head].data;
  const { planLibraryImport } = await import('./import-plan.mjs');
  return planLibraryImport({ base: current?.manifest ?? (current ? { sources: [{ source: current.sourceObject, workspace: current.stateObject }] } : null),
    baseRevision: state.revision, incoming: { source: incomingCommit.source, workspace: incomingCommit.state },
    objects: { ...state.objects, ...incomingPackage.objects }, resolutions,
    sourceBindings: [...(current?.sourceBindings ?? []), ...(incomingCommit.sourceBinding ? [incomingCommit.sourceBinding] : [])],
    enforceDeletions: Boolean(incomingCommit.sourceBinding || current?.sourceBindings.length) });
}

async function reviewRestore(state, { libraryId, expectedRevision, checkpointId }) {
  if (state.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Library identity differs.', 409);
  if (!state.revision || state.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Pin restore review to the current revision.', 409);
  if (!validHash(checkpointId) || !state.checkpoints.includes(checkpointId)) throw new LibraryError('INVALID_CHECKPOINT', 'Select a retained recovery checkpoint.', 409);
  const current = await inspectPackage(packageFor(state));
  const checkpoint = await inspectPackage({ ...packageFor(state), head: checkpointId });
  const { planCheckpointRestore } = await import('./restore-plan.mjs');
  return planCheckpointRestore({ current, checkpoint, baseRevision: expectedRevision, checkpointId, objects: state.objects });
}

// Adapter transaction must atomically publish state and operation receipts, or publish neither.
export function createMemoryAdapter(initial = { libraryId: null, revision: null, objects: {}, operations: {}, checkpoints: [] }) {
  let state = structuredClone(initial);
  let queue = Promise.resolve();
  return {
    read: () => structuredClone(state),
    transact(fn) {
      // The transaction boundary belongs to the adapter, including when two
      // command service instances share it during reconstruction or testing.
      const result = queue.then(async () => {
        const candidate = structuredClone(state);
        const result = await fn(candidate);
        const receipt = structuredClone(result);
        state = candidate;
        return receipt;
      });
      queue = result.catch(() => {});
      return result;
    },
  };
}

export function createCommandService(adapter, { now = () => Date.now(), previewLifetimeMs = 300_000 } = {}) {
  const previews = new Map();
  let queue = Promise.resolve();
  function serialized(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }
  async function currentReview(previewId) {
    const preview = previews.get(previewId);
    if (!preview || preview.expires <= now()) throw new LibraryError('PREVIEW_EXPIRED', 'Preview expired; preview again.', 409);
    const state = await adapter.read();
    if (preview.expires <= now()) throw new LibraryError('PREVIEW_EXPIRED', 'Preview expired; preview again.', 409);
    if (state.revision !== preview.input.expectedRevision || (state.libraryId && state.libraryId !== preview.input.libraryId)) {
      throw new LibraryError('REVISION_CONFLICT', 'Library changed; preview again.', 409);
    }
    return structuredClone(preview.response);
  }
  async function exportTransfer({ libraryId, expectedRevision }) {
    const state = await adapter.read();
    if (state.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Library identity differs.', 409);
    if (!state.revision || state.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Pin transfers to the current library revision.', 409);
    const { createTransfer } = await import('./transfer.mjs');
    const transfer = await createTransfer(state);
    const current = await adapter.read();
    if (current.libraryId !== libraryId || current.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Library changed during transfer preparation.', 409);
    return transfer;
  }
  return {
    read: () => adapter.read(),
    previewRead: currentReview,
    transfer: exportTransfer,
    async records({ libraryId, expectedRevision, domain, cursor = '0', limit = 100, ...options }) {
      if (Object.keys(options).length) throw new LibraryError('INVALID_REQUEST', 'Unknown record query option.', 400);
      const { buildDomainMap, pageDomainMap, validateDomainPage } = await import('./domain-map.mjs');
      validateDomainPage({ domain, cursor, limit });
      const state = await adapter.read();
      if (state.libraryId !== libraryId) throw new LibraryError('WRONG_LIBRARY', 'Library identity differs.', 409);
      if (!state.revision || state.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Pin record reads to the current revision.', 409);
      const map = await buildDomainMap(packageFor(state));
      const page = pageDomainMap(map, { domain, cursor, limit });
      if (encoder.encode(canonical(page)).length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Record page exceeds 64 MiB. Request fewer records.', 413);
      const current = await adapter.read();
      if (current.libraryId !== libraryId || current.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Library changed during record preparation.', 409);
      return page;
    },
    async backups({ libraryId, expectedRevision, cursor = '0', limit = 100 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof cursor !== 'string'
        || !/^(0|[1-9][0-9]*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) throw new LibraryError('INVALID_REQUEST', 'Invalid backup pagination.', 400);
      const transfer = await exportTransfer({ libraryId, expectedRevision });
      const offset = Number(cursor), ids = transfer.checkpoints;
      const items = ids.slice(offset, offset + limit).map(checkpointId => {
        const commit = transfer.objects[checkpointId].data;
        const next = Object.values(transfer.operations).find(receipt => receipt.checkpointId === checkpointId);
        return { checkpointId, name: next ? `Before ${next.operationId}` : `Retained ${commit.operationId}`,
          createdAt: commit.createdAt, stateHash: commit.state, stateKind: ['import', 'restore'].includes(commit.operation) ? 'library-state' : 'workspace',
          independentBackup: false };
      });
      return { libraryId, revision: expectedRevision, items, nextCursor: offset + limit < ids.length ? String(offset + limit) : null };
    },
    async previewRestore({ libraryId, expectedRevision, checkpointId, ...options }) {
      if (Object.keys(options).length) throw new LibraryError('INVALID_REQUEST', 'Restore has no deletion bypass or additional options.', 400);
      const input = { libraryId, expectedRevision, checkpointId, mode: 'restore' };
      const restorePlan = await reviewRestore(await adapter.read(), input);
      const previewId = globalThis.crypto.randomUUID(), fingerprint = await hash(input), expires = now() + previewLifetimeMs;
      const response = { previewId, libraryId, expectedRevision, checkpointId, sourceHash: restorePlan.source, fingerprint,
        expiresAt: expires, mode: 'restore', commitAvailable: restorePlan.unresolved === 0, restorePlan };
      previews.set(previewId, { input, fingerprint, expires, response });
      try { return await currentReview(previewId); }
      catch (error) { previews.delete(previewId); throw error; }
    },
    async preview({ libraryId, expectedRevision, sourceText, resolutions = {}, mode = 'snapshot', sourceInventory }) {
      if (!['snapshot', 'import'].includes(mode)) throw new LibraryError('INVALID_MODE', 'Select snapshot or import review.');
      canonical(resolutions);
      // Take ownership before the first await. The caller may keep editing its
      // choices while storage reads or hashes are still in flight.
      resolutions = structuredClone(resolutions);
      if (sourceInventory !== undefined) sourceInventory = structuredClone(sourceInventory);
      const state = await adapter.read();
      if (state.libraryId && libraryId !== state.libraryId) throw new LibraryError('WRONG_LIBRARY', 'Library identity differs.', 409);
      if (state.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Library changed; preview again.', 409);
      if (mode === 'snapshot' && canonical(resolutions) !== '{}') throw new LibraryError('UNSUPPORTED_RESOLUTION', 'Whole-workspace transfers do not resolve record conflicts.');
      const pkg = await createPackage(sourceText, { libraryId, operationId: 'preview', sourceInventory });
      await inspectPackage(pkg);
      let importPlan;
      if (mode === 'import') {
        importPlan = await reviewImport(state, pkg, resolutions);
      } else if (state.revision && (await inspectPackage(packageFor(state))).stateKind === 'library-state') {
        throw new LibraryError('UNSUPPORTED_OPERATION', 'Snapshot replacement cannot discard an imported library graph.');
      }
      const previewId = globalThis.crypto.randomUUID();
      const input = { libraryId, expectedRevision, sourceText, resolutions, mode, ...(sourceInventory !== undefined ? { sourceInventory } : {}) };
      const fingerprint = await hash(input);
      const expires = now() + previewLifetimeMs;
      const response = { previewId, libraryId, expectedRevision, sourceHash: pkg.objects[pkg.head].data.source, fingerprint, expiresAt: expires, mode,
        commitAvailable: mode === 'snapshot' || importPlan.unresolved === 0, ...(importPlan ? { importPlan } : {}),
        ...(pkg.objects[pkg.head].data.sourceBinding ? { sourceBinding: pkg.objects[pkg.head].data.sourceBinding } : {}) };
      previews.set(previewId, { input, fingerprint, expires, response });
      try { return await currentReview(previewId); }
      catch (error) { previews.delete(previewId); throw error; }
    },
    async apply({ previewId, libraryId, expectedRevision, idempotencyKey, fingerprint }) {
      if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 200) throw new LibraryError('INVALID_OPERATION', 'An idempotency key up to 200 characters is required.');
      return serialized(() => adapter.transact(async state => {
        const previous = Object.hasOwn(state.operations, idempotencyKey) ? state.operations[idempotencyKey] : null;
        if (previous) {
          if (previous.fingerprint !== fingerprint || previous.libraryId !== libraryId || previous.parentRevision !== expectedRevision) throw new LibraryError('IDEMPOTENCY_CONFLICT', 'Operation key was used for different input.', 409);
          return previous;
        }
        const preview = previews.get(previewId);
        if (!preview || preview.expires <= now()) throw new LibraryError('PREVIEW_EXPIRED', 'Preview expired; preview again.', 409);
        if (preview.fingerprint !== fingerprint || preview.input.libraryId !== libraryId || preview.input.expectedRevision !== expectedRevision || state.revision !== expectedRevision || (state.libraryId && state.libraryId !== libraryId)) throw new LibraryError('REVISION_CONFLICT', 'Preview no longer matches the library.', 409);
        if (preview.input.mode === 'import') {
          if (preview.response.importPlan.deletionReview?.blocked.length) throw new LibraryError('DELETION_EVIDENCE_UNKNOWN', 'Import cannot commit while deletion evidence is unknown. Capture and review the affected sources again.', 409);
          if (preview.response.importPlan.unresolved) throw new LibraryError('UNRESOLVED_IMPORT', 'Resolve every import choice and preview again.', 409);
        }
        const identity = { libraryId, operationId: idempotencyKey, parents: state.revision ? [state.revision] : [] };
        let pkg;
        if (preview.input.mode === 'restore') {
          if (preview.response.restorePlan.unresolved) throw new LibraryError('DELETION_EVIDENCE_UNKNOWN', 'Restore cannot commit while deletion evidence is unknown.', 409);
          const plan = await reviewRestore(state, preview.input);
          if (canonical(plan) !== canonical(preview.response.restorePlan)) throw new LibraryError('RESTORE_PLAN_MISMATCH', 'Restore no longer matches its reviewed checkpoint and evidence.', 409);
          const planObject = await makeObject('restore-plan', plan), manifest = await makeObject('library-state', plan.manifest);
          const commit = await makeObject('commit', { ...identity, operation: 'restore', source: plan.source, state: manifest.hash,
            restorePlan: planObject.hash, restoredCheckpointId: plan.checkpointId, createdAt: new Date().toISOString() });
          pkg = { format: FORMAT, schemaVersion: VERSION, libraryId, head: commit.hash,
            objects: { [planObject.hash]: planObject.object, [manifest.hash]: manifest.object, [commit.hash]: commit.object } };
        } else pkg = await createPackage(preview.input.sourceText, { ...identity, sourceInventory: preview.input.sourceInventory });
        if (preview.input.mode === 'import') {
          const plan = await reviewImport(state, pkg, preview.input.resolutions);
          if (canonical(plan) !== canonical(preview.response.importPlan)) throw new LibraryError('IMPORT_PLAN_MISMATCH', 'Import no longer matches its reviewed sources and choices.', 409);
          const incoming = pkg.objects[pkg.head].data;
          const planObject = await makeObject('import-plan', plan);
          const manifest = await makeObject('library-state', plan.manifest);
          const commit = await makeObject('commit', { ...identity, operation: 'import', source: incoming.source, inputState: incoming.state,
            state: manifest.hash, importPlan: planObject.hash, createdAt: incoming.createdAt,
            ...(plan.manifest.deletionPolicy ? { selectionPolicy: 'preserve-deletions-v1' } : {}),
            ...(incoming.sourceBinding ? { sourceBinding: incoming.sourceBinding } : {}) });
          const inputObjects = { ...pkg.objects }; delete inputObjects[pkg.head];
          pkg = { ...pkg, head: commit.hash, objects: { ...inputObjects,
            [planObject.hash]: planObject.object, [manifest.hash]: manifest.object, [commit.hash]: commit.object } };
        } else if (preview.input.mode === 'snapshot' && state.revision && (await inspectPackage(packageFor(state))).stateKind === 'library-state') {
          throw new LibraryError('UNSUPPORTED_OPERATION', 'Snapshot replacement cannot discard an imported library graph.');
        }
        Object.assign(state.objects, pkg.objects);
        const verified = await inspectPackage({ ...pkg, objects: state.objects });
        const checkpointId = state.revision;
        if (checkpointId) state.checkpoints.push(checkpointId);
        state.libraryId = libraryId;
        state.revision = pkg.head;
        const receipt = { operationId: idempotencyKey, libraryId, parentRevision: expectedRevision, revision: pkg.head, checkpointId, fingerprint,
          operation: preview.input.mode, stateHash: verified.stateObject, sourceHash: verified.sourceObject,
          ...(preview.input.mode === 'restore' ? { restoredCheckpointId: preview.input.checkpointId } : {}),
          ...(pkg.objects[pkg.head].data.sourceBinding ? { sourceBinding: pkg.objects[pkg.head].data.sourceBinding } : {}),
          counts: { objects: verified.objectCount, sources: verified.manifest?.sources.length ?? 1,
            records: verified.manifest?.nodes.length ?? null, historyRecords: verified.manifest?.nodes.filter(node => node.kind === 'version').length ?? null },
          state: 'committed', verified: true };
        Object.defineProperty(state.operations, idempotencyKey, { value: receipt, enumerable: true, configurable: true, writable: true });
        return receipt;
      }));
    },
    async operation(id) { const operations = (await adapter.read()).operations; return Object.hasOwn(operations, id) ? operations[id] : null; },
  };
}
