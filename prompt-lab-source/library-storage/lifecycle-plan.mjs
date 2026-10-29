import { canonical, hash, LibraryError, makeObject, readObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { normalizeLifecycleRequest } from './lifecycle-request.mjs';
export { normalizeLifecycleRequest } from './lifecycle-request.mjs';

const fail = (code, message) => { throw new LibraryError(code, message, 409); };

/** Change the selected location while retaining every original record and history. */
export async function planPromptLifecycle(pkg, inspected, value) {
  const request = normalizeLifecycleRequest(value);
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Lifecycle change targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before this lifecycle review.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review current records before changing their lifecycle.');
  const target = inspected.currentView.groups.find(row => row.id === request.groupId);
  if (!target?.selected || target.domain !== (request.action === 'trash' ? 'prompts' : 'trash')) {
    fail('LIFECYCLE_TARGET_UNAVAILABLE', 'Select an active prompt to move to Trash, or a Trash record to restore or permanently delete.');
  }
  const map = await buildVerifiedDomainMap(pkg, inspected), selected = map.records.find(row => row.key === target.selected);
  if (!selected?.origin.binding || !selected.origin.sourceIdentity || typeof selected.sourceId !== 'string' || !selected.sourceId
    || !selected.value || Object.getPrototypeOf(selected.value) !== Object.prototype) fail('LIFECYCLE_TARGET_UNAVAILABLE', 'The selected record needs a verified identity.');
  if (selected.valueHash !== request.expectedRecordHash) fail('RECORD_CONFLICT', 'The selected record changed. Review its current content.');
  const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
  const scope = evidence.scopes.find(row => row.bindings.includes(selected.origin.binding));
  if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Review complete source deletion evidence first.');
  let group = inspected.manifest.groups.find(row => row.id === request.groupId);
  if (!group) {
    // Imported Trash is not an import prompt group. Do not silently merge it
    // with a different retained prompt sharing the same source-scoped identity.
    const nodes = new Map(inspected.manifest.nodes.map(node => [node.key, node]));
    const workspaces = new Set([...scope.workspaces, ...(inspected.derivedSources ?? []).filter(row => scope.bindings.includes(row.binding)).map(row => row.workspace)]);
    const matches = inspected.manifest.groups.filter(row => row.members.some(member => {
      const node = nodes.get(member); return node?.sourceId === selected.sourceId && workspaces.has(node.source);
    }));
    const id = await hash({ libraryId: pkg.libraryId, restoredTrash: [selected.origin.sourceIdentity, selected.sourceId] });
    if (matches.length && !(matches.length === 1 && matches[0].id === id && matches[0].selected === null
      && matches[0].inactiveReason === 'checkpoint-not-selected')) fail('IDENTITY_CONFLICT', 'This Trash identity also belongs to a retained prompt. Reconcile that identity before changing its lifecycle.');
    group = matches[0] ?? { id, selected: null, members: [] };
  }
  const next = structuredClone(selected.value);
  if (request.action === 'trash') next.deletedAt = request.changedAt;
  if (request.action === 'restore') {
    // Undo only the deletion timestamp introduced by our Trash command.
    // Null and absent fields are distinct in existing exports; preserve both,
    // and retain tombstoneVersion, which this command never changes.
    const trashed = (inspected.derivedSources ?? []).find(row => row.workspace === selected.origin.object
      && row.binding === selected.origin.binding && row.lifecycle?.action === 'trash');
    const previousNode = trashed && inspected.manifest.nodes.find(row => row.key === trashed.previousMember);
    if (previousNode) {
      const previous = previousNode.path.reduce((value, key) => value[key], await readObject(pkg.objects, previousNode.source, 'workspace'));
      if (Object.hasOwn(previous, 'deletedAt')) next.deletedAt = structuredClone(previous.deletedAt);
      else delete next.deletedAt;
    } else if (Object.hasOwn(next, 'deletedAt')) next.deletedAt = null;
  }
  const lifecycle = { action: request.action, sourceIdentity: selected.origin.sourceIdentity, sourceId: selected.sourceId };
  const workspace = { library: [next], recordLifecycle: { baseRevision: pkg.head, groupId: group.id,
    selectedRecord: selected.key, expectedRecordHash: selected.valueHash, ...lifecycle, changedAt: request.changedAt } };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const objects = { ...pkg.objects, [input.hash]: input.object, [source.hash]: source.object };
  const derivedSource = { source: source.hash, workspace: input.hash, binding: selected.origin.binding,
    baseRevision: pkg.head, groupId: group.id, previousMember: group.selected, lifecycle };
  const derivedSources = [...(inspected.derivedSources ?? []), derivedSource], member = JSON.stringify([input.hash, 'library', 0]);
  const successor = { ...structuredClone(group), selected: member, members: [...group.members, member], lifecycle: request.action === 'restore' ? 'active' : request.action === 'delete' ? 'deleted' : 'trash' };
  delete successor.retainedSelection; delete successor.inactiveReason;
  const groups = inspected.manifest.groups.filter(row => row.id !== group.id).map(row => structuredClone(row)); groups.push(successor);
  const selection = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }], groups, objects });
  const deletion = await applyDeletionPolicy(selection, objects, inspected.sourceBindings, derivedSources);
  if (deletion.blocked.length) fail('DELETION_EVIDENCE_UNKNOWN', 'Incomplete deletion evidence prevents this lifecycle change.');
  if (request.action !== 'delete' && deletion.manifest.groups.find(row => row.id === group.id).selected === null) {
    fail('LIFECYCLE_TARGET_UNAVAILABLE', 'Retained permanent-deletion evidence prevents this operation.');
  }
  const currentViewPlan = await planCurrentView({ ...pkg, objects }, { ...inspected, manifest: deletion.manifest, derivedSources }, retainedViewResolutions(inspected));
  const plan = { format: 'promptlab-prompt-lifecycle-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    derivedSource, manifest: deletion.manifest, currentViewPlan, retainedRecoveryContent: true,
    unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects: { [input.hash]: input.object, [source.hash]: source.object } };
}
