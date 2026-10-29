import { canonical, hash, LibraryError, makeObject } from './contract.mjs';
import { buildLibrarySelection } from './import-plan.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { normalizeRecordRequest, recordDomains, recordIdField } from './record-request.mjs';
import { recordGroupId, selectionForRecord, withRecordGroups } from './record-state.mjs';
export { normalizeRecordRequest } from './record-request.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };
function validateFields(value, keys, domain) {
  const text = domain === 'execution-traces' ? ['name', 'provider', 'model', 'run_type', 'status', 'error', 'reason']
    : domain === 'experiments' ? ['label', 'keyInputSnapshot', 'notes']
    : domain === 'test-cases' ? ['title', 'input', 'notes'] : ['input', 'output', 'provider', 'model', 'mode', 'status'];
  for (const key of keys) {
    if ((text.includes(key) && typeof value[key] !== 'string')
      || (['variants', 'candidates', 'tags', 'messages', 'assertions'].includes(key) && !Array.isArray(value[key]))
      || (['metadata', 'outputs', 'outcome'].includes(key) && !object(value[key]))) fail('INVALID_RECORD_COMMAND', 'A changed record field has an unsupported value type.');
  }
}

/** One record changes; all previous occurrences remain immutable and addressable. */
export async function planRecordMutation(pkg, inspected, value) {
  const request = normalizeRecordRequest(value);
  if (pkg.libraryId !== request.libraryId) fail('WRONG_LIBRARY', 'Record command targets another library.');
  if (pkg.head !== request.expectedRevision) fail('REVISION_CONFLICT', 'The library changed before this record command.');
  if (!inspected.currentView || inspected.currentView.unresolved) fail('SELECTION_REQUIRED', 'Review the current records before changing them.');
  const map = await buildVerifiedDomainMap(pkg, inspected);
  let binding, sourceIdentity, sourceId, groupId, selected, next;
  if (request.action === 'create') {
    binding = request.sourceBinding;
    if (!inspected.sourceBindings.includes(binding)) fail('UNBOUND_SOURCE', 'Select a verified source identity for the record.');
    const evidence = await collectDeletionEvidence(pkg.objects, inspected.sourceBindings);
    const scope = evidence.scopes.find(scope => scope.bindings.includes(binding));
    if (!scope?.complete) fail('DELETION_EVIDENCE_UNKNOWN', 'Review complete source evidence before creating a record.');
    sourceIdentity = scope.sourceIdentity; sourceId = request.record[recordIdField(request.domain)];
    groupId = await recordGroupId(pkg.libraryId, request.domain, sourceIdentity, sourceId);
    if (map.records.some(row => row.domain === request.domain && row.origin.sourceIdentity === sourceIdentity && row.sourceId === sourceId)
      || inspected.manifest.recordGroups?.some(group => group.id === groupId)) fail('IDENTITY_CONFLICT', 'This record identity is already retained. Use a new ID for a new record.');
    next = structuredClone(request.record); validateFields(next, Object.keys(next), request.domain);
  } else {
    const group = inspected.currentView.groups.find(group => group.id === request.groupId && group.domain === request.domain);
    selected = map.records.find(row => row.key === group?.selected);
    if (!selected || !object(selected.value) || !selected.origin.binding || !selected.sourceId) fail('RECORD_TARGET_UNAVAILABLE', 'The selected record is inactive or lacks a verified identity.');
    if (selected.valueHash !== request.expectedRecordHash) fail('RECORD_CONFLICT', 'The selected record changed. Keep the draft and review it.');
    ({ sourceIdentity } = selected.origin); sourceId = selected.sourceId; binding = selected.origin.binding; groupId = group.id;
    next = structuredClone(selected.value);
    for (const update of request.updates ?? []) {
      let owner = next;
      for (const key of update.path.slice(0, -1)) {
        if (!Object.hasOwn(owner, key)) Object.defineProperty(owner, key, { value: {}, enumerable: true, writable: true, configurable: true });
        if (!object(owner[key])) fail('INVALID_RECORD_COMMAND', 'Nested updates must traverse object fields, not arrays or scalar values.');
        owner = owner[key];
      }
      Object.defineProperty(owner, update.path.at(-1), { value: structuredClone(update.value), enumerable: true, writable: true, configurable: true });
    }
    if (request.action === 'update') {
      validateFields(next, request.updates.map(update => update.path[0]), request.domain);
      if (canonical(next) === canonical(selected.value)) fail('NO_CHANGE', 'This command does not change the selected record.');
    }
  }
  const recordMutation = { action: request.action, domain: request.domain, sourceIdentity, sourceId, changedAt: request.changedAt };
  const workspace = { library: [], [recordDomains[request.domain]]: request.action === 'delete' ? [] : [next],
    recordMutation: { ...recordMutation, baseRevision: pkg.head, groupId, previousSelection: selected?.key ?? null } };
  const input = await makeObject('workspace', workspace), source = await makeObject('source', canonical(workspace));
  const objects = { ...pkg.objects, [input.hash]: input.object, [source.hash]: source.object };
  const derivedSource = { source: source.hash, workspace: input.hash, binding, baseRevision: pkg.head,
    groupId, previousMember: selected?.key ?? null, recordMutation };
  const derivedSources = [...(inspected.derivedSources ?? []), derivedSource];
  let manifest = await buildLibrarySelection({ sources: [...inspected.manifest.sources, { source: source.hash, workspace: input.hash }],
    groups: inspected.manifest.groups, recordGroups: inspected.manifest.recordGroups, objects });
  const changedMap = await buildVerifiedDomainMap({ ...pkg, objects }, { ...inspected, manifest, derivedSources });
  const row = request.action === 'delete' ? selected : changedMap.records.find(row => row.origin.object === input.hash
    && row.origin.replica === 'workspace' && row.domain === request.domain && row.sourceId === sourceId);
  if (!row) fail('RECORD_TARGET_UNAVAILABLE', 'The derived record is unavailable.');
  const group = selectionForRecord(row, groupId);
  manifest = withRecordGroups(manifest, [...(manifest.recordGroups ?? []).filter(group => group.id !== groupId), group]);
  const deletion = await applyDeletionPolicy(manifest, objects, inspected.sourceBindings, derivedSources);
  if (deletion.blocked.length) fail('DELETION_EVIDENCE_UNKNOWN', 'Source evidence prevents this record change.');
  const resolutions = retainedViewResolutions(inspected); delete resolutions[groupId];
  const currentViewPlan = await planCurrentView({ ...pkg, objects }, { ...inspected, manifest: deletion.manifest, derivedSources }, resolutions);
  const plan = { format: 'promptlab-record-mutation-plan', schemaVersion: 1, request, source: source.hash, inputState: input.hash,
    derivedSource, manifest: deletion.manifest, currentViewPlan, unresolved: currentViewPlan.unresolved, activationReady: false };
  return { plan: { ...plan, fingerprint: await hash(plan) }, objects: { [input.hash]: input.object, [source.hash]: source.object } };
}
