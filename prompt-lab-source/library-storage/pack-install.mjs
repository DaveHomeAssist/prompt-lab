import { assertWorkspace, canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { recordGroupId, selectionForRecord, withRecordGroups } from './record-state.mjs';
import { appendPromptRevision, validateChangedFields } from './edit-plan.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const id = value => typeof value === 'string' && value.trim() && value.length <= 200;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
function mergeFields(previous, incoming) {
  const next = object(previous) ? structuredClone(previous) : {};
  for (const [key, value] of Object.entries(incoming)) Object.defineProperty(next, key, {
    value: object(value) ? mergeFields(Object.hasOwn(next, key) ? next[key] : undefined, value) : structuredClone(value),
    enumerable: true, writable: true, configurable: true,
  });
  return next;
}

/** One publication for reviewed pack content, registry and loaded marker. */
export async function planPackInstallation(pkg, inspected, request) {
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Pack installation targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before installation.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review current records before installing a pack.');
  if (!inspected.sourceBindings.includes(request.sourceBinding)) fail('UNBOUND_SOURCE', 'Select a verified installation destination.');
  const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
  const scope = evidence.scopes.find(row => row.bindings.includes(request.sourceBinding));
  if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Complete source evidence is required before installation.');
  let pack;
  try { pack = JSON.parse(request.sourceText); } catch { fail('INVALID_PACK_SOURCE', 'The pack must contain valid JSON.'); }
  if (!object(pack) || pack.type !== 'prompt-pack' || pack.id !== request.packId
    || typeof pack.title !== 'string' || !pack.title.trim() || typeof pack.version !== 'string' || !pack.version.trim()
    || !Array.isArray(pack.presets) || pack.presets.length > 1000
    || pack.presets.some(preset => !object(preset) || !id(preset.id))) {
    fail('INVALID_PACK_SOURCE', 'Review a prompt-pack with stable preset identities and complete records.');
  }
  canonical(pack);
  assertWorkspace({ ...pack, library: [] });
  if (request.choices.length !== pack.presets.length || request.choices.some(choice => choice.index >= pack.presets.length)) {
    fail('PACK_REVIEW_REQUIRED', 'Choose add, replace or skip for every preset.');
  }
  const map = await buildVerifiedDomainMap(pkg, inspected), byKey = new Map(map.records.map(row => [row.key, row]));
  const selected = domain => inspected.currentView.groups.filter(group => group.domain === domain
    && group.sourceIdentity === scope.sourceIdentity && group.selected !== null).map(group => ({ group, row: byKey.get(group.selected) }));
  const active = selected('prompts'), registry = selected('packs').find(({ row }) => row.sourceId === pack.id);
  const retainedRegistry = inspected.manifest.recordGroups?.find(group => group.domain === 'packs'
    && group.sourceIdentity === scope.sourceIdentity && group.sourceId === pack.id);
  const previousRegistry = registry?.row ?? byKey.get(retainedRegistry?.retainedSelection);
  if (previousRegistry && (!object(previousRegistry.value) || (Object.hasOwn(previousRegistry.value, 'id') && previousRegistry.value.id !== pack.id))) {
    fail('IDENTITY_CONFLICT', 'The registry key and embedded pack identity disagree.');
  }
  if ((inspected.derivedSources ?? []).some(source => source.recordMutation?.action === 'delete'
    && ['packs', 'loaded-packs'].includes(source.recordMutation.domain)
    && source.recordMutation.sourceIdentity === scope.sourceIdentity && source.recordMutation.sourceId === pack.id)) {
    fail('IDENTITY_CONFLICT', 'This pack identity was permanently deleted. Use a new identity.');
  }
  const groups = structuredClone(inspected.manifest.groups), changes = [], library = [];
  for (const choice of [...request.choices].sort((a,b) => a.index-b.index)) {
    if (choice.action === 'skip') continue;
    const incoming = pack.presets[choice.index];
    validateChangedFields(incoming, Object.keys(incoming).map(key => ({ path: [key] })), 'INVALID_PACK_SOURCE');
    if (incoming.versions !== undefined && (!Array.isArray(incoming.versions) || incoming.versions.some(version => !object(version)))) {
      fail('INVALID_PACK_SOURCE', 'Preserve and repair malformed preset history before installation.');
    }
    let target = null;
    if (choice.action === 'replace') {
      target = active.find(({ group }) => group.id === choice.groupId);
      if (!target) fail('PACK_TARGET_UNAVAILABLE', 'A replacement target is inactive or belongs to another source.');
      if (target.row.valueHash !== choice.expectedRecordHash) fail('RECORD_CONFLICT', 'A replacement target changed. Review the pack again.');
    } else if (inspected.manifest.nodes.some(node => node.kind === 'prompt' && node.sourceId === choice.promptId)
      || map.records.some(row => ['prompts', 'trash'].includes(row.domain) && row.sourceId === choice.promptId)
      || evidence.scopes.some(row => row.deletedIds.includes(choice.promptId))
      || (inspected.derivedSources ?? []).some(source => source.lifecycle?.action === 'delete' && source.lifecycle.sourceId === choice.promptId)) {
      fail('IDENTITY_CONFLICT', 'The new prompt identity is already retained or permanently deleted. Review an explicit replacement or use a new identity.');
    }
    const promptId = target?.row.sourceId ?? choice.promptId;
    const next = mergeFields(target?.row.value, incoming);
    next.id = promptId;
    if (!Object.hasOwn(incoming, 'original') && typeof incoming.prompt === 'string') next.original = incoming.prompt;
    if (!Object.hasOwn(incoming, 'enhanced') && typeof incoming.prompt === 'string') next.enhanced = incoming.prompt;
    next.metadata = { ...(next.metadata ?? {}), packId: pack.id, packName: pack.title,
      packSource: typeof pack.source === 'string' ? pack.source : 'imported', libraryGeneration: scope.generation };
    if (target) {
      await appendPromptRevision(target.row.value, next, target.row.valueHash, { request, index: choice.index }, request.changedAt);
      next.versions.push(...structuredClone(incoming.versions ?? []));
      if (Object.hasOwn(target.row.value, 'createdAt')) next.createdAt = target.row.value.createdAt;
    } else {
      next.versions = structuredClone(incoming.versions ?? []);
      next.createdAt ??= request.changedAt; next.updatedAt = request.changedAt;
      next.currentVersionId ??= `v-${(await hash({ request, index: choice.index })).slice(7)}`;
    }
    const groupId = target?.group.id ?? await hash({ libraryId: pkg.libraryId, promptId });
    changes.push({ groupId, target, index: library.length }); library.push(next);
  }
  const workspace = { library, packs: { [pack.id]: mergeFields(previousRegistry?.value, pack) }, loadedPacks: [pack.id] };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const archive = await makeObject('pack-source', request.sourceText);
  const objects = { [input.hash]: input.object, [source.hash]: source.object, [archive.hash]: archive.object };
  const groupId = await recordGroupId(pkg.libraryId, 'packs', scope.sourceIdentity, pack.id);
  const derivedSources = [{ source: source.hash, workspace: input.hash, binding: request.sourceBinding,
    baseRevision: pkg.head, groupId, previousMember: previousRegistry?.key ?? null,
    packMutation: { action: 'install', packId: pack.id, sourceIdentity: scope.sourceIdentity, changedAt: request.changedAt } }];
  for (const change of changes) {
    const member = JSON.stringify([input.hash, 'library', change.index]);
    const group = change.target && groups.find(group => group.id === change.groupId);
    if (group) { group.selected = member; group.members.push(member); }
    else groups.push({ id: change.groupId, selected: member, members: [member] });
  }
  const allObjects = { ...pkg.objects, ...objects }, allDerived = [...(inspected.derivedSources ?? []), ...derivedSources];
  let manifest = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }],
    groups, recordGroups: inspected.manifest.recordGroups, objects: allObjects });
  const context = { ...inspected, manifest, derivedSources: allDerived };
  const changedMap = await buildVerifiedDomainMap({ ...pkg, objects: allObjects }, context);
  const owned = [...(manifest.recordGroups ?? [])], resolutions = retainedViewResolutions(inspected);
  for (const domain of ['packs', 'loaded-packs']) {
    const row = changedMap.records.find(row => row.domain === domain && row.origin.object === input.hash);
    const id = await recordGroupId(pkg.libraryId, domain, scope.sourceIdentity, pack.id);
    const selection = selectionForRecord(row, id), index = owned.findIndex(group => group.id === id);
    if (index < 0) owned.push(selection); else owned[index] = selection;
    delete resolutions[id];
  }
  manifest = withRecordGroups(manifest, owned);
  const deletion = await applyDeletionPolicy(manifest, allObjects, inspected.sourceBindings, allDerived);
  if (deletion.blocked.length || changes.some(change => deletion.manifest.groups.find(group => group.id === change.groupId).selected === null)) {
    fail('DELETION_EVIDENCE_UNKNOWN', 'Source deletion evidence prevents this installation.');
  }
  const currentViewPlan = await planCurrentView({ ...pkg, objects: allObjects }, { ...context, manifest: deletion.manifest }, resolutions);
  const plan = { format: 'promptlab-pack-mutation-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    archiveSource: archive.hash, derivedSources, changedMembers: changes.map(change => change.groupId), manifest: deletion.manifest,
    currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects };
}
