import { canonical, hash, LibraryError, makeObject, readObject } from './contract.mjs';

import { V1_LOCAL_CONTENT_KEYS, V2_LOCAL_CONTENT_KEYS, LOCAL_CONTENT_KEYS, SOURCE_INVENTORY_VERSION, DELETION_PREFIXES, EXTENSION_DRAFT_KEYS, isLocalContentKey } from './content-keys.mjs';
export { LOCAL_CONTENT_KEYS, SOURCE_INVENTORY_VERSION, DELETION_PREFIXES, EXTENSION_DRAFT_KEYS, isLocalContentKey } from './content-keys.mjs';

export const INDEXED_SOURCES = Object.freeze([
  { id: 'experiments', database: 'prompt_lab_local', store: 'experiments' },
  { id: 'evaluations', database: 'prompt_lab_local', store: 'eval_runs' },
  { id: 'test-cases', database: 'prompt_lab_local', store: 'test_cases' },
  { id: 'execution-traces', database: 'prompt_lab_local', store: 'runs' },
  { id: 'durable-journal', database: 'prompt_lab_durable', store: 'journal', desktopOnly: true },
]);

function localKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (typeof key !== 'string') throw new LibraryError('SOURCE_CHANGED', 'Source key listing changed during capture.');
    keys.push(key);
  }
  if (new Set(keys).size !== keys.length) throw new LibraryError('SOURCE_CHANGED', 'Source key listing changed during capture.');
  return keys.sort();
}

function captureLocal(storage) {
  const listed = localKeys(storage);
  const keys = [...new Set([...LOCAL_CONTENT_KEYS, ...listed.filter(isLocalContentKey)])].sort();
  const entries = Object.fromEntries(keys.map(key => {
    const value = storage.getItem(key);
    if (value !== null && typeof value !== 'string') throw new LibraryError('INVALID_SOURCE', 'Local source values must be strings or null.');
    return [key, value];
  }));
  // Unselected key values are never read, including credentials and preferences.
  return { entries, unselectedKeys: listed.filter(key => !isLocalContentKey(key)) };
}

function validateRead(result) {
  if (!result || !['present', 'absent'].includes(result.state)) throw new LibraryError('SOURCE_UNAVAILABLE', 'A source must explicitly report present or absent.');
  if (result.state === 'present' && !Array.isArray(result.records)) throw new LibraryError('INVALID_SOURCE', 'A present object store must report every raw record.');
  if (result.state === 'absent' && (typeof result.reason !== 'string' || !result.reason)) throw new LibraryError('INVALID_SOURCE', 'An absent source needs an explicit reason.');
  canonical(result);
  return result;
}

function assertCapture(id, data, version = SOURCE_INVENTORY_VERSION) {
  if (id === 'local-content') {
    const contentKeys = version === 1 ? V1_LOCAL_CONTENT_KEYS : version === 2 ? V2_LOCAL_CONTENT_KEYS : LOCAL_CONTENT_KEYS;
    const selected = key => contentKeys.includes(key) || DELETION_PREFIXES.some(prefix => key.startsWith(prefix));
    const observations = data.state === 'changed' ? data.observations : [data];
    if (!Array.isArray(observations) || observations.length !== (data.state === 'changed' ? 2 : 1)) throw new LibraryError('INVALID_SOURCE', 'Local observations are incomplete.');
    for (const observation of observations) {
      const entries = observation?.entries;
      if (!entries || Object.getPrototypeOf(entries) !== Object.prototype
        || contentKeys.some(key => !Object.hasOwn(entries, key))
        || Object.entries(entries).some(([key, value]) => !selected(key) || (value !== null && typeof value !== 'string'))
        || !Array.isArray(observation.unselectedKeys) || observation.unselectedKeys.some(key => typeof key !== 'string' || selected(key))) {
        throw new LibraryError('INVALID_SOURCE', 'Local capture is incomplete or includes an unselected store.');
      }
    }
    if (!['present', 'changed'].includes(data.state)) throw new LibraryError('INVALID_SOURCE', 'Unsupported local capture state.');
  } else if (id === 'extension-drafts') {
    if (data.state !== 'present' || !data.entries || Object.getPrototypeOf(data.entries) !== Object.prototype
      || Object.keys(data.entries).length !== EXTENSION_DRAFT_KEYS.length
      || EXTENSION_DRAFT_KEYS.some(key => !Object.hasOwn(data.entries, key))) throw new LibraryError('INVALID_SOURCE', 'Extension capture must contain only the named editor drafts.');
  } else if (id === 'selected-archives') {
    if (!Array.isArray(data.records) || typeof data.reviewed !== 'boolean'
      || data.state !== (data.reviewed ? 'present' : 'unreviewed')) throw new LibraryError('INVALID_SOURCE', 'Archive review evidence disagrees.');
  } else {
    const descriptor = INDEXED_SOURCES.find(source => source.id === id);
    if (!descriptor || data.database !== descriptor.database || data.store !== descriptor.store) throw new LibraryError('INVALID_SOURCE', 'Object store identity disagrees.');
    validateRead(data);
  }
}

// Readers must use the owning app's supported APIs. No profile paths, network
// access, account discovery, database creation or writes occur in this module.
export async function captureSourceInventory({
  surface, sourceIdentity, localStorage, readIndexedStore, readExtensionDrafts,
  archives = { reviewed: false, records: [] }, capturedAt = new Date().toISOString(),
}) {
  if (!['desktop', 'web', 'extension'].includes(surface) || typeof sourceIdentity !== 'string' || !sourceIdentity
    || typeof capturedAt !== 'string' || !Number.isFinite(Date.parse(capturedAt))) {
    throw new LibraryError('INVALID_SOURCE', 'An explicit surface and source identity are required.');
  }
  const objects = {}, sources = [];
  async function retain(id, read) {
    try {
      const data = await read();
      assertCapture(id, data);
      const object = await makeObject('source-capture', { id, ...data });
      objects[object.hash] = object.object;
      sources.push({ id, state: data.state, hash: object.hash });
    } catch (error) {
      // Error text can contain private source data. Keep only a stable code.
      sources.push({ id, state: 'unavailable', code: error instanceof LibraryError ? error.code : 'SOURCE_UNAVAILABLE' });
    }
  }
  await retain('local-content', () => {
    const first = captureLocal(localStorage), second = captureLocal(localStorage);
    // Keep both observations if writes race. Neither becomes the chosen source.
    return canonical(first) === canonical(second)
      ? { state: 'present', ...first }
      : { state: 'changed', observations: [first, second] };
  });
  for (const descriptor of INDEXED_SOURCES) {
    if (descriptor.desktopOnly && surface !== 'desktop') continue;
    await retain(descriptor.id, async () => ({
      ...validateRead(await readIndexedStore({ database: descriptor.database, store: descriptor.store })),
      database: descriptor.database, store: descriptor.store,
    }));
  }
  if (surface === 'extension') {
    await retain('extension-drafts', async () => {
      const entries = await readExtensionDrafts([...EXTENSION_DRAFT_KEYS]);
      if (!entries || Object.getPrototypeOf(entries) !== Object.prototype
        || Object.keys(entries).some(key => !EXTENSION_DRAFT_KEYS.includes(key))
        || EXTENSION_DRAFT_KEYS.some(key => !Object.hasOwn(entries, key))) {
        throw new LibraryError('INVALID_SOURCE', 'Report each draft key explicitly, without other session stores.');
      }
      canonical(entries);
      return { state: 'present', entries };
    });
  }
  await retain('selected-archives', () => {
    if (typeof archives.reviewed !== 'boolean' || !Array.isArray(archives.records)) throw new LibraryError('INVALID_SOURCE', 'Archive inventory must include review state and provenance records.');
    return { ...archives, state: archives.reviewed ? 'present' : 'unreviewed' };
  });
  const manifest = {
    format: 'promptlab-source-inventory', schemaVersion: SOURCE_INVENTORY_VERSION, surface, sourceIdentity, capturedAt,
    sources, sourceReadComplete: sources.every(source => ['present', 'absent'].includes(source.state)),
    // Separate store reads cannot prove a cross-store write barrier or migration.
    activationReady: false,
  };
  return { manifest, manifestHash: await hash(manifest), objects };
}

export async function inspectSourceInventory(inventory) {
  const { manifest, manifestHash, objects } = inventory || {};
  if (manifest?.format !== 'promptlab-source-inventory' || ![1, 2, SOURCE_INVENTORY_VERSION].includes(manifest.schemaVersion)
    || !['desktop', 'web', 'extension'].includes(manifest.surface)
    || typeof manifest.sourceIdentity !== 'string' || !manifest.sourceIdentity
    || typeof manifest.capturedAt !== 'string' || !Number.isFinite(Date.parse(manifest.capturedAt))
    || manifest.activationReady !== false || !Array.isArray(manifest.sources)
    || !objects || Object.getPrototypeOf(objects) !== Object.prototype) {
    throw new LibraryError('UNSUPPORTED_SOURCE_INVENTORY', 'Unsupported source inventory.');
  }
  if (await hash(manifest) !== manifestHash) throw new LibraryError('HASH_MISMATCH', 'Source manifest changed.');
  const captures = {};
  const expected = ['local-content', ...INDEXED_SOURCES.filter(source => !source.desktopOnly || manifest.surface === 'desktop').map(source => source.id),
    ...(manifest.surface === 'extension' ? ['extension-drafts'] : []), 'selected-archives'];
  if (canonical(manifest.sources.map(source => source.id).sort()) !== canonical(expected.sort())) {
    throw new LibraryError('INCOMPLETE_SOURCE_INVENTORY', 'A required source was omitted or duplicated.');
  }
  for (const source of manifest.sources) {
    if (!['present', 'absent', 'unavailable', 'changed', 'unreviewed'].includes(source.state)) throw new LibraryError('INVALID_SOURCE', 'Unsupported source state.');
    if (source.state === 'unavailable') {
      if (source.hash || typeof source.code !== 'string' || !source.code) throw new LibraryError('INVALID_SOURCE', 'Unavailable sources must report a code without claiming readable content.');
      continue;
    }
    const capture = await readObject(objects, source.hash, 'source-capture');
    if (capture.id !== source.id || capture.state !== source.state) throw new LibraryError('INVALID_SOURCE', 'Source identity or state disagrees.');
    assertCapture(source.id, capture, manifest.schemaVersion);
    Object.defineProperty(captures, source.id, { value: capture, enumerable: true });
  }
  const complete = manifest.sources.every(source => ['present', 'absent'].includes(source.state));
  if (manifest.sourceReadComplete !== complete) throw new LibraryError('INVALID_SOURCE', 'Source completeness disagrees with evidence.');
  for (const [id, object] of Object.entries(objects)) if (await hash(object) !== id) throw new LibraryError('HASH_MISMATCH', 'Retained source object changed.');
  return { manifest: structuredClone(manifest), captures, currentSourceCoverage: manifest.schemaVersion === SOURCE_INVENTORY_VERSION };
}
