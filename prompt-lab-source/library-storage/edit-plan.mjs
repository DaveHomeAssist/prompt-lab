import { canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { normalizeEditRequest } from './edit-request.mjs';
export { normalizeEditRequest } from './edit-request.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };

export function validateChangedFields(value, updates, code = 'INVALID_EDIT') {
  const strings = new Set(['title', 'original', 'enhanced', 'prompt', 'content', 'notes', 'description', 'collection', 'folderId', 'kind', 'sourceNoteId']);
  for (const key of new Set(updates.map(update => update.path[0]))) {
    const field = value[key];
    if ((strings.has(key) && typeof field !== 'string')
      || (key === 'favorite' && typeof field !== 'boolean')
      || (key === 'tags' && (!Array.isArray(field) || field.some(item => typeof item !== 'string')))
      || (['variants', 'testCases', 'inputs'].includes(key) && (!Array.isArray(field) || field.some(item => !object(item))))
      || (key === 'metadata' && !object(field))
      || (['resultMeta', 'goldenResponse'].includes(key) && field !== null && !object(field))
      || (key === 'goldenThreshold' && (typeof field !== 'number' || field < 0 || field > 1))
      || (key === 'useCount' && (!Number.isSafeInteger(field) || field < 0))) fail(code, 'A changed prompt field has an unsupported value type.');
  }
}

/** Derive one successor from a reviewed prompt; never invent a source capture. */
export async function planPromptEdit(pkg, inspected, value) {
  const request = normalizeEditRequest(value);
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Edit targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before this edit.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review the current records before editing.');
  const group = inspected.manifest.groups.find(row => row.id === request.groupId);
  const currentGroup = inspected.currentView.groups.find(row => row.id === request.groupId && row.domain === 'prompts');
  if (!group || group.selected === null || !currentGroup?.selected) fail('EDIT_TARGET_UNAVAILABLE', 'The selected prompt is unavailable or inactive.');
  const map = await buildVerifiedDomainMap(pkg, inspected);
  const selected = map.records.find(row => row.key === currentGroup.selected);
  if (!selected || !object(selected.value) || !selected.origin.binding) fail('EDIT_TARGET_UNAVAILABLE', 'The selected prompt has no verified source identity.');
  if (selected.valueHash !== request.expectedRecordHash) fail('RECORD_CONFLICT', 'The selected prompt changed. Keep the draft and review it.');
  const previous = selected.value, next = structuredClone(previous);
  for (const update of request.updates) {
    let owner = next;
    for (const key of update.path.slice(0, -1)) {
      if (!Object.hasOwn(owner, key)) Object.defineProperty(owner, key, { value: {}, enumerable: true, writable: true, configurable: true });
      if (!object(owner[key])) fail('INVALID_EDIT', 'A nested update must traverse object fields, not arrays or scalar values.');
      owner = owner[key];
    }
    Object.defineProperty(owner, update.path.at(-1), { value: structuredClone(update.value), enumerable: true, writable: true, configurable: true });
  }
  validateChangedFields(next, request.updates);
  if (canonical(next.metadata?.libraryGeneration ?? null) !== canonical(previous.metadata?.libraryGeneration ?? null)) {
    fail('INVALID_EDIT', 'An edit cannot change the library deletion generation.');
  }
  if (canonical(next) === canonical(previous)) fail('NO_CHANGE', 'This edit does not change the selected prompt.');
  if (previous.versions !== undefined && !Array.isArray(previous.versions)) fail('INVALID_EDIT', 'Preserve and repair the invalid history before editing.');
  const { versions, ...snapshot } = structuredClone(previous);
  snapshot.id = previous.currentVersionId || `v-${selected.valueHash.slice(7)}`;
  next.versions = [...(versions ?? []), snapshot];
  next.currentVersionId = `v-${(await hash(request)).slice(7)}`;
  next.updatedAt = request.editedAt;
  if (Object.hasOwn(next, 'updated_at')) next.updated_at = request.editedAt;
  const workspace = { library: [next], recordEdit: { baseRevision: pkg.head, groupId: group.id,
    previousMember: group.selected, expectedRecordHash: selected.valueHash } };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const objects = { ...pkg.objects, [input.hash]: input.object, [source.hash]: source.object };
  const derivedSource = { source: source.hash, workspace: input.hash, binding: selected.origin.binding,
    baseRevision: pkg.head, groupId: group.id, previousMember: group.selected };
  const derivedSources = [...(inspected.derivedSources ?? []), derivedSource];
  const groups = structuredClone(inspected.manifest.groups), successor = groups.find(row => row.id === group.id);
  successor.selected = JSON.stringify([input.hash, 'library', 0]);
  successor.members.push(successor.selected);
  const selection = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }], groups, objects });
  const deletion = await applyDeletionPolicy(selection, objects, inspected.sourceBindings, derivedSources);
  if (deletion.blocked.length || deletion.manifest.groups.find(row => row.id === group.id).selected === null) {
    fail('EDIT_TARGET_UNAVAILABLE', 'Deletion evidence prevents editing this prompt.');
  }
  // Preserve every reviewed non-prompt selection. New source captures still need
  // their own review; an edit never silently rebases those decisions.
  const resolutions = retainedViewResolutions(inspected);
  const currentViewPlan = await planCurrentView({ ...pkg, objects }, { ...inspected, manifest: deletion.manifest, derivedSources }, resolutions);
  const plan = { format: 'promptlab-prompt-edit-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    derivedSource, manifest: deletion.manifest, currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects: { [input.hash]: input.object, [source.hash]: source.object } };
}
