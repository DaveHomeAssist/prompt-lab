import { canonical, hash, LibraryError, readObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';

const sourcesFor = inspection => inspection.manifest?.sources ?? [{ source: inspection.sourceObject, workspace: inspection.stateObject }];

async function assertAncestor(objects, baseRevision, checkpointId) {
  if (checkpointId === baseRevision) throw new LibraryError('INVALID_CHECKPOINT', 'Select an earlier recovery checkpoint.', 409);
  const pending = [baseRevision], seen = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (id === checkpointId) return;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(await readObject(objects, id, 'commit')).parents);
  }
  throw new LibraryError('INVALID_CHECKPOINT', 'Checkpoint is not an ancestor of the current library.', 409);
}

async function ancestrySources(objects, revision) {
  const pending = [revision], seen = new Set(), sources = [];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const commit = await readObject(objects, id, 'commit');
    if (commit.operation !== 'restore') sources.push({ source: commit.source, workspace: commit.operation === 'import' ? commit.inputState : commit.state });
    pending.push(...commit.parents);
  }
  return sources;
}

/** Restore selections, never rewrite or remove archived sources and history. */
export async function planCheckpointRestore({ current, checkpoint, baseRevision, checkpointId, objects }) {
  current = structuredClone(current); checkpoint = structuredClone(checkpoint);
  await assertAncestor(objects, baseRevision, checkpointId);
  const currentManifest = current.manifest ?? await buildLibrarySelection({ sources: sourcesFor(current), objects });
  const checkpointManifest = checkpoint.manifest ?? await buildLibrarySelection({ sources: sourcesFor(checkpoint), objects });
  const sources = [...currentManifest.sources];
  for (const source of [...checkpointManifest.sources, ...await ancestrySources(objects, baseRevision)]) {
    if (!sources.some(item => canonical(item) === canonical(source))) sources.push(source);
  }
  const groups = structuredClone(checkpointManifest.groups);
  for (const group of currentManifest.groups) {
    const target = groups.find(item => item.id === group.id);
    if (target) target.members = [...new Set([...target.members, ...group.members])];
    else groups.push({ ...structuredClone(group), selected: null, retainedSelection: group.selected ?? group.retainedSelection,
      inactiveReason: group.inactiveReason === 'permanent-deletion' ? 'permanent-deletion' : 'checkpoint-not-selected' });
  }
  const selection = await buildLibrarySelection({ sources, groups, objects });
  const { manifest, ...deletionReview } = await applyDeletionPolicy(selection, objects, current.sourceBindings);
  const plan = { format: 'promptlab-library-restore-plan', schemaVersion: 1, baseRevision, checkpointId,
    source: checkpoint.sourceObject, manifest, deletionReview,
    counts: { selectedBefore: currentManifest.groups.filter(group => group.selected !== null).length,
      selectedAfter: manifest.groups.filter(group => group.selected !== null).length,
      suppressed: deletionReview.suppressed.length, retainedRecords: manifest.nodes.length, retainedSources: manifest.sources.length },
    unresolved: deletionReview.blocked.length, activationReady: false };
  return { ...plan, fingerprint: await hash(plan) };
}
