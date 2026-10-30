import { canonical, hash, inspectPackage, LibraryError } from './contract.mjs';
import { buildVerifiedDomainMap, validateDomainPage } from './domain-map.mjs';
import { applyDeletionPolicy } from './selection-policy.mjs';
import { projectFolderCollections } from './folder-projection.mjs';
import { scratchCommandSources, validateScratchSelection, projectScratchContainer } from './scratch-state.mjs';
import { recordGroupId } from './record-state.mjs';

const record = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const rootDomains = new Set(['prompts', 'trash', 'collections', 'folders', 'packs', 'loaded-packs', 'scratch',
  'scratch-legacy', 'experiments', 'evaluations', 'test-cases', 'execution-traces', 'assets', 'drafts', 'recovery', 'backups']);
const singletonDomains = new Set(['scratch', 'recovery']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function retainedViewResolutions(inspected) {
  const owned = new Set([...inspected.manifest.groups, ...(inspected.manifest.recordGroups ?? [])].map(group => group.id));
  return Object.fromEntries(inspected.currentView.groups.filter(group => !owned.has(group.id) && group.decision !== 'folder-projection').map(group => [group.id, group.selected]));
}

/** Review current records without rewriting any source values or addresses. */
export async function reviewCurrentView(pkg, resolutions = {}) {
  pkg = structuredClone(pkg); resolutions = structuredClone(resolutions);
  return planCurrentView(pkg, await inspectPackage(pkg), resolutions);
}

// Only used with an already verified parent while inspecting immutable commits.
export async function planCurrentView(pkg, inspected, resolutions = {}) {
  if (!record(resolutions)) throw new LibraryError('INVALID_RESOLUTIONS', 'Current-view choices must be an object.');
  canonical(resolutions); resolutions = structuredClone(resolutions);
  if (inspected.stateKind !== 'library-state') throw new LibraryError('IMPORT_REQUIRED', 'Review the imported library before selecting its current view.', 409);
  const map = await buildVerifiedDomainMap(pkg, inspected);
  const deletion = await applyDeletionPolicy(inspected.manifest, pkg.objects, inspected.sourceBindings, inspected.derivedSources);
  const blocked = [...map.issues, ...deletion.blocked], byKey = new Map(map.records.map(row => [row.key, row]));
  const scratchSources = scratchCommandSources(inspected);
  const roots = map.records.filter(row => (rootDomains.has(row.domain)
    && (row.parent === null || byKey.get(row.parent)?.domain === 'source-stores'))
    || (row.domain === 'scratch-notes' && scratchSources.has(row.origin.sourceIdentity)));
  const bindingsBySource = new Map();
  for (const store of map.stores) if (store.origin.binding && store.origin.sourceIdentity) {
    if (!bindingsBySource.has(store.origin.sourceIdentity)) bindingsBySource.set(store.origin.sourceIdentity, new Set());
    bindingsBySource.get(store.origin.sourceIdentity).add(store.origin.binding);
  }
  const groups = [], groupByKey = new Map(), rootGroups = new Map();
  const nodes = new Map(deletion.manifest.nodes.map(node => [node.key, node]));
  const promptGroups = deletion.manifest.groups;
  const sourceFor = binding => pkg.objects[binding]?.data.workspace;
  for (const input of promptGroups) {
    const candidates = roots.filter(row => row.domain === 'prompts' && row.origin.replica === 'workspace'
      && input.members.some(key => { const node = nodes.get(key); return node?.source === row.origin.object && canonical(node.path) === canonical(row.origin.path); }));
    const selected = input.selected === null ? null : candidates.find(row => {
      const node = nodes.get(input.selected); return node?.source === row.origin.object && canonical(node.path) === canonical(row.origin.path);
    });
    if (input.selected !== null && !selected) blocked.push({ code: 'SELECTED_PROMPT_UNAVAILABLE', groupId: input.id });
    const group = { id: input.id, domain: input.lifecycle === 'trash' ? 'trash' : 'prompts', sourceIdentity: selected?.origin.sourceIdentity ?? null,
      candidates: candidates.map(row => row.key).sort(), absentBindings: [], selected: selected?.key ?? null,
      decision: input.selected === null ? 'deleted' : 'import' };
    groups.push(group); groupByKey.set(group.id, group);
    for (const row of candidates) rootGroups.set(row.key, group.id);
  }
  for (const row of roots.filter(row => row.domain === 'prompts' && !rootGroups.has(row.key))) {
    const workspace = sourceFor(row.origin.binding);
    // The bound local Library array is byte-equivalent to the workspace array.
    // Its index disambiguates even intentionally kept duplicate IDs/content.
    const boundPath = row.origin.replica === 'local-content/pl2-library' && row.origin.decodedPath?.length === 1
      ? ['library', row.origin.decodedPath[0]] : null;
    const matches = promptGroups.filter(group => group.members.some(key => {
      const node = nodes.get(key);
      return node?.hash === row.valueHash && node.sourceId === row.sourceId
        && (!boundPath || (node.source === workspace && canonical(node.path) === canonical(boundPath)))
        && (node.source === workspace || roots.some(other => other.origin.replica === 'workspace'
          && other.origin.object === node.source && other.origin.sourceIdentity === row.origin.sourceIdentity));
    }));
    if (!matches.length && [...nodes.values()].some(node => node.kind === 'prompt' && node.path[0] === 'library'
      && node.source === workspace && node.hash === row.valueHash && node.sourceId === row.sourceId
      && !promptGroups.some(group => group.members.includes(node.key)))) continue;
    if (matches.length !== 1) { blocked.push({ code: 'PROMPT_REPLICA_REQUIRES_IMPORT', key: row.key }); continue; }
    const group = groupByKey.get(matches[0].id);
    group.candidates.push(row.key); group.candidates.sort(); rootGroups.set(row.key, group.id);
  }
  for (const row of roots.filter(row => row.domain !== 'prompts')) {
    if (!row.origin.sourceIdentity) blocked.push({ code: 'UNBOUND_RECORD', key: row.key });
    const identity = singletonDomains.has(row.domain) ? 'singleton'
      : typeof row.sourceId === 'string' && row.sourceId ? row.sourceId
      : ['drafts', 'scratch-legacy'].includes(row.domain) ? [row.origin.replica, row.origin.path, row.origin.decodedPath]
      : ['assets', 'backups'].includes(row.domain) ? row.valueHash : null;
    if (identity === null && !row.commandGroupId) blocked.push({ code: 'MISSING_RECORD_ID', key: row.key });
    const groupId = row.commandGroupId ?? await hash([pkg.libraryId, row.domain, row.origin.sourceIdentity, identity ?? row.key]);
    let group = groupByKey.get(groupId);
    if (!group) {
      group = { id: groupId, domain: row.domain, sourceIdentity: row.origin.sourceIdentity,
        candidates: [], absentBindings: [], selected: null, decision: 'unresolved' };
      groups.push(group); groupByKey.set(groupId, group);
    }
    group.candidates.push(row.key); rootGroups.set(row.key, group.id);
  }
  for (const group of groups) {
    if (promptGroups.some(input => input.id === group.id)) {
      if (Object.hasOwn(resolutions, group.id)) throw new LibraryError('INVALID_RESOLUTIONS', 'Prompt selection is owned by import and reconciliation.', 409);
      continue;
    }
    group.candidates.sort();
    const rows = group.candidates.map(key => byKey.get(key)), present = new Set(rows.map(row => row.origin.binding));
    group.absentBindings = [...(bindingsBySource.get(group.sourceIdentity) ?? [])].filter(binding => !present.has(binding)).sort();
    const owned = deletion.manifest.recordGroups?.find(input => input.id === group.id);
    if (owned) {
      if (Object.hasOwn(resolutions, group.id)) throw new LibraryError('INVALID_RESOLUTIONS', 'Record commands and reconciliation own this selection.', 409);
      const retained = byKey.get(owned.selected ?? owned.retainedSelection);
      if (!retained || !group.candidates.includes(retained.key) || retained.domain !== owned.domain
        || retained.origin.sourceIdentity !== owned.sourceIdentity || retained.sourceId !== owned.sourceId
        || (owned.selected !== null && retained.valueHash !== owned.selectedHash)) blocked.push({ code: 'RECORD_SELECTION_UNAVAILABLE', groupId: group.id });
      group.selected = owned.selected; group.decision = owned.selected === null ? 'deleted' : 'command';
      continue;
    }
    if (Object.hasOwn(resolutions, group.id)) {
      const selected = resolutions[group.id];
      if (selected !== null && !group.candidates.includes(selected)) throw new LibraryError('INVALID_RESOLUTIONS', 'Select a listed source occurrence or null to keep it inactive.');
      group.selected = selected; group.decision = 'reviewed';
    } else if (new Set(rows.map(row => row.valueHash)).size === 1 && !group.absentBindings.length) {
      group.selected = group.candidates[0]; group.decision = 'automatic';
    }
    const selected = byKey.get(group.selected);
    if (selected?.domain === 'trash') {
      const scope = deletion.evidence.scopes.find(scope => scope.sourceIdentity === group.sourceIdentity);
      const generation = selected.value?.metadata?.libraryGeneration ?? '0';
      if (typeof generation !== 'string' || (generation !== '0' && !/^\d{16}:[\da-f-]+$/.test(generation))) {
        blocked.push({ code: 'INVALID_RECORD_GENERATION', key: selected.key });
      } else if (scope && (scope.deletedIds.includes(selected.sourceId) || generation !== scope.generation)) {
        group.selected = null; group.decision = 'deleted';
      }
    }
    // Retire all old Trash replicas even if competing captures had left this
    // group unresolved. Only the lifecycle-owned prompt group selects a copy.
    if (group.domain === 'trash' && promptGroups.some(input => input.lifecycle && input.inactiveReason !== 'checkpoint-not-selected'
      && (inspected.derivedSources ?? []).some(source => source.groupId === input.id
        && source.lifecycle?.sourceIdentity === group.sourceIdentity && source.lifecycle.sourceId === rows[0]?.sourceId))) {
      group.selected = null; group.decision = 'deleted';
    }
    // Never expose an older Scratch container that resurrects a retained
    // tombstone. Explicit restore remains a separate command, not a read choice.
    if (selected?.domain === 'scratch' && record(selected.value) && !scratchSources.has(group.sourceIdentity)) {
      const deleted = new Set();
      for (const row of rows) {
        if (!record(row.value)) continue;
        if (row.value.tombstones !== undefined && !record(row.value.tombstones)) blocked.push({ code: 'INVALID_SCRATCH_TOMBSTONES', key: row.key });
        else for (const id of Object.keys(row.value.tombstones ?? {})) deleted.add(id);
      }
      if (Array.isArray(selected.value.pads) && selected.value.pads.some(pad => deleted.has(pad?.id))) blocked.push({ code: 'SCRATCH_DELETION_CONFLICT', key: selected.key });
    }
  }
  for (const group of deletion.manifest.recordGroups ?? []) if (!groupByKey.has(group.id)) blocked.push({ code: 'RECORD_SELECTION_UNAVAILABLE', groupId: group.id });
  for (const key of Object.keys(resolutions)) if (!groupByKey.has(key)) throw new LibraryError('INVALID_RESOLUTIONS', 'Choice names an unavailable current-view group.');
  projectFolderCollections(groups, byKey, inspected, resolutions, blocked);
  validateScratchSelection(groups, map, inspected, blocked);
  const selectedRoots = new Set(groups.flatMap(group => group.selected === null ? [] : [group.selected]));
  const rootFor = row => { let current = row; while (current.parent && !rootGroups.has(current.key)) current = byKey.get(current.parent); return current.key; };
  const selected = map.records.filter(row => selectedRoots.has(rootFor(row))).map(row => row.key).sort();
  const selectedKeys = new Set(selected);
  const retained = map.records.map(row => row.key).filter(key => !selectedKeys.has(key)).sort();
  const uniqueBlocked = [...new Map(blocked.map(issue => [canonical(issue), issue])).values()];
  groups.sort((a, b) => compare(a.id, b.id));
  const plan = { format: 'promptlab-current-view-plan', schemaVersion: 1, libraryId: pkg.libraryId, baseRevision: pkg.head,
    resolutions, groups, selected, retained, blocked: uniqueBlocked,
    unresolved: groups.filter(group => group.decision === 'unresolved').length + uniqueBlocked.length,
    // Native/app activation additionally requires migration parity, ownership,
    // durable outbox and supported-surface acceptance outside this read model.
    activationReady: false };
  return { ...plan, fingerprint: await hash(plan) };
}

export async function pageCurrentView(pkg, inspected, { domain, cursor = '0', limit = 100 } = {}) {
  validateDomainPage({ domain, cursor, limit });
  if (!inspected.currentView) throw new LibraryError('SELECTION_REQUIRED', 'Review the current records for this revision before reading them.', 409);
  const map = await buildVerifiedDomainMap(pkg, inspected), selected = new Set(inspected.currentView.selected);
  const locations = new Map(inspected.currentView.groups.filter(group => group.selected !== null).map(group => [group.selected, group.domain]));
  const selectedRows = map.records.filter(row => selected.has(row.key)).map(row => locations.has(row.key) && locations.get(row.key) !== row.domain
    ? { ...row, domain: locations.get(row.key) } : row).filter(row => domain === undefined || row.domain === domain);
  const rows = await Promise.all(selectedRows.map(async row => row.domain === 'scratch-notes'
    ? { ...row, commandGroupId: await recordGroupId(pkg.libraryId, row.domain, row.origin.sourceIdentity, row.sourceId) }
    : projectScratchContainer(row, map, inspected)));
  const offset = Number(cursor);
  return { format: 'promptlab-current-view-page', schemaVersion: 1, libraryId: pkg.libraryId, revision: pkg.head,
    view: 'reviewed', activationReady: false, domain: domain ?? null, total: rows.length,
    groups: inspected.currentView.groups, items: rows.slice(offset, offset + limit),
    retainedCount: inspected.currentView.retained.length,
    nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
}
