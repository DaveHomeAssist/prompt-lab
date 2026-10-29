import { hash, LibraryError } from './contract.mjs';
import { recordDomains } from './record-request.mjs';

export const recordGroupId = (libraryId, domain, sourceIdentity, sourceId) => hash([libraryId, domain, sourceIdentity, sourceId]);
export const withRecordGroups = (manifest, groups) => groups?.length
  ? { ...manifest, recordGroups: structuredClone(groups).sort((a, b) => a.id.localeCompare(b.id)) } : manifest;

export function suppressDeletedRecords(manifest, derivedSources) {
  if (!manifest.recordGroups) return;
  const deleted = new Map(derivedSources.filter(source => source.recordMutation?.action === 'delete')
    .map(source => [source.groupId, source.recordMutation]));
  for (const group of manifest.recordGroups) {
    const deletion = deleted.get(group.id);
    if (!deletion) continue;
    if (deletion.domain !== group.domain || deletion.sourceIdentity !== group.sourceIdentity || deletion.sourceId !== group.sourceId) {
      throw new LibraryError('INVALID_ANCESTRY', 'Record deletion differs from its retained identity.', 409);
    }
    group.retainedSelection = group.selected ?? group.retainedSelection;
    group.selected = null; group.selectedHash = null; group.inactiveReason = 'permanent-deletion';
  }
}

export function selectionForRecord(row, id) {
  return { id, domain: row.domain, sourceIdentity: row.origin.sourceIdentity, sourceId: row.sourceId,
    selected: row.key, selectedHash: row.valueHash, retainedSelection: row.key };
}

/** Recover a branch's effective selection for a command-owned record identity. */
export async function effectiveRecordGroup(pkg, inspected, template) {
  if (!inspected.manifest) {
    const { buildLibrarySelection } = await import('./import-plan.mjs');
    inspected = { ...inspected, stateKind: 'library-state', manifest: await buildLibrarySelection({
      sources: [{ source: inspected.sourceObject, workspace: inspected.stateObject }], objects: pkg.objects }) };
  }
  const owned = inspected.manifest?.recordGroups?.find(group => group.id === template.id);
  if (owned) return structuredClone(owned);
  const { planCurrentView } = await import('./current-view.mjs');
  const view = inspected.currentView ?? (inspected.manifest ? await planCurrentView(pkg, inspected) : null);
  const group = view?.groups.find(group => group.id === template.id);
  if (!group) return null;
  if (group.decision === 'unresolved' || view.blocked.length) throw new LibraryError('SELECTION_REQUIRED', 'Review the branch or checkpoint records before reconciling their changes.', 409);
  const { buildVerifiedDomainMap } = await import('./domain-map.mjs');
  const map = await buildVerifiedDomainMap(pkg, inspected);
  const row = map.records.find(row => row.key === (group.selected ?? group.candidates[0]));
  if (!row || (!Object.hasOwn(recordDomains, row.domain) && row.domain !== 'folders')) throw new LibraryError('RECORD_TARGET_UNAVAILABLE', 'The retained record is unavailable.', 409);
  const result = selectionForRecord(row, group.id);
  return group.selected === null ? { ...result, selected: null, selectedHash: null, inactiveReason: 'checkpoint-not-selected' } : result;
}
