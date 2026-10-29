import { assertWorkspace, canonical, hash, LibraryError, makeObject, readObject } from './contract.mjs';
import { inspectSourceInventory } from './source-inventory.mjs';

const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
const fail = message => { throw new LibraryError('SOURCE_BINDING_MISMATCH', message, 409); };

function rawRows(entries, key) {
  if (entries[key] === null) return [];
  let rows;
  try { rows = JSON.parse(entries[key]); } catch { fail('Captured Library rows are not valid JSON.'); }
  if (!Array.isArray(rows)) fail('Captured Library rows must be arrays.');
  return rows;
}

async function validateBinding(source, workspace, inventory, objects) {
  if (!record(inventory) || Object.keys(inventory).some(key => !['manifest', 'manifestHash', 'objects'].includes(key))) {
    fail('Source inventory envelope requires an explicit format migration.');
  }
  const sourceText = await readObject(objects, source, 'source');
  const content = await readObject(objects, workspace, 'workspace');
  assertWorkspace(content);
  let decoded;
  try { decoded = JSON.parse(sourceText); } catch { fail('Archived workspace source is invalid.'); }
  if (typeof sourceText !== 'string' || canonical(decoded) !== canonical(content)) fail('Archived workspace source disagrees.');
  const inspected = await inspectSourceInventory(inventory);
  if (!inspected.currentSourceCoverage || inspected.captures['local-content']?.state !== 'present') {
    throw new LibraryError('SOURCE_BINDING_UNAVAILABLE', 'Binding requires a current, stable local content capture.', 409);
  }
  // The standard export omits an empty trash section. No other normalization,
  // retention cap or preference for one replica is allowed at this boundary.
  const entries = inspected.captures['local-content'].entries;
  if (canonical(rawRows(entries, 'pl2-library')) !== canonical(content.library)
    || canonical(rawRows(entries, 'pl2-library-trash')) !== canonical(content.trash ?? [])) {
    fail('Captured Library or trash differs from the archived workspace. Capture and export again.');
  }
  const expected = inventory.manifest.sources.filter(item => item.hash).map(item => item.hash).sort();
  if (canonical(Object.keys(inventory.objects).sort()) !== canonical(expected)) fail('Binding inventory must contain exactly its declared capture objects.');
  return { ...inspected, workspaceHash: await hash(content) };
}

// Own the caller's capture before hashing. The commit stores every raw capture,
// including unavailable-source evidence, without claiming a migration barrier.
export async function createSourceBinding({ source, workspace, inventory, objects }) {
  inventory = structuredClone(inventory);
  await validateBinding(source, workspace, inventory, objects);
  const inventoryObject = await makeObject('source-inventory', {
    manifest: inventory.manifest, manifestHash: inventory.manifestHash,
    captureObjects: Object.keys(inventory.objects).sort(),
  });
  const binding = await makeObject('source-binding', {
    format: 'promptlab-source-binding', schemaVersion: 1, source, workspace, inventory: inventoryObject.hash,
  });
  return { hash: binding.hash, objects: { ...inventory.objects, [inventoryObject.hash]: inventoryObject.object, [binding.hash]: binding.object } };
}

export async function inspectSourceBinding(objects, bindingHash, expected = {}) {
  const binding = await readObject(objects, bindingHash, 'source-binding');
  if (binding.format !== 'promptlab-source-binding' || binding.schemaVersion !== 1
    || (expected.source !== undefined && binding.source !== expected.source)
    || (expected.workspace !== undefined && binding.workspace !== expected.workspace)) fail('Binding refers to another workspace or source.');
  const stored = await readObject(objects, binding.inventory, 'source-inventory');
  if (!Array.isArray(stored.captureObjects) || new Set(stored.captureObjects).size !== stored.captureObjects.length) fail('Capture object inventory is invalid.');
  const captures = {};
  for (const id of stored.captureObjects) {
    await readObject(objects, id, 'source-capture');
    captures[id] = structuredClone(objects[id]);
  }
  const inventory = { manifest: stored.manifest, manifestHash: stored.manifestHash, objects: captures };
  return { binding, inventory, ...await validateBinding(binding.source, binding.workspace, inventory, objects) };
}

function collectMarkers(entries, scope, origin) {
  if (!record(entries)) { scope.issues.push({ origin, code: 'INVALID_DELETION_ENTRIES' }); return; }
  for (const [key, value] of Object.entries(entries)) {
    let valid = true;
    if (key.startsWith('pl2-library-deleted:')) {
      const id = key.slice('pl2-library-deleted:'.length);
      valid = Boolean(id) && value === '1';
      if (valid) scope.deletedIds.add(id);
    } else if (key.startsWith('pl2-library-deleted-batch:')) {
      let ids;
      try { ids = JSON.parse(value); } catch { /* Raw invalid bytes remain archived. */ }
      valid = key.length > 'pl2-library-deleted-batch:'.length && typeof value === 'string'
        && Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.length);
      if (valid) for (const id of ids) scope.deletedIds.add(id);
    } else if (key.startsWith('pl2-library-clear:')) {
      const generation = key.slice('pl2-library-clear:'.length);
      valid = /^\d{16}:[\da-f-]+$/.test(generation) && value === '1';
      if (valid && generation > scope.generation) scope.generation = generation;
    }
    // Do not echo malformed marker contents into a report or an error message.
    if (!valid) scope.issues.push({ origin, code: 'INVALID_DELETION_MARKER' });
  }
}

/** Source-scoped evidence only. Unbound workspaces have no inferred scope. */
export async function collectDeletionEvidence(objects, bindingHashes) {
  const scopes = new Map();
  for (const bindingHash of [...new Set(bindingHashes)].sort()) {
    const inspected = await inspectSourceBinding(objects, bindingHash);
    const { manifest, captures, binding } = inspected;
    let scope = scopes.get(manifest.sourceIdentity);
    if (!scope) {
      scope = { sourceIdentity: manifest.sourceIdentity, workspaces: new Set(), bindings: [], deletedIds: new Set(), generation: '0', issues: [] };
      scopes.set(manifest.sourceIdentity, scope);
    }
    // Graph nodes identify workspace objects, not hashes of their raw data.
    scope.workspaces.add(binding.workspace); scope.bindings.push(bindingHash);
    collectMarkers(captures['local-content'].entries, scope, { binding: bindingHash, source: 'local-content' });
    if (manifest.surface !== 'desktop') continue;
    const journal = captures['durable-journal'];
    const origin = { binding: bindingHash, source: 'durable-journal' };
    if (!journal) { scope.issues.push({ origin, code: 'DELETION_SOURCE_UNAVAILABLE' }); continue; }
    if (journal.state === 'absent') continue;
    const library = journal.records.filter(item => item?.id === 'library');
    if (library.length > 1 || journal.records.some(item => !record(item) || !['library', 'scratch'].includes(item.id))) {
      scope.issues.push({ origin, code: 'UNKNOWN_JOURNAL_RECORD' });
    }
    for (const item of library) {
      if (!Number.isSafeInteger(item.revision) || item.revision < 1) scope.issues.push({ origin, code: 'INVALID_JOURNAL_REVISION' });
      collectMarkers(item.entries, scope, origin);
    }
  }
  return { bindingCount: new Set(bindingHashes).size, activationReady: false, scopes: [...scopes.values()]
    .sort((a, b) => a.sourceIdentity < b.sourceIdentity ? -1 : a.sourceIdentity > b.sourceIdentity ? 1 : 0)
    .map(scope => ({ ...scope, workspaces: [...scope.workspaces].sort(), deletedIds: [...scope.deletedIds].sort(), complete: scope.issues.length === 0 })) };
}
