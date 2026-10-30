import { canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { recordGroupId, selectionForRecord, withRecordGroups } from './record-state.mjs';
import { planPromptEdit } from './edit-plan.mjs';
import { planPromptLifecycle } from './lifecycle-plan.mjs';
import { normalizePackRequest } from './pack-request.mjs';
export { normalizePackRequest } from './pack-request.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
function mergeFields(previous, incoming) {
  const next = object(previous) ? structuredClone(previous) : {};
  for (const [key, value] of Object.entries(incoming)) Object.defineProperty(next, key, {
    value: object(value) ? mergeFields(next[key], value) : structuredClone(value), enumerable: true, writable: true, configurable: true,
  });
  return next;
}

/** Compose existing planners in memory; only the outer operation is published. */
export async function planPackMutation(pkg, inspected, value) {
  const request = normalizePackRequest(value);
  if (request.action === 'install') {
    const { planPackInstallation } = await import('./pack-install.mjs');
    return planPackInstallation(pkg, inspected, request);
  }
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Pack command targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before the pack review.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review the current records before changing a pack.');
  if (!inspected.sourceBindings.includes(request.sourceBinding)) fail('UNBOUND_SOURCE', 'Select a verified pack source identity.');
  const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
  const scope = evidence.scopes.find(scope => scope.bindings.includes(request.sourceBinding));
  if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Review complete source evidence before changing a pack.');
  const sourceIdentity = scope.sourceIdentity, map = await buildVerifiedDomainMap(pkg, inspected);
  const byKey = new Map(map.records.map(row => [row.key, row]));
  const selected = domain => inspected.currentView.groups.filter(group => group.domain === domain && group.sourceIdentity === sourceIdentity && group.selected !== null)
    .map(group => ({ group, row: byKey.get(group.selected) }));
  let registry = selected('packs').find(({ row }) => row.sourceId === request.packId);
  // Explicit publication may reactivate an uninstalled registry. Keep its
  // unmentioned metadata even while the record is absent from the current view.
  if (!registry && request.action === 'publish') {
    const retained = inspected.manifest.recordGroups?.find(group => group.domain === 'packs'
      && group.sourceIdentity === sourceIdentity && group.sourceId === request.packId);
    const row = retained && byKey.get(retained.retainedSelection);
    if (row) registry = { group: retained, row };
  }
  const marker = selected('loaded-packs').find(({ row }) => row.sourceId === request.packId);
  if (registry && (!object(registry.row.value) || (Object.hasOwn(registry.row.value, 'id') && registry.row.value.id !== request.packId))) {
    fail('IDENTITY_CONFLICT', 'The registry key and embedded pack identity disagree.');
  }
  const groupId = await recordGroupId(pkg.libraryId, 'packs', sourceIdentity, request.packId);
  if (request.action === 'publish' && (inspected.derivedSources ?? []).some(source => source.recordMutation?.action === 'delete'
    && source.recordMutation.domain === 'packs' && source.recordMutation.sourceIdentity === sourceIdentity && source.recordMutation.sourceId === request.packId)) {
    fail('IDENTITY_CONFLICT', 'This pack identity was permanently deleted. Use a new identity.');
  }
  const activePrompts = selected('prompts');
  const members = request.action === 'remove' ? activePrompts.filter(({ row }) => row.value.metadata?.packId === request.packId)
    : request.members.map(member => {
      const target = activePrompts.find(({ group }) => group.id === member.groupId);
      if (!target) fail('PACK_TARGET_UNAVAILABLE', 'A selected pack member is inactive or belongs to another source.');
      if (target.row.valueHash !== member.expectedRecordHash) fail('RECORD_CONFLICT', 'A selected pack member changed. Review it again.');
      return target;
    });
  if (request.action === 'remove' && !registry && !marker && !members.length) fail('PACK_TARGET_UNAVAILABLE', 'No selected pack records remain to remove.');
  const objects = {}, derivedSources = [];
  let context = inspected;
  function adopt(result) {
    Object.assign(objects, result.objects); derivedSources.push(result.plan.derivedSource);
    context = { ...context, manifest: result.plan.manifest, currentView: result.plan.currentViewPlan,
      derivedSources: [...(inspected.derivedSources ?? []), ...derivedSources] };
  }
  const changedMembers = [];
  for (const { group, row } of members) {
    if (request.action === 'publish') {
      const fields = { packId: request.packId, packName: request.pack.title, packSource: request.pack.source };
      if (Object.entries(fields).every(([key, value]) => row.value.metadata?.[key] === value)) continue;
      adopt(await planPromptEdit({ ...pkg, objects: { ...pkg.objects, ...objects } }, context, {
        libraryId: pkg.libraryId, expectedRevision: pkg.head, groupId: group.id, expectedRecordHash: row.valueHash,
        editedAt: request.changedAt, updates: Object.entries(fields).map(([key, value]) => ({ path: ['metadata', key], value })),
      }));
    } else adopt(await planPromptLifecycle({ ...pkg, objects: { ...pkg.objects, ...objects } }, context, {
      libraryId: pkg.libraryId, expectedRevision: pkg.head, groupId: group.id, expectedRecordHash: row.valueHash,
      changedAt: request.changedAt, action: 'trash', confirmPermanentDeletion: false,
    }));
    changedMembers.push(group.id);
  }
  const packMutation = { action: request.action, packId: request.packId, sourceIdentity, changedAt: request.changedAt };
  const workspace = { library: [], packMutation: { ...packMutation, baseRevision: pkg.head } };
  if (request.action === 'publish') workspace.packs = { [request.packId]: mergeFields(registry?.row.value, request.pack) };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  Object.assign(objects, { [input.hash]: input.object, [source.hash]: source.object });
  derivedSources.push({ source: source.hash, workspace: input.hash, binding: request.sourceBinding,
    baseRevision: pkg.head, groupId, previousMember: registry?.row.key ?? null, packMutation });
  const allObjects = { ...pkg.objects, ...objects }, allDerived = [...(inspected.derivedSources ?? []), ...derivedSources];
  let manifest = await buildLibrarySelection({ sources: [...context.manifest.sources, { source: source.hash, workspace: input.hash }],
    groups: context.manifest.groups, recordGroups: context.manifest.recordGroups, objects: allObjects });
  const changedMap = await buildVerifiedDomainMap({ ...pkg, objects: allObjects }, { ...context, manifest, derivedSources: allDerived });
  const owned = [...(manifest.recordGroups ?? [])], resolutions = retainedViewResolutions(context);
  const rows = request.action === 'publish'
    ? [{ row: changedMap.records.find(row => row.domain === 'packs' && row.origin.object === input.hash), id: groupId }]
    : [registry, marker].filter(Boolean).map(({ group, row }) => ({ row, id: group.id }));
  for (const { row, id } of rows) {
    if (!row) fail('PACK_TARGET_UNAVAILABLE', 'The changed pack record is unavailable.');
    const selection = selectionForRecord(row, id);
    if (request.action === 'remove') Object.assign(selection, { selected: null, selectedHash: null, inactiveReason: 'pack-uninstalled' });
    const index = owned.findIndex(group => group.id === id);
    if (index < 0) owned.push(selection); else owned[index] = selection;
    delete resolutions[id];
  }
  manifest = withRecordGroups(manifest, owned);
  const deletion = await applyDeletionPolicy(manifest, allObjects, inspected.sourceBindings, allDerived);
  if (deletion.blocked.length) fail('DELETION_EVIDENCE_UNKNOWN', 'Source evidence prevents this pack change.');
  const currentViewPlan = await planCurrentView({ ...pkg, objects: allObjects }, { ...context, manifest: deletion.manifest, derivedSources: allDerived }, resolutions);
  const plan = { format: 'promptlab-pack-mutation-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    derivedSources, changedMembers, manifest: deletion.manifest, currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects };
}
