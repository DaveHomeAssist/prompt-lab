import { canonical, hash, inspectPackage, LibraryError, readObject, FORMAT, VERSION } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { inspectTransfer } from './transfer.mjs';

const fail = (code, message) => { throw new LibraryError(code, message, 409); };
const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const packageFor = (libraryId, revision, objects) => ({ format: FORMAT, schemaVersion: VERSION, libraryId, head: revision, objects });

function ancestors(objects, revision) {
  const seen = new Set(), pending = [revision];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = objects[id];
    if (commit?.kind !== 'commit') fail('INVALID_ANCESTRY', 'A branch ancestor is unavailable.');
    pending.push(...commit.data.parents);
  }
  return seen;
}

/** Multiple best ancestors require another explicit reconciliation, never a clock tie-break. */
export function commonAncestor(objects, currentRevision, incomingRevision) {
  const current = ancestors(objects, currentRevision), incoming = ancestors(objects, incomingRevision);
  if (current.has(incomingRevision)) fail('ALREADY_INTEGRATED', 'This branch is already in the current ancestry.');
  const common = [...current].filter(id => incoming.has(id));
  const older = new Set(common.flatMap(id => [...ancestors(objects, id)].filter(parent => parent !== id)));
  const nearest = common.filter(id => !older.has(id));
  if (nearest.length !== 1) fail('AMBIGUOUS_ANCESTRY', 'Branches require one verified common ancestor.');
  return nearest[0];
}

export function combineBranchState(current, incoming) {
  if (current.libraryId !== incoming.libraryId) fail('WRONG_LIBRARY', 'Branches belong to different libraries.');
  for (const [id, receipt] of Object.entries(incoming.operations)) {
    if (Object.hasOwn(current.operations, id) && canonical(current.operations[id]) !== canonical(receipt)) {
      fail('IDEMPOTENCY_CONFLICT', 'Branches reused an operation key for different input.');
    }
  }
  return { objects: { ...current.objects, ...incoming.objects }, operations: { ...current.operations, ...incoming.operations },
    checkpoints: [...new Set([...current.checkpoints, ...incoming.checkpoints, current.revision, incoming.revision])] };
}

// Preserve the original transfer envelope without recursively embedding its objects.
export function archiveBranch(transfer) {
  const { objects, ...archive } = transfer;
  return structuredClone(archive);
}

export async function readArchivedBranch(objects, archiveId) {
  const archive = await readObject(objects, archiveId, 'branch-transfer');
  if (!Array.isArray(archive.manifest?.objects)) fail('INVALID_TRANSFER', 'Branch archive has no object inventory.');
  const retained = {};
  for (const item of archive.manifest.objects) {
    if (!Object.hasOwn(objects, item.hash)) fail('MISSING_OBJECT', 'An archived branch object is unavailable.');
    Object.defineProperty(retained, item.hash, { value: objects[item.hash], enumerable: true });
  }
  return inspectTransfer({ ...archive, objects: retained });
}

/** Reconcile stable import group identities, preserving every branch source and alias. */
export async function planReconciliation({ libraryId, currentRevision, incomingRevision, incomingManifestHash, objects, resolutions = {}, inspected }) {
  if (!record(resolutions)) throw new LibraryError('INVALID_RESOLUTIONS', 'Branch choices must be an object.');
  canonical(resolutions); resolutions = structuredClone(resolutions);
  // Package verification already visited these immutable parents. Reuse that
  // invocation's results instead of recursively validating the same graph again.
  const current = inspected?.current ?? await inspectPackage(packageFor(libraryId, currentRevision, objects));
  const incoming = inspected?.incoming ?? await inspectPackage(packageFor(libraryId, incomingRevision, objects));
  if (!current.manifest || !incoming.manifest) fail('IMPORT_REVIEW_REQUIRED', 'Review each workspace through import before reconciling its record selections.');
  const ancestorRevision = commonAncestor(objects, currentRevision, incomingRevision);
  const base = inspected?.ancestor(ancestorRevision) ?? await inspectPackage(packageFor(libraryId, ancestorRevision, objects));
  const baseManifest = base.manifest ?? await buildLibrarySelection({ sources: [{ source: base.sourceObject, workspace: base.stateObject }], objects });
  const manifests = [baseManifest, current.manifest, incoming.manifest];
  const maps = manifests.map(manifest => new Map(manifest.groups.map(group => [group.id, group])));
  const nodes = new Map(manifests.flatMap(manifest => manifest.nodes.map(node => [node.key, node])));
  const signature = group => !group ? 'absent' : group.selected === null ? `inactive:${group.inactiveReason}` : nodes.get(group.selected)?.hash;
  const sources = [...new Map(manifests.flatMap(manifest => manifest.sources).map(source => [canonical(source), source])).values()];
  const ids = [...new Set(maps.flatMap(map => [...map.keys()]))].sort(), groups = [], rows = [];
  for (const id of Object.keys(resolutions)) if (!ids.includes(id)) throw new LibraryError('INVALID_RESOLUTIONS', 'Choice names an unknown group.');
  for (const id of ids) {
    const [original, left, right] = maps.map(map => map.get(id));
    // Imported branches never remove a group. An inactive selection keeps its history.
    if (original && (!left || !right)) fail('INVALID_ANCESTRY', 'A branch discarded an inherited group.');
    const [before, a, b] = [original, left, right].map(signature);
    let choice = a === b ? 'current' : a === before ? 'incoming' : b === before ? 'current' : !left ? 'incoming' : !right ? 'current' : null;
    const conflict = choice === null;
    if (Object.hasOwn(resolutions, id)) {
      if (!conflict || !['current', 'incoming'].includes(resolutions[id])) throw new LibraryError('INVALID_RESOLUTIONS', 'Choose current or incoming only for an unresolved group.');
      choice = resolutions[id];
    }
    const selected = choice === 'incoming' ? right : left ?? right;
    const members = [...new Set([...(original?.members ?? []), ...(left?.members ?? []), ...(right?.members ?? [])])];
    groups.push({ ...structuredClone(selected), members });
    rows.push({ groupId: id, ancestor: original?.selected ?? null, current: left?.selected ?? null, incoming: right?.selected ?? null,
      conflict, choice, reason: conflict ? 'concurrent-change' : a === b ? 'same-selection' : 'causal-change' });
  }
  const selection = await buildLibrarySelection({ sources, groups, objects });
  const sourceBindings = [...new Set([...current.sourceBindings, ...incoming.sourceBindings])].sort();
  const { manifest, ...deletionReview } = await applyDeletionPolicy(selection, objects, sourceBindings, [...(current.derivedSources ?? []), ...(incoming.derivedSources ?? [])]);
  const plan = { format: 'promptlab-library-reconciliation-plan', schemaVersion: VERSION, libraryId, baseRevision: currentRevision,
    incomingRevision, incomingManifestHash, ancestorRevision, resolutions, rows, manifest, deletionReview,
    unresolved: rows.filter(row => row.choice === null).length + deletionReview.blocked.length, activationReady: false };
  return { ...plan, fingerprint: await hash(plan) };
}
