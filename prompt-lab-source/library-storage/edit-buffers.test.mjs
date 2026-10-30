import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryEditBuffers } from '../prompt-lab-extension/src/lib/libraryEditBuffers.js';
import { captureSourceInventory, inspectSourceInventory } from './source-inventory.mjs';
import { hash } from './contract.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('buffer suspension preserves exact unsaved content and resumes pending autosaves once', async () => {
  const registry = createLibraryEditBuffers();
  let value = { raw: 'unsaved $& {{input}}', future: [1, null, ''] }, writes = 0;
  const remove = registry.register('editor', () => value);
  registry.schedule(() => ++writes, 10);
  const resume = registry.suspend(), snapshot = registry.read();
  await delay(25); assert.equal(writes, 0);
  registry.assertUnchanged(snapshot);
  value = { ...value, raw: 'later' };
  assert.throws(() => registry.assertUnchanged(snapshot), { code: 'LIBRARY_CAPTURE_CHANGED' });
  assert.equal(snapshot[0].value.raw, 'unsaved $& {{input}}');
  resume(); resume(); await delay(25); assert.equal(writes, 1);
  remove(); assert.deepEqual(registry.read(), []);
});

test('new timers stay paused, cancellation survives resume, and unsupported buffers reject', async () => {
  const registry = createLibraryEditBuffers();
  let writes = 0;
  const resume = registry.suspend();
  const canceled = registry.schedule(() => assert.fail('canceled'), 1);
  registry.cancel(canceled); registry.schedule(() => ++writes, 1);
  await delay(10); assert.equal(writes, 0);
  registry.register('bad', () => ({ secretMethod: () => {} }));
  assert.throws(() => registry.read());
  resume(); await delay(10); assert.equal(writes, 1);
});

const options = {
  surface: 'web', sourceIdentity: 'two-clients',
  localStorage: { length: 0, key: () => null, getItem: () => null },
  readIndexedStore: async () => ({ state: 'absent', reason: 'Disposable fixture.' }),
  archives: { reviewed: true, records: [] },
  clientBuffers: [{ clientId: 'first', buffers: [{ id: 'editor', value: { raw: 'first draft', future: [1, 2] } }] },
    { clientId: 'second', buffers: [{ id: 'editor', value: { raw: 'second draft' } }] }],
};

test('coordinated inventory retains separate client buffers and rejects missing or duplicate evidence', async () => {
  const inventory = await captureSourceInventory(options);
  assert.equal(inventory.manifest.schemaVersion, 4);
  assert.equal(inventory.manifest.sourceReadComplete, true);
  assert.deepEqual((await inspectSourceInventory(inventory)).captures['client-buffers'].records, options.clientBuffers);
  const missing = structuredClone(inventory);
  missing.manifest.sources = missing.manifest.sources.filter(row => row.id !== 'client-buffers');
  missing.manifestHash = await hash(missing.manifest);
  await assert.rejects(inspectSourceInventory(missing), { code: 'INCOMPLETE_SOURCE_INVENTORY' });
  const duplicate = await captureSourceInventory({ ...options, clientBuffers: [options.clientBuffers[0], options.clientBuffers[0]] });
  assert.equal(duplicate.manifest.sourceReadComplete, false);
  assert.equal(duplicate.manifest.sources.find(row => row.id === 'client-buffers').code, 'INVALID_SOURCE');
  const invalid = await captureSourceInventory({ ...options, clientBuffers: [{ clientId: 123, buffers: [] }] });
  assert.equal(invalid.manifest.sourceReadComplete, false);
  assert.equal(invalid.manifest.sources.find(row => row.id === 'client-buffers').code, 'INVALID_SOURCE');
});
