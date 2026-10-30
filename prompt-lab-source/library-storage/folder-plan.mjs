import { canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { recordGroupId, selectionForRecord, withRecordGroups } from './record-state.mjs';
import { appendPromptRevision } from './edit-plan.mjs';
import { normalizeFolderRequest } from './folder-request.mjs';
import { planFolderTransaction } from './folder-transaction.mjs';
export { normalizeFolderRequest } from './folder-request.mjs';

const fail = (code, message) => { throw new LibraryError(code, message, 409); };

/** One publication owns all affected folder identities and prompt revisions. */
export async function planFolderMutation(pkg, inspected, value) {
  const request = normalizeFolderRequest(value);
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Folder command targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before this folder command.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review the current records before changing folders.');
  if (!inspected.sourceBindings.includes(request.sourceBinding)) fail('UNBOUND_SOURCE', 'Select a verified source identity for the folder.');
  const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
  const scope = evidence.scopes.find(scope => scope.bindings.includes(request.sourceBinding));
  if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Review complete source evidence before changing folders.');
  const sourceIdentity = scope.sourceIdentity, map = await buildVerifiedDomainMap(pkg, inspected);
  const byKey = new Map(map.records.map(row => [row.key, row]));
  const rows = domain => inspected.currentView.groups.filter(group => group.domain === domain && group.sourceIdentity === sourceIdentity && group.selected !== null)
    .map(group => ({ group, row: byKey.get(group.selected) }));
  const prompts = rows('prompts'), folders = rows('folders');
  const folderId = request.action === 'create' ? request.folder.id : request.folderId;
  const groupId = await recordGroupId(pkg.libraryId, 'folders', sourceIdentity, folderId);
  if (request.action === 'create' && (map.records.some(row => row.domain === 'folders' && row.origin.sourceIdentity === sourceIdentity && row.sourceId === folderId)
    || inspected.manifest.recordGroups?.some(group => group.id === groupId))) fail('IDENTITY_CONFLICT', 'This folder identity is already retained. Use a new ID.');
  const projection = { library: prompts.map(({ row }) => row.value), folders: folders.map(({ row }) => row.value), collections: rows('collections').map(({ row }) => row.value) };
  const { libraryId, expectedRevision, sourceBinding, changedAt, ...action } = request;
  const transaction = await planFolderTransaction(projection, { ...action, expectedStateHash: await hash(projection) });
  const groups = structuredClone(inspected.manifest.groups), changedPrompts = [];
  for (const { index } of transaction.changes.prompts) {
    const { group, row } = prompts[index], next = transaction.workspace.library[index];
    await appendPromptRevision(row.value, next, row.valueHash, { request, groupId: group.id }, changedAt);
    changedPrompts.push({ groupId: group.id, value: next });
  }
  const changedIds = new Set(transaction.changes.folders.map(folder => folder.id));
  const folderMutation = { action: request.action, folderId, sourceIdentity, changedAt };
  const workspace = { library: changedPrompts.map(prompt => prompt.value),
    folders: transaction.workspace.folders.filter(folder => changedIds.has(folder.id)), collections: transaction.workspace.collections,
    folderMutation: { ...folderMutation, baseRevision: pkg.head, groupId } };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const objects = { ...pkg.objects, [input.hash]: input.object, [source.hash]: source.object };
  const derivedSource = { source: source.hash, workspace: input.hash, binding: sourceBinding, baseRevision: pkg.head,
    groupId, previousMember: folders.find(({ row }) => row.sourceId === folderId)?.row.key ?? null, folderMutation };
  const derivedSources = [...(inspected.derivedSources ?? []), derivedSource];
  for (const [index, prompt] of changedPrompts.entries()) {
    const group = groups.find(group => group.id === prompt.groupId);
    group.selected = JSON.stringify([input.hash, 'library', index]); group.members.push(group.selected);
  }
  let manifest = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }],
    groups, recordGroups: inspected.manifest.recordGroups, objects });
  const changedMap = await buildVerifiedDomainMap({ ...pkg, objects }, { ...inspected, manifest, derivedSources });
  const owned = [...(manifest.recordGroups ?? [])], resolutions = retainedViewResolutions(inspected);
  for (const change of transaction.changes.folders) {
    const id = await recordGroupId(libraryId, 'folders', sourceIdentity, change.id);
    const row = change.afterHash === null ? folders.find(({ row }) => row.sourceId === change.id)?.row
      : changedMap.records.find(row => row.origin.object === input.hash && row.origin.replica === 'workspace' && row.domain === 'folders' && row.sourceId === change.id);
    if (!row) fail('FOLDER_TARGET_UNAVAILABLE', 'The changed folder record is unavailable.');
    const selection = selectionForRecord(row, id);
    if (change.afterHash === null) Object.assign(selection, { selected: null, selectedHash: null, inactiveReason: 'folder-removed' });
    const previous = owned.findIndex(group => group.id === id);
    if (previous < 0) owned.push(selection); else owned[previous] = selection;
    delete resolutions[id];
  }
  for (const group of inspected.currentView.groups) if (group.domain === 'collections' && group.sourceIdentity === sourceIdentity) delete resolutions[group.id];
  manifest = withRecordGroups(manifest, owned);
  const deletion = await applyDeletionPolicy(manifest, objects, inspected.sourceBindings, derivedSources);
  if (deletion.blocked.length) fail('DELETION_EVIDENCE_UNKNOWN', 'Source evidence prevents this folder change.');
  const currentViewPlan = await planCurrentView({ ...pkg, objects }, { ...inspected, manifest: deletion.manifest, derivedSources }, resolutions);
  const plan = { format: 'promptlab-folder-mutation-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    derivedSource, changes: transaction.changes, manifest: deletion.manifest, currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects: { [input.hash]: input.object, [source.hash]: source.object } };
}
