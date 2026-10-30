import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createServiceTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';
import { createAppLibraryRepository } from '../prompt-lab-extension/src/lib/appLibraryRepository.js';
import { createPromptLibraryStore } from '../prompt-lab-extension/src/lib/promptLibraryStore.js';
import { changeFolder, reconcileFolders } from '../prompt-lab-extension/src/lib/collectionFolders.js';

globalThis.window = { dispatchEvent() {} };
async function fixture() {
  const workspace = { library: [{ id: 'prompt', title: 'Preserved', original: 'Preserved', collection: 'Ops/Shows', folderId: 'child',
    currentVersionId: 'current', versions: Array.from({ length: 31 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: true })), future: { keep: true } }],
  trash: [], folders: [{ id: 'root', name: 'Ops', parentId: null, collection: 'Ops', future: [null, false],
    artwork: { image: 'opaque-future-format', emoji: '📁', future: { bytes: 'retained' } } },
  { id: 'child', name: 'Shows', parentId: 'root', collection: 'Ops/Shows', artwork: { icon: 'Star' } }], collections: ['Ops', 'Ops/Shows'] };
  const values = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]' };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'folder-ui-fixture',
    localStorage: { length: 2, key: i => Object.keys(values)[i], getItem: key => values[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const imported = await service.apply({ ...await service.preview({ libraryId: 'lib', expectedRevision: null, mode: 'import',
    sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
  await service.apply({ ...await service.previewCurrentView({ libraryId: 'lib', expectedRevision: imported.revision }), idempotencyKey: 'select' });
  const rows = new Map(), storage = {
    async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
    async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
    async write(row, version) {
      const key = canonical([row.libraryId, row.operationId]);
      if ((rows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Concurrent fixture write');
      rows.set(key, structuredClone(row));
    },
  };
  let offline = false;
  const transport = createServiceTransport(service, { libraryId: 'lib' });
  const options = { libraryId: 'lib', sourceBinding: imported.sourceBinding, outbox: createCommandOutbox(storage), transport: {
    ...transport, identity: () => { if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Offline fixture'); return transport.identity(); },
  } };
  const repository = createAppLibraryRepository(options), lib = createPromptLibraryStore(repository); await lib.open();
  return { workspace, service, options, repository, lib, setOffline: value => { offline = value; } };
}

test('connected folders create, rename, move, change artwork and remove atomically with complete prompt history', async () => {
  const f = await fixture(), before = await f.service.read();
  assert.equal(await f.lib.saveFolders([...f.lib.folders, { id: 'later', name: 'Later', parentId: null, collection: 'Later', artwork: {}, future: true }]), true);
  assert.equal(await f.lib.saveFolders(changeFolder(f.lib.folders, 'root', { name: 'Production' })), true);
  assert.equal(f.lib.library[0].collection, 'Production/Shows');
  assert.equal(await f.lib.saveFolders(changeFolder(f.lib.folders, 'child', { parentId: 'later' })), true);
  assert.equal(f.lib.library[0].collection, 'Later/Shows');
  const beforeArtwork = await f.repository.readRecord('prompts', 'prompt');
  assert.equal(await f.lib.saveFolders(f.lib.folders.map(row => row.id === 'root' ? { ...row, artwork: { icon: '', image: '', emoji: '🧪' } } : row)), true);
  const root = f.lib.folders.find(row => row.id === 'root');
  assert.equal(root.artwork.emoji, '🧪'); assert.equal(root.artwork.image, 'opaque-future-format');
  assert.deepEqual(root.artwork.future, { bytes: 'retained' }); assert.deepEqual(root.future, [null, false]);
  assert.equal(canonical(await f.repository.readRecord('prompts', 'prompt')), canonical(beforeArtwork));
  assert.equal(await f.lib.deleteCollection('Later'), false); assert.match(f.lib.saveError, /subfolders/);
  assert.equal(await f.lib.deleteCollection('Later/Shows'), true);
  const prompt = await f.repository.readRecord('prompts', 'prompt');
  assert.equal(prompt.folderId, ''); assert.equal(prompt.collection, '');
  assert.equal(prompt.versions.length, 34); assert.deepEqual(prompt.versions.slice(0, 31), f.workspace.library[0].versions);
  assert.deepEqual(prompt.future, { keep: true });
  for (const [id, object] of Object.entries(before.objects)) assert.deepEqual((await f.service.read()).objects[id], object);
  assert.equal(Object.keys((await f.service.read()).operations).length, 7);
});

test('offline folder intent retains one identity and replays after repository restart', async () => {
  const f = await fixture(), next = changeFolder(f.lib.folders, 'root', { name: 'Offline renamed' });
  f.setOffline(true); assert.equal(await f.lib.saveFolders(next), false);
  const pending = (await f.repository.pending())[0];
  assert.equal(pending.schemaVersion, 3); assert.equal(pending.request.mode, 'folder'); assert.equal(pending.reviewHash, null);
  assert.equal(f.lib.library[0].collection, 'Ops/Shows');
  assert.equal(await f.lib.saveFolders(changeFolder(f.lib.folders, 'root', { name: 'Different' })), false);
  f.setOffline(false);
  const reopened = createAppLibraryRepository(f.options), lib = createPromptLibraryStore(reopened); await lib.open();
  await lib.retryPending();
  assert.equal(lib.library[0].collection, 'Offline renamed/Shows');
  assert.equal((await reopened.pending())[0].operationId, pending.operationId);
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
  assert.equal(await f.lib.saveFolders(next), true);
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
});

test('stale folders and unrelated metadata edits fail without changing the committed projection', async () => {
  const f = await fixture(), original = await f.service.read();
  const unexpected = changeFolder(f.lib.folders, 'root', { name: 'Rename' }); unexpected[0].future = 'not reviewed';
  assert.equal(await f.lib.saveFolders(unexpected), false); assert.deepEqual(await f.service.read(), original);
  assert.equal((await f.repository.pending()).length, 0);
  const other = createPromptLibraryStore(createAppLibraryRepository(f.options)); await other.open();
  assert.equal(await other.saveFolders(changeFolder(other.folders, 'root', { name: 'Elsewhere' })), true);
  const committed = await f.service.read();
  assert.equal(await f.lib.saveFolders(changeFolder(f.lib.folders, 'root', { name: 'Stale' })), false);
  assert.deepEqual(await f.service.read(), committed); assert.match(f.lib.saveError, /revision|changed|review/i);
});

test('bulk, inspector and editor collection changes keep folder IDs and paths consistent', async () => {
  const f = await fixture();
  assert.deepEqual(await f.lib.moveEntriesToCollection(['prompt'], 'Ops'), { completed: 1, requested: 1 });
  assert.equal((await f.repository.readRecord('prompts', 'prompt')).folderId, 'root');
  assert.equal(await f.lib.saveEntryDetails('prompt', entry => ({ ...entry, collection: '' })), true);
  assert.equal((await f.repository.readRecord('prompts', 'prompt')).folderId, '');
  const entry = f.lib.library[0];
  assert.ok(await f.lib.doSave({ editingId: entry.id, expectedVersionId: entry.currentVersionId, raw: entry.original,
    enhanced: entry.enhanced, title: entry.title, variants: entry.variants, notes: entry.notes, tags: entry.tags, collection: 'Ops/Shows' }));
  const saved = await f.repository.readRecord('prompts', 'prompt');
  assert.equal(saved.folderId, 'child'); assert.equal(saved.collection, 'Ops/Shows');
  assert.deepEqual(saved.versions.slice(0, 31), f.workspace.library[0].versions);
  const before = await f.service.read();
  assert.equal(await f.lib.saveEntryDetails('prompt', row => ({ ...row, collection: 'Missing' })), false);
  assert.deepEqual(await f.service.read(), before);
  assert.equal(await f.lib.saveFolders(reconcileFolders(f.lib.folders)), false);
});
