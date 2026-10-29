import { assertWorkspace, canonical, hash, inspectPackage, FORMAT, VERSION, LibraryError } from './contract.mjs';

export const TRANSFER_FORMAT = 'promptlab-library-transfer';
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = message => { throw new LibraryError('INVALID_TRANSFER', message); };
const byteLength = value => new TextEncoder().encode(canonical(value)).length;

async function verifyState(input) {
  if (!record(input) || !record(input.objects) || !record(input.operations) || !Array.isArray(input.checkpoints)) fail('Complete library state is required.');
  // Own the input before any asynchronous hash. Do not add an aggregate depth
  // or size limit around otherwise valid individual immutable objects.
  const state = structuredClone(input);
  const metadata = Object.fromEntries(Object.entries(state).filter(([key]) => !['objects', 'operations', 'checkpoints'].includes(key)));
  assertWorkspace({ ...metadata, library: [] });
  for (const object of Object.values(state.objects)) {
    if (!record(object) || !Number.isSafeInteger(object.schemaVersion) || object.schemaVersion < 1
      || typeof object.kind !== 'string' || !object.kind || !Object.hasOwn(object, 'data')) fail('Retained object envelope is invalid.');
    if (object?.kind === 'workspace') assertWorkspace(object.data);
    if (object?.kind === 'source') {
      let workspace;
      try { workspace = JSON.parse(object.data); } catch { fail('Retained source is not valid workspace JSON.'); }
      if (typeof object.data !== 'string') fail('Retained source is not JSON text.');
      assertWorkspace(workspace);
    }
  }
  const pkg = { format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects };
  const inspection = await inspectPackage(pkg);
  const commits = new Map(Object.entries(state.objects).filter(([, object]) => object.kind === 'commit').map(([id, object]) => [id, object.data]));
  const reachable = new Set();
  function visit(id) {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const parent of commits.get(id).parents) visit(parent);
  }
  visit(state.revision);
  // Retained branches are exported too. Verify their ancestry instead of
  // trusting an unreachable commit just because its object hash is valid.
  for (const id of commits.keys()) if (!reachable.has(id)) { await inspectPackage({ ...pkg, head: id }); visit(id); }
  const receipts = new Map();
  for (const [operationId, receipt] of Object.entries(state.operations)) {
    canonical(receipt);
    const commit = commits.get(receipt?.revision);
    const parent = commit?.parents[0] ?? null;
    if (!record(receipt) || !commit || commit.parents.length > 1 || receipt.operationId !== operationId
      || commit.operationId !== operationId || receipt.libraryId !== state.libraryId || receipt.parentRevision !== parent
      || receipt.checkpointId !== parent || receipt.state !== 'committed' || receipt.verified !== true || receipts.has(receipt.revision)) fail('Operation receipt does not match its commit.');
    const mode = commit.operation ?? 'snapshot';
    if (receipt.operation != null && receipt.operation !== mode) fail('Operation mode differs from its commit.');
    const resolutions = mode === 'import' ? state.objects[commit.importPlan].data.resolutions : {};
    const input = mode === 'restore'
      ? { libraryId: state.libraryId, expectedRevision: parent, checkpointId: commit.restoredCheckpointId, mode }
      : { libraryId: state.libraryId, expectedRevision: parent, sourceText: state.objects[commit.source].data, resolutions, mode };
    if (mode === 'restore' && (receipt.restoredCheckpointId !== commit.restoredCheckpointId || !state.checkpoints.includes(commit.restoredCheckpointId))) fail('Restore receipt or checkpoint differs from the committed review.');
    if (Object.hasOwn(commit, 'sourceBinding')) {
      const { inspectSourceBinding } = await import('./source-binding.mjs');
      input.sourceInventory = (await inspectSourceBinding(state.objects, commit.sourceBinding)).inventory;
      if (receipt.sourceBinding !== commit.sourceBinding) fail('Receipt source binding differs from its commit.');
    } else if (Object.hasOwn(receipt, 'sourceBinding')) fail('Receipt claims an unbound source inventory.');
    const current = await hash(input);
    // Earlier version-one snapshot receipts predate the explicit mode field.
    const legacy = { ...input }; delete legacy.mode;
    if (receipt.fingerprint !== current && !(commit.operation == null && receipt.operation == null && receipt.fingerprint === await hash(legacy))) fail('Operation fingerprint differs from its committed input.');
    if ((receipt.sourceHash != null && receipt.sourceHash !== commit.source) || (receipt.stateHash != null && receipt.stateHash !== commit.state)) fail('Receipt object references differ from its commit.');
    if (receipt.counts != null) {
      const manifest = ['import', 'restore'].includes(mode) ? state.objects[commit.state].data : null;
      const counts = receipt.counts;
      if (!record(counts) || !Number.isSafeInteger(counts.objects) || counts.objects < 1 || counts.objects > Object.keys(state.objects).length
        || counts.sources !== (manifest?.sources.length ?? 1) || counts.records !== (manifest?.nodes.length ?? null)
        || counts.historyRecords !== (manifest?.nodes.filter(node => node.kind === 'version').length ?? null)) fail('Receipt counts disagree with its committed state.');
    }
    receipts.set(receipt.revision, receipt);
  }
  for (const [id, commit] of commits) {
    if (!receipts.has(id)) fail('A retained commit is missing its operation receipt.');
    for (const parent of commit.parents) if (!state.checkpoints.includes(parent)) fail('A pre-operation recovery checkpoint is missing.');
  }
  if (new Set(state.checkpoints).size !== state.checkpoints.length || state.checkpoints.some(id => !commits.has(id))) fail('Checkpoint references are missing or duplicated.');
  return { state, metadata, inspection, commits: commits.size };
}

/** Complete, deterministic transfer. This does not activate a destination. */
export async function createTransfer(input) {
  const { state, metadata, inspection, commits } = await verifyState(input);
  const objects = Object.keys(state.objects).sort().map(id => ({ hash: id, kind: state.objects[id].kind, bytes: byteLength(state.objects[id]) }));
  const operations = [];
  for (const operationId of Object.keys(state.operations).sort()) operations.push({ operationId, hash: await hash(state.operations[operationId]) });
  const manifest = { format: 'promptlab-library-transfer-manifest', schemaVersion: VERSION, libraryId: state.libraryId, revision: state.revision,
    objects, operations, checkpointsHash: await hash(state.checkpoints), metadataHash: await hash(metadata),
    counts: { objects: objects.length, operations: operations.length, checkpoints: state.checkpoints.length, commits }, stateKind: inspection.stateKind };
  return { format: TRANSFER_FORMAT, schemaVersion: VERSION, manifest, manifestHash: await hash(manifest),
    metadata, objects: state.objects, operations: state.operations, checkpoints: state.checkpoints };
}

export async function inspectTransfer(input, { expectedManifestHash } = {}) {
  if (input?.format !== TRANSFER_FORMAT || input.schemaVersion !== VERSION || !record(input.metadata)) fail('Unsupported transfer format.');
  const transfer = structuredClone(input);
  if (expectedManifestHash != null && transfer.manifestHash !== expectedManifestHash) throw new LibraryError('TRANSFER_CHANGED', 'Transfer differs from its reviewed manifest.', 409);
  if (['objects', 'operations', 'checkpoints'].some(key => Object.hasOwn(transfer.metadata, key))) fail('Transfer metadata cannot replace content sections.');
  const state = { ...transfer.metadata, objects: transfer.objects, operations: transfer.operations, checkpoints: transfer.checkpoints };
  const verified = await createTransfer(state);
  if (canonical(transfer.manifest) !== canonical(verified.manifest) || transfer.manifestHash !== verified.manifestHash) fail('Transfer inventory, hashes or counts disagree.');
  if (Object.keys(transfer).some(key => !Object.hasOwn(verified, key))) fail('Unknown transfer envelope fields require an explicit format migration.');
  return { libraryId: state.libraryId, revision: state.revision, manifestHash: verified.manifestHash, counts: verified.manifest.counts,
    stateKind: verified.manifest.stateKind, state };
}
