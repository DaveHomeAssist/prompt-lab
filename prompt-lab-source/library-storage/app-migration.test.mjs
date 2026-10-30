import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandService, createMemoryAdapter, canonical, LibraryError, hash } from './contract.mjs';
import { createServiceTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createAppLibraryMigration, migrationWorkspace } from '../prompt-lab-extension/src/lib/libraryAppMigration.js';

function store() {
  const rows = new Map();
  return { rows,
    async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
    async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
    async write(value, version) {
      const key = canonical([value.libraryId, value.operationId]);
      if ((rows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Synthetic conflict');
      rows.set(key, structuredClone(value));
    },
  };
}
const ids = { libraryId: 'migration-test', operationId: 'migration-one' };
const fixtureRows = [{ id: 'p', title: 'Retained', original: '$& {{input}}', future: [null, false],
  versions: Array.from({ length: 41 }, (_, index) => ({ id: `v${index}`, original: `Version ${index}` })) }];
async function fixture(library = fixtureRows) {
  const local = { 'pl2-library': JSON.stringify(library), 'pl2-library-trash': '[]',
    'pl2-pads': '{"pads":[{"id":"note","text":"Keep Scratch","future":42}],"future":true}',
    'pl2-test-case-fallback': '[{"id":"fallback","promptId":"missing-prompt"}]' };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'app-origin',
    localStorage: { length: Object.keys(local).length, key: n => Object.keys(local)[n], getItem: key => local[key] ?? null },
    readIndexedStore: async ({ store }) => ({ state: 'present', records: [{ [store === 'runs' ? 'run_id' : 'id']: store, future: { complete: true } }] }),
    archives: { reviewed: true, records: [{ name: 'Original archive', future: true }] },
    clientBuffers: [{ clientId: 'client-1', buffers: [{ id: 'draft-recovery-store', value: {
      storage: 'sessionStorage', entries: { 'pl2-draft-reset-recovery-v1': '{"raw":"unparsed recovery"}' },
    } }, { id: 'editor', value: { raw: 'Unsaved buffer', future: 7 } }] }],
  });
  const coordination = { protocolVersion: 1, scope: 'cooperating-origin-clients', clientIds: ['client-1'], activationReady: false };
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const transport = createServiceTransport(service, ids);
  const backups = store(), commands = store(), outbox = createCommandOutbox(commands);
  let captures = 0;
  const options = { transport, backups, outbox, capture: async () => { captures++; return structuredClone({ inventory, coordination }); } };
  const migration = createAppLibraryMigration(options);
  return { adapter, service, transport, backups, commands, outbox, options, migration, inventory, coordination, captures: () => captures };
}
const prepare = f => f.migration.prepare({ ...ids, sourceIdentity: 'app-origin', archives: { reviewed: true, records: [] } });

test('migration retains a verified source backup before preview and copies the same complete capture', async () => {
  const f = await fixture();
  const prepared = await prepare(f);
  assert.equal(prepared.activationReady, false);
  assert.equal((await f.service.read()).revision, null);
  const backup = await f.migration.read(ids.libraryId, ids.operationId);
  assert.deepEqual(backup.sourceInventory, f.inventory);
  assert.deepEqual(JSON.parse(backup.sourceText), { library: fixtureRows, trash: [] });
  const reviewed = await f.migration.review(ids);
  assert.equal(reviewed.review.commitAvailable, true);
  const copied = await f.migration.copy({ ...ids, reviewed });
  assert.equal(copied.activationReady, false);
  assert.equal(copied.sourceReadbackVerified, true);
  assert.equal(copied.captureObjectsVerified, Object.keys(f.inventory.objects).length);
  assert.equal(copied.backupHash, prepared.backupHash);
  assert.equal(copied.copiedRevision, (await f.service.read()).revision);
  assert.deepEqual(await f.migration.read(ids.libraryId, ids.operationId), backup);
  assert.equal(f.captures(), 1);
});

test('initial migration keeps every occurrence even when IDs, text and titles match', async () => {
  const library = [{ ...fixtureRows[0], id: 'duplicate' }, { ...fixtureRows[0], id: 'duplicate' },
    { id: 'third', title: fixtureRows[0].title, original: 'Different body' }];
  const f = await fixture(library); await prepare(f);
  const reviewed = await f.migration.review(ids);
  assert.equal(reviewed.review.commitAvailable, true);
  assert.equal(reviewed.review.importPlan.manifest.groups.length, library.length);
  assert.ok(reviewed.review.importPlan.rows.every(row => row.choice.action === 'keep'));
  assert.equal((await f.migration.copy({ ...ids, reviewed })).sourceReadbackVerified, true);
  assert.equal((await f.service.read()).objects[reviewed.review.sourceBinding].kind, 'source-binding');
});

test('lost copy response resumes after reconstruction without capturing or committing again', async () => {
  const f = await fixture(); await prepare(f);
  const reviewed = await f.migration.review(ids);
  const migration = createAppLibraryMigration({ ...f.options, transport: { ...f.transport, apply: async input => {
    await f.transport.apply(input); throw new Error('Synthetic lost response');
  } } });
  await assert.rejects(migration.copy({ ...ids, reviewed }), /Synthetic lost response/);
  const before = await f.service.read();
  const restarted = createAppLibraryMigration({ ...f.options, outbox: createCommandOutbox(f.commands), capture() { throw new Error('Must not recapture'); } });
  const result = await restarted.resume(ids);
  assert.equal(result.copiedRevision, before.revision);
  assert.deepEqual(await f.service.read(), before);
  assert.equal(f.captures(), 1);
});

test('source backup failure prevents any destination preview or write', async () => {
  const f = await fixture(); let previews = 0;
  const migration = createAppLibraryMigration({ ...f.options,
    backups: { ...f.backups, async write() { throw new LibraryError('OUTBOX_WRITE_FAILED', 'Synthetic abort'); } },
    transport: { ...f.transport, preview() { previews++; } },
  });
  await assert.rejects(migration.prepare({ ...ids, sourceIdentity: 'app-origin' }), { code: 'MIGRATION_BACKUP_FAILED' });
  assert.equal(previews, 0); assert.equal((await f.service.read()).revision, null);
  assert.equal(f.commands.rows.size, 0);
});

test('unreadable backup, replaced source and wrong library cannot enter the command outbox', async () => {
  const f = await fixture(); await prepare(f);
  const reviewed = await f.migration.review(ids);
  reviewed.request.sourceText = '{"library":[],"trash":[]}';
  await assert.rejects(f.migration.copy({ ...ids, reviewed }), { code: 'REVIEW_CHANGED' });
  await assert.rejects(f.migration.prepare({ ...ids, libraryId: 'foreign', sourceIdentity: 'app-origin' }), { code: 'WRONG_LIBRARY' });
  assert.equal(f.captures(), 1);
  const key = canonical([ids.libraryId, ids.operationId]);
  f.backups.rows.get(key).sourceText = '{"library":[]}';
  await assert.rejects(f.migration.review(ids), { code: 'MIGRATION_BACKUP_INVALID' });
  assert.equal(f.commands.rows.size, 0); assert.equal((await f.service.read()).revision, null);
});

test('intervening destination edits retain the backup and require a new conflict review', async () => {
  const f = await fixture(); await prepare(f);
  const other = await f.service.preview({ libraryId: ids.libraryId, expectedRevision: null, sourceText: '{"library":[]}' });
  await f.service.apply({ ...other, idempotencyKey: 'other' });
  const before = await f.service.read();
  await assert.rejects(f.migration.review(ids), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await f.service.read(), before);
  assert.ok(await f.migration.read(ids.libraryId, ids.operationId));
});

test('verification after a later commit checks retained copy without requiring it to be the head', async () => {
  const f = await fixture(); await prepare(f);
  const copied = await f.migration.copy({ ...ids, reviewed: await f.migration.review(ids) });
  const preview = await f.service.previewCurrentView({ libraryId: ids.libraryId, expectedRevision: copied.copiedRevision });
  assert.equal(preview.commitAvailable, true, JSON.stringify(preview.currentViewPlan.blocked));
  const later = await f.service.apply({ ...preview, idempotencyKey: 'later-selection' });
  const before = await f.service.read();
  const resumed = await f.migration.resume(ids);
  assert.equal(resumed.copiedRevision, copied.copiedRevision);
  assert.equal(resumed.verifiedRevision, later.revision);
  assert.deepEqual(await f.service.read(), before);
});

test('readback corruption fails after commit, retaining the operation for a verified retry', async () => {
  const f = await fixture(); await prepare(f);
  const migration = createAppLibraryMigration({ ...f.options, transport: { ...f.transport, transfer: async revision => {
    const value = await f.transport.transfer(revision);
    delete value.objects[Object.keys(f.inventory.objects)[0]];
    return value;
  } } });
  await assert.rejects(migration.copy({ ...ids, reviewed: await f.migration.review(ids) }));
  assert.equal((await f.outbox.read(ids.libraryId, ids.operationId)).state, 'committed');
  const before = await f.service.read();
  assert.equal((await f.migration.resume(ids)).sourceReadbackVerified, true);
  assert.deepEqual(await f.service.read(), before);
});

test('every participant recovery record and exact membership are required', async () => {
  const f = await fixture(), source = structuredClone(f.inventory);
  const row = source.manifest.sources.find(row => row.id === 'client-buffers');
  source.objects[row.hash].data.records[0].buffers = [];
  const old = row.hash; row.hash = await hash(source.objects[old]); source.objects[row.hash] = source.objects[old]; delete source.objects[old];
  source.manifestHash = await hash(source.manifest);
  await assert.rejects(migrationWorkspace(source), { code: 'SOURCE_INCOMPLETE' });
  const mismatch = createAppLibraryMigration({ ...f.options, capture: async () => ({ inventory: f.inventory,
    coordination: { ...f.coordination, clientIds: ['another-client'] } }) });
  await assert.rejects(mismatch.prepare({ ...ids, sourceIdentity: 'app-origin' }), { code: 'MIGRATION_BACKUP_INVALID' });
});

test('unreviewed archives prevent backup acknowledgement and all destination writes', async () => {
  const f = await fixture(), inventory = structuredClone(f.inventory);
  const row = inventory.manifest.sources.find(row => row.id === 'selected-archives'), old = row.hash;
  inventory.objects[old].data.reviewed = false; inventory.objects[old].data.state = 'unreviewed';
  row.state = 'unreviewed'; row.hash = await hash(inventory.objects[old]);
  inventory.objects[row.hash] = inventory.objects[old]; delete inventory.objects[old];
  inventory.manifest.sourceReadComplete = false; inventory.manifestHash = await hash(inventory.manifest);
  const migration = createAppLibraryMigration({ ...f.options, capture: async () => ({ inventory, coordination: f.coordination }) });
  await assert.rejects(migration.prepare({ ...ids, sourceIdentity: 'app-origin' }), { code: 'SOURCE_INCOMPLETE' });
  assert.equal(f.backups.rows.size, 0); assert.equal(f.commands.rows.size, 0); assert.equal((await f.service.read()).revision, null);
});

test('a conflicting import keeps both the original library and the uncommitted source backup', async () => {
  const f = await fixture();
  const original = await f.service.preview({ libraryId: ids.libraryId, expectedRevision: null,
    sourceText: JSON.stringify({ library: [{ ...fixtureRows[0], original: 'Different existing text' }] }) });
  await f.service.apply({ ...original, idempotencyKey: 'original' });
  await prepare(f); const before = await f.service.read();
  const reviewed = await f.migration.review(ids);
  assert.equal(reviewed.review.commitAvailable, false);
  await assert.rejects(f.migration.copy({ ...ids, reviewed }), { code: 'REVIEW_REQUIRED' });
  assert.deepEqual(await f.service.read(), before);
  assert.equal(f.commands.rows.size, 0);
  assert.deepEqual((await f.migration.read(ids.libraryId, ids.operationId)).sourceInventory, f.inventory);
});
