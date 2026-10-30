import { canonical, LibraryError, FORMAT, VERSION } from './contract.mjs';
import { planCurrentView, retainedViewResolutions } from './current-view.mjs';
import { buildVerifiedDomainMap } from './domain-map.mjs';
import { selectionForRecord } from './record-state.mjs';

const object = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const address = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

export function validateImportCurrentView(value) {
  if (!object(value) || Object.keys(value).length !== 1 || !object(value.resolutions)
    || Object.entries(value.resolutions).some(([key, selected]) => !address(key) || (selected !== null && !address(selected)))) {
    throw new LibraryError('INVALID_REQUEST', 'Import currentView requires resolutions containing record group and occurrence addresses.', 400);
  }
  canonical(value);
}

/** Add an app view to an import without replacing any retained source. */
export async function planImportedCurrentView({ current, manifest, baseRevision, objects, sourceBindings, derivedSources, incoming, currentView }) {
  validateImportCurrentView(currentView);
  if (!baseRevision || !current?.currentView || current.currentView.unresolved) {
    throw new LibraryError('SELECTION_REQUIRED', 'Atomic app import requires an already reviewed current Library.', 409);
  }
  const libraryId = current.currentView.libraryId;
  const pkg = { format: FORMAT, schemaVersion: VERSION, libraryId, head: baseRevision, objects };
  // Reimporting the exact same capture must not enumerate its occurrences
  // twice. Immutable ancestry records each binding once during inspection.
  const context = { ...current, manifest, sourceBindings: [...new Set(sourceBindings)], derivedSources };
  const candidates = await planCurrentView(pkg, context);
  const map = await buildVerifiedDomainMap(pkg, context), rows = new Map(map.records.map(row => [row.key, row]));
  const prior = new Map(current.currentView.groups.map(group => [group.id, group]));
  const promptIds = new Set(manifest.groups.map(group => group.id));
  const owned = new Map((manifest.recordGroups ?? []).map(group => [group.id, group]));
  const resolutions = retainedViewResolutions(current), recordReview = [];
  for (const id of Object.keys(currentView.resolutions)) {
    const group = candidates.groups.find(group => group.id === id);
    if (!group || promptIds.has(id) || group.decision === 'folder-projection') {
      throw new LibraryError('INVALID_RESOLUTIONS', 'Choose a listed related record; prompts and projected folders use their own review.', 409);
    }
    const selected = currentView.resolutions[id];
    if (selected !== null && !group.candidates.includes(selected)) throw new LibraryError('INVALID_RESOLUTIONS', 'Choose a listed occurrence or null.', 409);
  }
  for (const group of candidates.groups) {
    if (promptIds.has(group.id) || group.decision === 'folder-projection') continue;
    const previous = prior.get(group.id), previousHash = rows.get(previous?.selected)?.valueHash ?? null;
    const choices = group.candidates.map(key => {
      const row = rows.get(key), binding = objects[row.origin.binding]?.data;
      return { key, valueHash: row.valueHash, incoming: binding?.source === incoming.source && binding?.workspace === incoming.workspace };
    });
    const explicit = Object.hasOwn(currentView.resolutions, group.id);
    // Equal replicas do not demand another decision. Unequal or newly absent
    // captures must never silently lose to an older reviewed selection.
    const changed = previous && (choices.some(row => !previous.candidates.includes(row.key) && row.valueHash !== previousHash)
      || group.absentBindings.some(binding => !previous.absentBindings.includes(binding)));
    const selected = explicit ? currentView.resolutions[group.id] : previous?.selected;
    if (explicit && owned.has(group.id)) {
      const target = owned.get(group.id);
      if (target.inactiveReason === 'permanent-deletion' && selected !== null) {
        throw new LibraryError('INVALID_RESOLUTIONS', 'A permanent deletion cannot be undone by importing a retained occurrence.', 409);
      }
      if (selected === null) {
        target.retainedSelection = target.selected ?? target.retainedSelection;
        target.selected = null; target.selectedHash = null;
        if (target.inactiveReason !== 'permanent-deletion') target.inactiveReason = 'import-not-selected';
      } else Object.assign(target, selectionForRecord(rows.get(selected), group.id));
      if (selected !== null) delete target.inactiveReason;
    } else if (!owned.has(group.id) && selected !== undefined) resolutions[group.id] = selected;
    if (changed || explicit) recordReview.push({ id: group.id, domain: group.domain, previous: previous?.selected ?? null,
      previousHash, candidates: choices, selected: selected ?? null,
      decision: explicit ? 'reviewed' : owned.get(group.id)?.inactiveReason === 'permanent-deletion' ? 'deleted' : 'choice-required' });
  }
  const currentViewPlan = await planCurrentView(pkg, context, resolutions);
  return { currentViewPlan, recordReview,
    unresolved: currentViewPlan.unresolved + recordReview.filter(row => row.decision === 'choice-required').length };
}
