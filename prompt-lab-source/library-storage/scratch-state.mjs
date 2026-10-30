import { hash, LibraryError } from './contract.mjs';
import { recordGroupId, selectionForRecord } from './record-state.mjs';

const object = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = (code, message) => { throw new LibraryError(code, message, 409); };

export function scratchCommandSources(inspected) {
  return new Set((inspected.derivedSources ?? []).flatMap(source => source.recordMutation?.domain === 'scratch-notes'
    ? [source.recordMutation.sourceIdentity] : []));
}

export function scratchTombstones(map, inspected, sourceIdentity) {
  const result = {};
  for (const row of map.records.filter(row => row.domain === 'scratch' && row.origin.sourceIdentity === sourceIdentity)) {
    if (!object(row.value) || !Array.isArray(row.value.pads) || (row.value.tombstones !== undefined && !object(row.value.tombstones))) {
      fail('INVALID_SCRATCH_STATE', 'Review a complete Scratch container before changing notes.');
    }
    const ids = row.value.pads.map(note => note?.id);
    if (ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
      fail('INVALID_SCRATCH_STATE', 'Scratch notes must have unique stable IDs within each container.');
    }
    for (const [id, time] of Object.entries(row.value.tombstones ?? {})) {
      if (!id || !Number.isFinite(time) || time < 0) fail('INVALID_SCRATCH_STATE', 'Retain and review invalid Scratch deletion evidence before writing.');
      Object.defineProperty(result, id, { value: Math.max(Object.hasOwn(result, id) ? result[id] : 0, time), enumerable: true, configurable: true });
    }
  }
  for (const source of inspected.derivedSources ?? []) {
    const change = source.recordMutation;
    if (change?.domain === 'scratch-notes' && change.sourceIdentity === sourceIdentity && change.action === 'delete') {
      Object.defineProperty(result, change.sourceId, { value: Math.max(Object.hasOwn(result, change.sourceId) ? result[change.sourceId] : 0,
        Date.parse(change.changedAt)), enumerable: true, configurable: true });
    }
  }
  return result;
}

/** Adopt only previously reviewed notes; historical alternatives stay inactive. */
export async function adoptScratchGroups(pkg, inspected, map, sourceIdentity) {
  const groups = [...(inspected.manifest.recordGroups ?? [])], selected = new Set(inspected.currentView.selected);
  const rows = map.records.filter(row => row.domain === 'scratch-notes' && row.origin.sourceIdentity === sourceIdentity);
  for (const sourceId of new Set(rows.map(row => row.sourceId))) {
    if (typeof sourceId !== 'string' || !sourceId) fail('INVALID_SCRATCH_STATE', 'A Scratch note has no stable identity.');
    const id = await recordGroupId(pkg.libraryId, 'scratch-notes', sourceIdentity, sourceId);
    if (groups.some(group => group.id === id)) continue;
    const candidates = rows.filter(row => row.sourceId === sourceId), active = candidates.filter(row => selected.has(row.key));
    if (active.length > 1) fail('INVALID_SCRATCH_STATE', 'Review duplicate active Scratch identities before writing.');
    const row = active[0] ?? candidates[0], group = selectionForRecord(row, id);
    if (!active.length) Object.assign(group, { selected: null, selectedHash: null, inactiveReason: 'checkpoint-not-selected' });
    groups.push(group);
  }
  return groups;
}

export async function selectedScratchRecord(pkg, inspected, map, groupId) {
  const selected = new Set(inspected.currentView.selected);
  for (const row of map.records.filter(row => row.domain === 'scratch-notes' && selected.has(row.key))) {
    if (await recordGroupId(pkg.libraryId, row.domain, row.origin.sourceIdentity, row.sourceId) === groupId) return row;
  }
  return null;
}

export function validateScratchSelection(groups, map, inspected, blocked) {
  for (const sourceIdentity of scratchCommandSources(inspected)) {
    try {
      const tombstones = scratchTombstones(map, inspected, sourceIdentity);
      const rows = new Map(map.records.map(row => [row.key, row]));
      for (const group of groups.filter(group => group.domain === 'scratch-notes' && group.sourceIdentity === sourceIdentity && group.selected !== null)) {
        if (Object.hasOwn(tombstones, rows.get(group.selected)?.sourceId)) fail('SCRATCH_DELETION_CONFLICT', 'A retained deletion prevents selecting this Scratch note.');
      }
    } catch (error) {
      if (!(error instanceof LibraryError)) throw error;
      blocked.push({ code: error.code, sourceIdentity });
    }
  }
}

/** Current projection only: archival row hashes and raw values never change. */
export async function projectScratchContainer(row, map, inspected) {
  if (row.domain !== 'scratch' || !scratchCommandSources(inspected).has(row.origin.sourceIdentity)) return row;
  const selected = new Set(inspected.currentView.selected);
  const notes = map.records.filter(note => note.domain === 'scratch-notes' && note.origin.sourceIdentity === row.origin.sourceIdentity && selected.has(note.key));
  const order = new Map((row.value.pads ?? []).map((note, index) => [note.id, index]));
  notes.sort((a, b) => (order.get(a.sourceId) ?? Infinity) - (order.get(b.sourceId) ?? Infinity)
    || (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
  const pads = notes.map(note => note.value), value = { ...row.value, pads,
    tombstones: scratchTombstones(map, inspected, row.origin.sourceIdentity),
    activePadId: pads.some(note => note.id === row.value.activePadId) ? row.value.activePadId : pads[0]?.id ?? '' };
  const active = notes.find(note => note.sourceId === value.activePadId);
  const references = active ? [{ path: ['activePadId'], domain: 'scratch-notes', sourceId: value.activePadId,
    candidates: [active.key], status: 'resolved' }] : [];
  return { ...row, value, references, valueHash: await hash(value), sourceValueHash: row.valueHash, projection: 'scratch-notes' };
}
