import { canonical, hash, LibraryError, readObject, FORMAT, VERSION } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { effectiveRecordGroup } from './record-state.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';

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
    if (!['restore', 'reconcile', 'select', 'edit', 'create', 'lifecycle', 'record', 'folder', 'pack'].includes(commit.operation)) sources.push({ source: commit.source, workspace: commit.operation === 'import' ? commit.inputState : commit.state });
    pending.push(...commit.parents);
  }
  return sources;
}

/** Restore selections, never rewrite or remove archived sources and history. */
export async function planCheckpointRestore({ current, checkpoint, baseRevision, checkpointId, objects, currentView }) {
  if (currentView !== undefined && currentView !== 'checkpoint') throw new LibraryError('INVALID_REQUEST', 'Restore currentView must select checkpoint.', 400);
  if (currentView && (!current.currentView || current.currentView.unresolved || !checkpoint.currentView || checkpoint.currentView.unresolved)) {
    throw new LibraryError('SELECTION_REQUIRED', 'Choose a checkpoint with a complete reviewed app view.', 409);
  }
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
  const recordGroups = [], libraryId = (await readObject(objects, baseRevision, 'commit')).libraryId;
  const ids = new Map([...(currentManifest.recordGroups ?? []), ...(checkpointManifest.recordGroups ?? [])].map(group => [group.id, group]));
  for (const group of ids.values()) {
    const restored = await effectiveRecordGroup({ format: FORMAT, schemaVersion: VERSION, libraryId, head: checkpointId, objects }, checkpoint, group);
    recordGroups.push(restored ?? { ...group, selected: null, selectedHash: null, retainedSelection: group.selected ?? group.retainedSelection,
      inactiveReason: 'checkpoint-not-selected' });
  }
  const selection = await buildLibrarySelection({ sources, groups, recordGroups, objects });
  const { manifest, ...deletionReview } = await applyDeletionPolicy(selection, objects, current.sourceBindings, current.derivedSources);
  let currentViewPlan = null;
  if (currentView) {
    const pkg = { format: FORMAT, schemaVersion: VERSION, libraryId, head: baseRevision, objects }, context = { ...current, manifest };
    const candidates = await planCurrentView(pkg, context);
    // Restoring earlier selections must also deactivate records introduced
    // later. Command-owned groups already carry their restored selections.
    const resolutions = retainedViewResolutions({ ...context, currentView: candidates });
    for (const id of Object.keys(resolutions)) resolutions[id] = checkpoint.currentView.groups.find(group => group.id === id)?.selected ?? null;
    currentViewPlan = await planCurrentView(pkg, context, resolutions);
  }
  const plan = { format: 'promptlab-library-restore-plan', schemaVersion: 1, baseRevision, checkpointId,
    source: checkpoint.sourceObject, manifest, deletionReview,
    counts: { selectedBefore: currentManifest.groups.filter(group => group.selected !== null).length,
      selectedAfter: manifest.groups.filter(group => group.selected !== null).length,
      suppressed: deletionReview.suppressed.length, retainedRecords: manifest.nodes.length, retainedSources: manifest.sources.length },
    unresolved: deletionReview.blocked.length + (currentViewPlan?.unresolved ?? 0), activationReady: false,
    ...(currentView ? { currentView, currentViewPlan } : {}) };
  return { ...plan, fingerprint: await hash(plan) };
}
