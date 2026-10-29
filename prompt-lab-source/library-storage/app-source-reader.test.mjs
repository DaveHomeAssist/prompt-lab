import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAppLibrarySources, readExistingIndexedSource, readExtensionLibraryDrafts } from '../prompt-lab-extension/src/lib/librarySourceCapture.js';
import { inspectSourceInventory } from './source-inventory.mjs';

const selected = { database: 'prompt_lab_local', store: 'runs' };
const draftKeys = ['pl2-session', 'pl2-dual-draft'];

test('unselected databases and stores are rejected before any storage API call', async () => {
  const idb = { databases() { assert.fail('unselected database read'); }, open() { assert.fail('unselected database open'); } };
  for (const descriptor of [{ database: 'credentials', store: 'runs' }, { ...selected, store: 'settings' }]) {
    await assert.rejects(readExistingIndexedSource(descriptor, { idb }), { code: 'UNSELECTED_SOURCE' });
  }
  await assert.rejects(readExtensionLibraryDrafts(['auth'], { chromeApi: {} }), { code: 'UNSELECTED_SOURCE' });
});

test('unsupported enumeration and denied enumeration are failures, never absent databases', async () => {
  await assert.rejects(readExistingIndexedSource(selected, { idb: { open() { assert.fail('must not create a database'); } } }), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' });
  await assert.rejects(readExistingIndexedSource(selected, { idb: {
    databases() { throw new Error('private failure text'); }, open() { assert.fail('denied source open'); },
  } }), error => error.code === 'SOURCE_UNAVAILABLE' && !error.message.includes('private'));
});

test('stalled enumeration and open terminate without opening or retaining a late connection', async () => {
  let releaseListing, opened = 0, closed = 0, request;
  const delayed = readExistingIndexedSource(selected, { timeoutMs: 5, idb: {
    databases: () => new Promise(resolve => { releaseListing = resolve; }), open() { opened++; },
  } });
  await assert.rejects(delayed, { code: 'SOURCE_TIMEOUT' });
  releaseListing([{ name: selected.database, version: 4 }]);
  await Promise.resolve();
  assert.equal(opened, 0);
  await assert.rejects(readExistingIndexedSource(selected, { timeoutMs: 5, idb: {
    databases: async () => [{ name: selected.database, version: 4 }], open: () => (request = {}),
  } }), { code: 'SOURCE_TIMEOUT' });
  request.result = { close() { closed++; } }; request.onsuccess();
  assert.equal(closed, 1);
});

test('blocked open fails immediately and any eventual creation is aborted', async () => {
  let request, aborted = 0;
  const read = readExistingIndexedSource(selected, { idb: {
    databases: async () => [{ name: selected.database, version: 4 }],
    open: () => { request = {}; queueMicrotask(() => request.onblocked()); return request; },
  } });
  await assert.rejects(read, { code: 'SOURCE_BLOCKED' });
  request.transaction = { abort() { aborted++; } };
  request.onupgradeneeded();
  assert.equal(aborted, 1);
});

test('extension reads distinguish absent draft keys, denied access and a stalled callback', async () => {
  let requested;
  const chromeApi = { runtime: {}, storage: { session: { get(keys, callback) { requested = keys; callback({ 'pl2-session': { raw: 'draft', unknown: 7 } }); } } } };
  assert.deepEqual(await readExtensionLibraryDrafts(draftKeys, { chromeApi }), { 'pl2-session': { raw: 'draft', unknown: 7 }, 'pl2-dual-draft': null });
  assert.deepEqual(requested, draftKeys);
  chromeApi.runtime.lastError = { message: 'private session details' };
  await assert.rejects(readExtensionLibraryDrafts(draftKeys, { chromeApi }), error => error.code === 'SOURCE_UNAVAILABLE' && !error.message.includes('private'));
  chromeApi.storage.session.get = () => {};
  await assert.rejects(readExtensionLibraryDrafts(draftKeys, { chromeApi, timeoutMs: 5 }), { code: 'SOURCE_TIMEOUT' });
  await assert.rejects(readExtensionLibraryDrafts(draftKeys, { chromeApi: {} }), { code: 'SOURCE_CAPABILITY_UNAVAILABLE' });
});

test('app entry captures unavailable local and indexed sources independently without masking deletion evidence', async () => {
  const environment = { window: { __TAURI_INTERNALS__: {} }, get localStorage() { throw new Error('private denied local content'); },
    get indexedDB() { throw new Error('private denied journal'); } };
  const inventory = await captureAppLibrarySources({ sourceIdentity: 'disposable-desktop', archives: { reviewed: true, records: [] } }, environment);
  const { manifest } = await inspectSourceInventory(inventory);
  assert.equal(manifest.surface, 'desktop');
  assert.equal(manifest.sourceReadComplete, false);
  assert.equal(manifest.activationReady, false);
  assert.equal(manifest.sources.filter(source => source.state === 'unavailable').length, 6);
  assert.equal(manifest.sources.find(source => source.id === 'durable-journal').state, 'unavailable');
  assert.equal(JSON.stringify(inventory).includes('private denied'), false);
});
