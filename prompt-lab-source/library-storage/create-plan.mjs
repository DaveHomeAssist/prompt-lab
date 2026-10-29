import { canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { normalizeCreateRequest } from './create-request.mjs';
import { validateChangedFields } from './edit-plan.mjs';
export { normalizeCreateRequest } from './create-request.mjs';

const fail = (code, message) => { throw new LibraryError(code, message, 409); };

/** Create one new logical prompt in an explicitly selected verified source scope. */
export async function planPromptCreate(pkg, inspected, value) {
  const request = normalizeCreateRequest(value);
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Creation targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before this creation.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review the current records before creating a prompt.');
  if (!inspected.sourceBindings.includes(request.sourceBinding)) fail('UNBOUND_SOURCE', 'Select an existing verified source identity for the new prompt.');
  const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
  const scope = evidence.scopes.find(row => row.bindings.includes(request.sourceBinding));
  if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Review complete deletion evidence before creating a prompt.');
  validateChangedFields(request.record, Object.keys(request.record).map(key => ({ path: [key] })), 'INVALID_CREATE');
  const createdId = `p-${(await hash({ libraryId: pkg.libraryId, creationId: request.creationId })).slice(7)}`;
  if (inspected.manifest.nodes.some(node => node.kind === 'prompt' && node.sourceId === createdId)
    || evidence.scopes.some(row => row.deletedIds.includes(createdId))) fail('IDENTITY_CONFLICT', 'This creation identity is already retained or permanently deleted. Use a new identity for a new prompt.');
  const next = { ...request.record, id: createdId, versions: [], createdAt: request.createdAt, updatedAt: request.createdAt,
    currentVersionId: `v-${(await hash(request)).slice(7)}` };
  if (scope.generation !== '0') next.metadata = { ...(next.metadata ?? {}), libraryGeneration: scope.generation };
  const groupId = await hash({ libraryId: pkg.libraryId, promptId: createdId });
  const workspace = { library: [next], recordCreate: { baseRevision: pkg.head, sourceBinding: request.sourceBinding, creationId: request.creationId, groupId } };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const objects = { ...pkg.objects, [input.hash]: input.object, [source.hash]: source.object };
  const derivedSource = { source: source.hash, workspace: input.hash, binding: request.sourceBinding,
    baseRevision: pkg.head, groupId, previousMember: null };
  const derivedSources = [...(inspected.derivedSources ?? []), derivedSource], member = JSON.stringify([input.hash, 'library', 0]);
  const groups = [...structuredClone(inspected.manifest.groups), { id: groupId, selected: member, members: [member] }];
  const selection = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }], groups, objects });
  const deletion = await applyDeletionPolicy(selection, objects, inspected.sourceBindings, derivedSources);
  if (deletion.blocked.length || deletion.manifest.groups.find(row => row.id === groupId).selected === null) {
    fail('DELETION_EVIDENCE_UNKNOWN', 'Deletion evidence prevents creating this prompt.');
  }
  const resolutions = retainedViewResolutions(inspected);
  const currentViewPlan = await planCurrentView({ ...pkg, objects }, { ...inspected, manifest: deletion.manifest, derivedSources }, resolutions);
  const plan = { format: 'promptlab-prompt-create-plan', schemaVersion: 1, request, createdId, source: source.hash, inputState: input.hash,
    derivedSource, manifest: deletion.manifest, currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects: { [input.hash]: input.object, [source.hash]: source.object } };
}
