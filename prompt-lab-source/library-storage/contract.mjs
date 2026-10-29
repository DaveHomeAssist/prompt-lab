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
  const object = { schemaVersion: VERSION, kind, data };
  return { hash: await hash(object), object };
}

export async function readObject(objects, id, kind) {
  const object = objects[id];
  if (!object) throw new LibraryError('MISSING_OBJECT', 'Referenced object is unavailable.', 503);
  if (await hash(object) !== id) throw new LibraryError('HASH_MISMATCH', 'Object failed integrity verification.', 503);
  if (object.schemaVersion !== VERSION || object.kind !== kind) throw new LibraryError('UNSUPPORTED_OBJECT', 'Unsupported object format or kind.');
  return structuredClone(object.data);
}

export async function createPackage(sourceText, { libraryId, operationId, parents = [], createdAt = new Date().toISOString() }) {
  if (typeof sourceText !== 'string' || encoder.encode(sourceText).length > MAX_BYTES) throw new LibraryError('PAYLOAD_TOO_LARGE', 'Source must be JSON text up to 64 MiB.', 413);
  let workspace;
  try { workspace = JSON.parse(sourceText); } catch { throw new LibraryError('INVALID_JSON', 'Source is not valid JSON.'); }
  assertWorkspace(workspace);
  assertCommitIdentity({ libraryId, operationId, parents, createdAt });
  const source = await makeObject('source', sourceText);
  const state = await makeObject('workspace', workspace);
  const commit = await makeObject('commit', { libraryId, operationId, parents, source: source.hash, state: state.hash, createdAt });
  return { format: FORMAT, schemaVersion: VERSION, libraryId, head: commit.hash, objects: { [source.hash]: source.object, [state.hash]: state.object, [commit.hash]: commit.object } };
}

export async function inspectPackage(pkg) {
  if (pkg?.format !== FORMAT || pkg.schemaVersion !== VERSION || !validId(pkg.libraryId) || !validHash(pkg.head)
    || !pkg.objects || Object.getPrototypeOf(pkg.objects) !== Object.prototype) throw new LibraryError('UNSUPPORTED_PACKAGE', 'Unsupported library package.');
  const active = new Set(), visited = new Set();
  async function visit(id) {
    if (active.has(id)) throw new LibraryError('INVALID_ANCESTRY', 'Cyclic commit ancestry.');
    if (visited.has(id)) return;
    active.add(id);
    const commit = await readObject(pkg.objects, id, 'commit');
    assertCommitIdentity(commit);
    if (commit.libraryId !== pkg.libraryId || !commit.operationId || !Array.isArray(commit.parents) || new Set(commit.parents).size !== commit.parents.length) throw new LibraryError('INVALID_ANCESTRY', 'Invalid commit identity or parents.');
    const workspace = await readObject(pkg.objects, commit.state, 'workspace');
    assertWorkspace(workspace);
    const source = await readObject(pkg.objects, commit.source, 'source');
    let decoded;
    try { decoded = JSON.parse(source); } catch { throw new LibraryError('INVALID_JSON', 'Archived source is not valid JSON.'); }
    if (canonical(decoded) !== canonical(workspace)) throw new LibraryError('SOURCE_MISMATCH', 'Archived source and workspace disagree.');
    for (const parent of commit.parents) await visit(parent);
    active.delete(id);
    visited.add(id);
  }
  await visit(pkg.head);
  // Retained unreachable objects are part of the archive too; never silently drop them.
  for (const [id, object] of Object.entries(pkg.objects)) if (await hash(object) !== id) throw new LibraryError('HASH_MISMATCH', 'Retained object failed integrity verification.', 503);
  const commit = await readObject(pkg.objects, pkg.head, 'commit');
  const workspace = await readObject(pkg.objects, commit.state, 'workspace');
  const sourceText = await readObject(pkg.objects, commit.source, 'source');
  return { libraryId: pkg.libraryId, revision: pkg.head, workspace, sourceText, commits: visited.size, objectCount: Object.keys(pkg.objects).length };
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
    if (state.revision !== preview.input.expectedRevision || (state.libraryId && state.libraryId !== preview.input.libraryId)) {
      throw new LibraryError('REVISION_CONFLICT', 'Library changed; preview again.', 409);
    }
    return structuredClone(preview.response);
  }
  return {
    read: () => adapter.read(),
    previewRead: currentReview,
    async preview({ libraryId, expectedRevision, sourceText, resolutions = {}, mode = 'snapshot' }) {
      if (!['snapshot', 'import'].includes(mode)) throw new LibraryError('INVALID_MODE', 'Select snapshot or import review.');
      canonical(resolutions);
      // Take ownership before the first await. The caller may keep editing its
      // choices while storage reads or hashes are still in flight.
      resolutions = structuredClone(resolutions);
      const state = await adapter.read();
      if (state.libraryId && libraryId !== state.libraryId) throw new LibraryError('WRONG_LIBRARY', 'Library identity differs.', 409);
      if (state.revision !== expectedRevision) throw new LibraryError('REVISION_CONFLICT', 'Library changed; preview again.', 409);
      if (mode === 'snapshot' && canonical(resolutions) !== '{}') throw new LibraryError('UNSUPPORTED_RESOLUTION', 'Whole-workspace transfers do not resolve record conflicts.');
      const pkg = await createPackage(sourceText, { libraryId, operationId: 'preview' });
      const incoming = await inspectPackage(pkg);
      let importPlan;
      if (mode === 'import') {
        const existing = state.revision ? (await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: state.revision, objects: state.objects })).workspace : { library: [] };
        // Load at the command boundary to avoid a static cycle with the planner's
        // shared JSON/integrity primitives in this module.
        const { planLosslessImport } = await import('./import-plan.mjs');
        importPlan = await planLosslessImport(existing, incoming.workspace, resolutions);
      }
      const previewId = globalThis.crypto.randomUUID();
      const input = { libraryId, expectedRevision, sourceText, resolutions, mode };
      const fingerprint = await hash(input);
      const expires = now() + previewLifetimeMs;
      const response = { previewId, libraryId, expectedRevision, sourceHash: await hash(sourceText), fingerprint, expiresAt: expires, mode,
        commitAvailable: mode === 'snapshot', ...(importPlan ? { importPlan } : {}) };
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
          if (preview.response.importPlan.unresolved) throw new LibraryError('UNRESOLVED_IMPORT', 'Resolve every import choice and preview again.', 409);
          throw new LibraryError('IMPORT_APPLY_UNAVAILABLE', 'Import review is available; applying the complete preserved graph is not implemented.', 409);
        }
        const pkg = await createPackage(preview.input.sourceText, { libraryId, operationId: idempotencyKey, parents: state.revision ? [state.revision] : [] });
        Object.assign(state.objects, pkg.objects);
        await inspectPackage({ ...pkg, objects: state.objects });
        const checkpointId = state.revision;
        if (checkpointId) state.checkpoints.push(checkpointId);
        state.libraryId = libraryId;
        state.revision = pkg.head;
        const receipt = { operationId: idempotencyKey, libraryId, parentRevision: expectedRevision, revision: pkg.head, checkpointId, fingerprint, state: 'committed', verified: true };
        Object.defineProperty(state.operations, idempotencyKey, { value: receipt, enumerable: true, configurable: true, writable: true });
        return receipt;
      }));
    },
    async operation(id) { const operations = (await adapter.read()).operations; return Object.hasOwn(operations, id) ? operations[id] : null; },
  };
}
