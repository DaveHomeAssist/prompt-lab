import { canonical, LibraryError, readObject } from './contract.mjs';
import { collectDeletionEvidence } from './source-binding.mjs';
import { suppressDeletedRecords } from './record-state.mjs';

/** Retain every group and member while excluding permanently deleted selections. */
export async function applyDeletionPolicy(input, objects, sourceBindings, derivedSources = []) {
  const manifest = structuredClone(input);
  sourceBindings = [...new Set(sourceBindings)].sort();
  const evidence = await collectDeletionEvidence(objects, sourceBindings);
  // Only verified command ancestry supplies derived sources. Preserve a
  // deletion across checkpoints and both sides of branch reconciliation.
  for (const derived of derivedSources.filter(row => row.lifecycle?.action === 'delete')) {
    const scope = evidence.scopes.find(row => row.bindings.includes(derived.binding));
    if (!scope || scope.sourceIdentity !== derived.lifecycle.sourceIdentity) throw new LibraryError('INVALID_ANCESTRY', 'Lifecycle deletion has no matching verified source scope.');
    scope.deletedIds = [...new Set([...scope.deletedIds, derived.lifecycle.sourceId])].sort();
  }
  const blocked = [], suppressed = [], byWorkspace = new Map(), workspaces = new Map();
  const nodes = new Map(manifest.nodes.map(node => [node.key, node]));
  for (const source of manifest.sources) {
    if (byWorkspace.has(source.workspace)) continue;
    const inherited = derivedSources.filter(item => item.workspace === source.workspace).map(item => item.binding);
    const scopes = evidence.scopes.filter(scope => scope.workspaces.includes(source.workspace) || inherited.some(binding => scope.bindings.includes(binding)));
    const scope = scopes.length === 1 ? scopes[0] : null;
    byWorkspace.set(source.workspace, scope);
    if (!scope) blocked.push({ workspace: source.workspace, code: scopes.length ? 'AMBIGUOUS_SOURCE_IDENTITY' : 'UNBOUND_SOURCE' });
    else if (!scope.complete) blocked.push({ workspace: source.workspace, sourceIdentity: scope.sourceIdentity, code: 'DELETION_EVIDENCE_UNKNOWN', issues: scope.issues });
    workspaces.set(source.workspace, await readObject(objects, source.workspace, 'workspace'));
  }
  for (const group of manifest.groups) {
    const candidate = group.selected ?? group.retainedSelection;
    if (!group.members.includes(candidate)) throw new LibraryError('INVALID_IMPORT_STATE', 'A retained group must name its active or recovery selection.');
    const reasons = [];
    for (const member of group.members) {
      const node = nodes.get(member), scope = node && byWorkspace.get(node.source);
      if (!scope) continue;
      const value = node.path.reduce((value, key) => value?.[key], workspaces.get(node.source));
      if (!node.sourceId) blocked.push({ groupId: group.id, member, code: 'MISSING_RECORD_ID' });
      const generation = value?.metadata?.libraryGeneration ?? '0';
      if (typeof generation !== 'string' || (generation !== '0' && !/^\d{16}:[\da-f-]+$/.test(generation))) {
        blocked.push({ groupId: group.id, member, code: 'INVALID_RECORD_GENERATION' });
        continue;
      }
      if (scope.deletedIds.includes(node.sourceId)) reasons.push({ member, sourceIdentity: scope.sourceIdentity, sourceId: node.sourceId, code: 'PERMANENT_DELETION' });
      if (generation !== scope.generation) reasons.push({ member, sourceIdentity: scope.sourceIdentity, sourceId: node.sourceId, code: 'CLEARED_GENERATION', generation, currentGeneration: scope.generation });
    }
    if (reasons.length) {
      group.selected = null; group.retainedSelection = candidate; group.inactiveReason = 'permanent-deletion';
      suppressed.push({ groupId: group.id, member: candidate, reasons });
    }
  }
  const inactive = new Set(manifest.groups.filter(group => group.selected === null).map(group => group.id));
  for (const reference of manifest.references) if (inactive.has(reference.groupId)) reference.reason = 'prompt-not-selected';
  manifest.deletionPolicy = { version: 1, sourceBindings };
  suppressDeletedRecords(manifest, derivedSources);
  const unique = [...new Map(blocked.map(issue => [canonical(issue), issue])).values()];
  return { manifest, evidence, suppressed, blocked: unique };
}
