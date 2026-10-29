import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, makeObject } from './contract.mjs';
import { captureSourceInventory, inspectSourceInventory } from './source-inventory.mjs';

function fixture(overrides = {}) {
  const reads = [];
  const values = {
    'pl2-library': JSON.stringify([{ id: 'p1', versions: Array.from({ length: 41 }, (_, id) => ({ id, future: { preserved: true } })) }]),
    'pl2-library-deleted:erased': '1',
    'pl2-library-deleted-batch:batch': '["removed-1","removed-2"]',
    'pl2-library-clear:0000000000000003:synthetic': '1',
    'pl2-pads': '{"revision":4,"pads":[{"id":"s1","content":"notes","future":null}],"tombstones":{"s2":3}}',
    'pl2-pad': 'unparsed legacy Scratch $& {{input}}',
    'pl2-loaded-packs': '["pack-1"]',
    'pl2-packs': '{"pack-1":{"future":{"asset":"data:image/png;base64,AA=="}}}',
    'pl2-run-fallback': '[{"run_id":"fallback-run","future":true}]',
    'pl2-draft-reset-recovery-v1': '{"raw":"unsaved recovery"}',
    'pl2-provider-settings': 'secret provider settings must never be read',
    'pl2-billing': 'private billing state must never be read',
    '__clerk_client_jwt': 'authentication session must never be read',
    'unknown-store': 'unreviewed data must never be read',
  };
  const options = {
    surface: 'desktop', sourceIdentity: 'synthetic-device-origin',
    localStorage: { length: Object.keys(values).length, key: i => Object.keys(values)[i], getItem: key => { reads.push(key); return values[key] ?? null; } },
    readIndexedStore: async ({ database, store }) => ({
      state: 'present', databaseVersion: database === 'prompt_lab_local' ? 4 : 1,
      records: store === 'runs' ? Array.from({ length: 1002 }, (_, n) => ({ run_id: `trace-${n}`, prompt_id: 'p1', unknown: n }))
        : store === 'journal' ? [{ id: 'library', revision: 9, entries: { 'pl2-library': '[]' }, unknown: true }]
          : [{ id: `${store}-1`, promptId: 'p1', promptVersionId: 'missing-version', unknown: ['retained'] }],
    }),
    archives: { reviewed: true, records: [{ origin: 'explicit user selection', status: 'unavailable', expectedHash: 'sha256:missing', note: 'Keep this evidence; do not fabricate bytes.' }] },
    capturedAt: '2026-10-29T00:00:00.000Z', ...overrides,
  };
  return { options, values, reads };
}

test('captures raw stores beyond workspace export without caps, normalization or replica selection', async () => {
  const { options, values } = fixture();
  const { manifest, captures } = await inspectSourceInventory(await captureSourceInventory(options));
  assert.equal(manifest.sourceReadComplete, true);
  assert.equal(manifest.activationReady, false);
  for (const key of ['pl2-library', 'pl2-pads', 'pl2-pad', 'pl2-loaded-packs', 'pl2-packs', 'pl2-run-fallback', 'pl2-draft-reset-recovery-v1',
    'pl2-library-deleted:erased', 'pl2-library-deleted-batch:batch', 'pl2-library-clear:0000000000000003:synthetic']) {
    assert.equal(captures['local-content'].entries[key], values[key]);
  }
  assert.equal(JSON.parse(captures['local-content'].entries['pl2-library'])[0].versions.length, 41);
  assert.equal(captures['execution-traces'].records.length, 1002);
  assert.equal(captures.evaluations.records[0].promptVersionId, 'missing-version');
  assert.equal(captures['durable-journal'].records[0].entries['pl2-library'], '[]');
  assert.deepEqual(captures['selected-archives'].records, options.archives.records);
});

test('credential, billing and unselected store values are never requested', async () => {
  const { options, reads } = fixture();
  const { captures } = await inspectSourceInventory(await captureSourceInventory(options));
  for (const key of ['pl2-provider-settings', 'pl2-billing', '__clerk_client_jwt', 'unknown-store']) {
    assert.equal(reads.includes(key), false);
    assert.equal(Object.hasOwn(captures['local-content'].entries, key), false);
    assert.ok(captures['local-content'].unselectedKeys.includes(key));
  }
});

test('keeps corrupt JSON and legacy plain text available for recovery instead of treating them as empty', async () => {
  const { options, values } = fixture();
  values['pl2-library'] = '[{"id":"interrupted JSON';
  const { captures } = await inspectSourceInventory(await captureSourceInventory(options));
  assert.equal(captures['local-content'].entries['pl2-library'], values['pl2-library']);
  assert.equal(captures['local-content'].entries['pl2-pad'], values['pl2-pad']);
});

test('keeps both observations when local content changes during capture', async () => {
  const { options } = fixture(); let reads = 0;
  options.localStorage.getItem = key => key === 'pl2-library' ? String(++reads) : null;
  const { manifest, captures } = await inspectSourceInventory(await captureSourceInventory(options));
  assert.equal(manifest.sourceReadComplete, false);
  assert.equal(captures['local-content'].state, 'changed');
  assert.deepEqual(captures['local-content'].observations.map(item => item.entries['pl2-library']), ['1', '2']);
});

test('denied and unsupported source reads stay unavailable and never expose error text', async () => {
  const { options } = fixture({ readIndexedStore: async ({ store }) => {
    if (store === 'runs') return { state: 'present', records: [new Blob(['cannot silently discard asset'])] };
    throw new Error('private data in a provider error');
  } });
  const inventory = await captureSourceInventory(options);
  assert.equal(inventory.manifest.sourceReadComplete, false);
  assert.equal(JSON.stringify(inventory).includes('private data'), false);
  assert.equal(inventory.manifest.sources.find(source => source.id === 'execution-traces').code, 'INVALID_JSON');
  await inspectSourceInventory(inventory);
});

test('absent databases are explicit and unreviewed backup inventory prevents a complete-source claim', async () => {
  const { options } = fixture({ surface: 'web', readIndexedStore: async () => ({ state: 'absent', reason: 'Database does not exist in this origin.' }), archives: { reviewed: false, records: [] } });
  const { manifest } = await inspectSourceInventory(await captureSourceInventory(options));
  assert.equal(manifest.sourceReadComplete, false);
  assert.equal(manifest.sources.find(source => source.id === 'experiments').state, 'absent');
  assert.equal(manifest.sources.some(source => source.id === 'durable-journal'), false);
});

test('extension reader receives only named draft keys and rejects unrelated session content', async () => {
  let requested;
  const { options } = fixture({ surface: 'extension', readExtensionDrafts: async keys => {
    requested = keys;
    return { 'pl2-session': { raw: 'draft', future: 'retained' }, 'pl2-dual-draft': null };
  } });
  const result = await inspectSourceInventory(await captureSourceInventory(options));
  assert.deepEqual(requested, ['pl2-session', 'pl2-dual-draft']);
  assert.equal(result.captures['extension-drafts'].entries['pl2-session'].future, 'retained');
  options.readExtensionDrafts = async () => ({ 'pl2-session': null, 'pl2-dual-draft': null, authToken: 'excluded' });
  const rejected = await captureSourceInventory(options);
  assert.equal(rejected.manifest.sources.find(source => source.id === 'extension-drafts').state, 'unavailable');
  assert.equal(JSON.stringify(rejected).includes('authToken'), false);
});

test('readback detects missing captures, omitted source families and changed content', async () => {
  const inventory = await captureSourceInventory(fixture().options);
  const missing = structuredClone(inventory);
  delete missing.objects[missing.manifest.sources[0].hash];
  await assert.rejects(inspectSourceInventory(missing), { code: 'MISSING_OBJECT' });
  const omitted = structuredClone(inventory);
  omitted.manifest.sources.pop(); omitted.manifestHash = await hash(omitted.manifest);
  await assert.rejects(inspectSourceInventory(omitted), { code: 'INCOMPLETE_SOURCE_INVENTORY' });
  inventory.objects[inventory.manifest.sources[0].hash].data.entries['pl2-library'] = '[]';
  await assert.rejects(inspectSourceInventory(inventory), { code: 'HASH_MISMATCH' });
});

test('valid hashes cannot hide omitted raw stores, wrong store identity or credential inclusion', async () => {
  for (const mutation of ['omission', 'credentials', 'identity']) {
    const inventory = await captureSourceInventory(fixture().options);
    const source = inventory.manifest.sources.find(source => source.id === (mutation === 'identity' ? 'experiments' : 'local-content'));
    const data = structuredClone(inventory.objects[source.hash].data);
    if (mutation === 'omission') delete data.entries['pl2-pads'];
    if (mutation === 'credentials') data.entries['pl2-provider-settings'] = 'excluded';
    if (mutation === 'identity') data.store = 'some-other-store';
    const object = await makeObject('source-capture', data);
    inventory.objects[object.hash] = object.object; source.hash = object.hash;
    inventory.manifestHash = await hash(inventory.manifest);
    await assert.rejects(inspectSourceInventory(inventory), { code: 'INVALID_SOURCE' });
  }
});

test('current inventory captures the Scratch journal revision while historical v1 remains readable with incomplete current coverage', async () => {
  const { options, values } = fixture();
  values['pl2-scratch-journal-revision'] = '12';
  const inventory = await captureSourceInventory(options);
  const current = await inspectSourceInventory(inventory);
  assert.equal(current.manifest.schemaVersion, 2);
  assert.equal(current.currentSourceCoverage, true);
  assert.equal(current.captures['local-content'].entries['pl2-scratch-journal-revision'], '12');

  const historical = structuredClone(inventory);
  historical.manifest.schemaVersion = 1;
  const source = historical.manifest.sources.find(source => source.id === 'local-content');
  const data = structuredClone(historical.objects[source.hash].data);
  delete data.entries['pl2-scratch-journal-revision'];
  data.unselectedKeys.push('pl2-scratch-journal-revision');
  const object = await makeObject('source-capture', data);
  historical.objects[object.hash] = object.object;
  source.hash = object.hash;
  historical.manifestHash = await hash(historical.manifest);
  const readback = await inspectSourceInventory(historical);
  assert.equal(readback.currentSourceCoverage, false);
  assert.equal(readback.manifest.sourceReadComplete, true);
  assert.equal(readback.captures['local-content'].entries['pl2-library'], values['pl2-library']);
  historical.manifest.schemaVersion = 2;
  historical.manifestHash = await hash(historical.manifest);
  await assert.rejects(inspectSourceInventory(historical), { code: 'INVALID_SOURCE' });
});
