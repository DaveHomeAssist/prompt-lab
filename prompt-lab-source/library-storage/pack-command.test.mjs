import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';
import { createLoopbackTransport, createServiceTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';

const stamp = '2026-10-29T17:30:00.000Z';
const fixture = () => ({ library: [
  { id: 'p', original: 'Complete prompt $& {{input}}', currentVersionId: 'current', metadata: { packId: 'pack', unknown: { preserved: true } },
    versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: true })), future: { text: 'x'.repeat(5000) } },
  { id: 'q', original: 'Unassigned prompt', metadata: { keep: true } }],
  packs: { pack: { id: 'pack', title: 'Original', source: 'user', version: '1', unknown: { old: true, nested: { keep: 1 } } } },
  loadedPacks: ['pack'], trash: [{ id: 't', original: 'Already trashed', metadata: { packId: 'pack' } }],
  scratch: { pads: [{ id: 'note', content: 'Keep' }], tombstones: {} }, future: { untouched: true } });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
async function select(service, id = 'select') {
  const review = await service.previewCurrentView(await query(service));
  assert.equal(review.commitAvailable, true, JSON.stringify(review.currentViewPlan.blocked));
  return service.apply({ ...review, idempotencyKey: id });
}
async function publish(service, value = fixture(), id = 'import', sourceIdentity = 'origin') {
  const entries = { 'pl2-library': JSON.stringify(value.library), 'pl2-library-trash': JSON.stringify(value.trash ?? []) };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity,
    localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture.' }), archives: { reviewed: true, records: [] }, capturedAt: stamp });
  const review = await service.preview({ ...await query(service), sourceText: JSON.stringify(value), sourceInventory, mode: 'import' });
  assert.equal(review.commitAvailable, true);
  const receipt = await service.apply({ ...review, idempotencyKey: id });
  await select(service, id + '-select'); return receipt;
}
async function records(service, domain) { return (await service.currentRecords({ ...await query(service), domain })).items; }
async function requestFor(service, sourceBinding, action = 'publish') {
  const page = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  const row = page.items.find(row => row.sourceId === 'q' && row.origin.binding === sourceBinding);
  return { ...await query(service), sourceBinding, changedAt: stamp, action, packId: 'pack', ...(action === 'remove'
    ? { confirmRemoval: true } : { pack: { id: 'pack', title: 'Published', version: '2', source: 'user', unknown: { nested: { added: 2 } } },
      members: [{ groupId: page.groups.find(group => group.selected === row.key).id, expectedRecordHash: row.valueHash }] }) };
}
async function mutate(service, input, id) {
  const review = await service.previewPack(input);
  assert.equal(review.commitAvailable, true, JSON.stringify(review.packPlan.currentViewPlan.blocked));
  return { review, receipt: await service.apply({ ...review, idempotencyKey: id }) };
}

test('pack publication changes membership and registry together, preserving unknown fields and full history', async () => {
  const service = createCommandService(createMemoryAdapter()), source = fixture(), imported = await publish(service, source), before = await service.read();
  const { receipt } = await mutate(service, await requestFor(service, imported.sourceBinding), 'publish-pack');
  assert.equal(receipt.operation, 'pack'); assert.equal(receipt.checkpointId, before.revision);
  const prompts = await records(service, 'prompts'), changed = prompts.find(row => row.sourceId === 'q').value;
  assert.deepEqual(changed.metadata, { keep: true, packId: 'pack', packName: 'Published', packSource: 'user' });
  assert.equal(changed.versions.length, 1); assert.deepEqual(prompts.find(row => row.sourceId === 'p').value, source.library[0]);
  const registry = (await records(service, 'packs'))[0].value;
  assert.deepEqual(registry.unknown, { old: true, nested: { keep: 1, added: 2 } });
  assert.deepEqual((await records(service, 'loaded-packs')).map(row => row.value), ['pack']);
  const after = await service.read(); for (const [id, object] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], object);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
});

test('pack removal atomically moves active members to Trash, clears markers, and checkpoint restore returns exact values', async () => {
  const service = createCommandService(createMemoryAdapter()), source = fixture(), imported = await publish(service, source), before = await service.read();
  await mutate(service, await requestFor(service, imported.sourceBinding, 'remove'), 'remove-pack');
  assert.deepEqual((await records(service, 'prompts')).map(row => row.sourceId), ['q']);
  assert.deepEqual(await records(service, 'packs'), []); assert.deepEqual(await records(service, 'loaded-packs'), []);
  const trash = await records(service, 'trash');
  assert.deepEqual(trash.find(row => row.sourceId === 'p').value, { ...source.library[0], deletedAt: stamp });
  assert.deepEqual(trash.find(row => row.sourceId === 't').value, source.trash[0]);
  const after = await service.read(); for (const [id, object] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], object);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const restore = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restore-select');
  const values = domain => records(service, domain).then(rows => rows.map(row => row.value).sort((a,b) => String(a.id).localeCompare(String(b.id))));
  assert.deepEqual(await values('prompts'), source.library); assert.deepEqual(await values('packs'), Object.values(source.packs));
  assert.deepEqual(await values('loaded-packs'), source.loadedPacks); assert.deepEqual(await values('trash'), source.trash);
});

test('starter pack removal works without a registry entry and never affects another source', async () => {
  const service = createCommandService(createMemoryAdapter()), source = fixture(); delete source.packs;
  const imported = await publish(service, source); const other = fixture(); other.library = [{ id: 'foreign', original: 'Foreign', metadata: { packId: 'pack' } }];
  await publish(service, other, 'foreign', 'foreign-origin');
  await mutate(service, await requestFor(service, imported.sourceBinding, 'remove'), 'remove-starter');
  assert.ok((await records(service, 'prompts')).some(row => row.sourceId === 'foreign'));
  assert.equal((await records(service, 'packs')).length, 1); assert.equal((await records(service, 'loaded-packs')).length, 1);
});

test('pack commands reject stale members, foreign sources, malformed actions and forged immutable plans', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), input = await requestFor(service, imported.sourceBinding);
  for (const patch of [{ action: 'install' }, { changedAt: '2026-02-30T00:00:00.000Z' }, { unexpected: true }, { members: [...input.members, ...input.members] }, { pack: { ...input.pack, id: 'other' } }]) {
    await assert.rejects(service.previewPack({ ...input, ...patch }), { code: 'INVALID_PACK_COMMAND' });
  }
  await assert.rejects(service.previewPack({ ...input, sourceBinding: 'sha256:' + '0'.repeat(64) }), { code: 'UNBOUND_SOURCE' });
  await assert.rejects(service.previewPack({ ...input, members: [{ ...input.members[0], expectedRecordHash: 'sha256:' + '0'.repeat(64) }] }), { code: 'RECORD_CONFLICT' });
  await mutate(service, input, 'publish'); await assert.rejects(service.previewPack(input), { code: 'REVISION_CONFLICT' });
  const state = await service.read(), commit = state.objects[state.revision].data, forged = structuredClone(state.objects[commit.packPlan].data);
  forged.changedMembers = []; const plan = await makeObject('pack-mutation-plan', forged), head = await makeObject('commit', { ...commit, packPlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'PACK_PLAN_MISMATCH' });
});

for (const action of ['publish', 'remove']) test(`pack ${action} survives interruption and response loss as one recoverable operation`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-pack-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure; const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected interruption'); } });
  const service = createCommandService(adapter), imported = await publish(service), before = await service.read();
  const review = await service.previewPack(await requestFor(service, imported.sourceBinding, action));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: action })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: action }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation(action);
  assert.equal(receipt.operation, 'pack'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: action }), receipt);
  assert.equal((await records(reopened, 'prompts')).length, action === 'remove' ? 1 : 2);
  assert.equal((await records(reopened, 'packs')).length, action === 'remove' ? 0 : 1);
  assert.equal((await records(reopened, 'loaded-packs')).length, action === 'remove' ? 0 : 1);
  assert.deepEqual((await inspectTransfer(await createTransfer(await reopened.read()))).state, await reopened.read());
});

for (const action of ['publish', 'remove']) test(`pack ${action} has direct/API parity and outbox replay without duplicate revisions`, async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service);
  const token = 'synthetic-pack-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const baseUrl = await api.listen(); t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => token });
  const request = { ...await requestFor(service, imported.sourceBinding, action), mode: 'pack' };
  const review = await createServiceTransport(service, { libraryId: 'lib' }).preview(request);
  assert.deepEqual((await transport.preview(request)).packPlan, review.packPlan);
  let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued-pack' });
  await assert.rejects(outbox.replay('lib', 'queued-pack', { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } }));
  assert.equal((await createCommandOutbox(store).replay('lib', 'queued-pack', transport)).state, 'committed');
  const revision = (await service.read()).revision; await outbox.replay('lib', 'queued-pack', transport);
  assert.equal((await service.read()).revision, revision);
});

test('publishing multiple selected prompts preserves all 41 existing history rows; republishing an uninstalled registry keeps metadata', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), source = fixture();
  const page = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  const input = await requestFor(service, imported.sourceBinding);
  input.members = page.items.map(row => ({ groupId: page.groups.find(group => group.selected === row.key).id, expectedRecordHash: row.valueHash }));
  await mutate(service, input, 'publish-all');
  const row = (await records(service, 'prompts')).find(row => row.sourceId === 'p');
  assert.equal(row.value.versions.length, 42); assert.deepEqual(row.value.versions.slice(0,41), source.library[0].versions);
  await mutate(service, await requestFor(service, imported.sourceBinding, 'remove'), 'remove-all');
  await mutate(service, { ...input, ...await query(service), members: [], pack: { ...input.pack, title: 'Explicit return', unknown: {} } }, 'republish');
  assert.equal((await records(service, 'prompts')).length, 0);
  assert.equal((await records(service, 'loaded-packs')).length, 0);
  assert.deepEqual((await records(service, 'packs'))[0].value.unknown, { old: true, nested: { keep: 1, added: 2 } });
});

test('new pack creation is source scoped; permanent registry deletion prevents reactivation', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service);
  const input = await requestFor(service, imported.sourceBinding); input.packId = 'new'; input.pack.id = 'new';
  await mutate(service, input, 'new-pack');
  const page = await service.currentRecords({ ...await query(service), domain: 'packs' }), row = page.items.find(row => row.sourceId === 'new');
  const remove = await service.previewRecord({ ...await query(service), action: 'delete', domain: 'packs',
    groupId: page.groups.find(group => group.selected === row.key).id, expectedRecordHash: row.valueHash, changedAt: stamp, confirmPermanentDeletion: true });
  await service.apply({ ...remove, idempotencyKey: 'delete' });
  await assert.rejects(service.previewPack({ ...input, ...await query(service), members: [] }), { code: 'IDENTITY_CONFLICT' });
});

test('uninstall remains selected after an older import; competing pack edits require explicit causal choices', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), base = await service.read();
  await mutate(service, await requestFor(service, imported.sourceBinding, 'remove'), 'uninstall');
  const old = await service.preview({ ...await query(service), mode: 'import', sourceText: JSON.stringify(fixture()) });
  assert.equal(old.commitAvailable, true); await service.apply({ ...old, idempotencyKey: 'old-import' }); await select(service, 'old-select');
  assert.equal((await records(service, 'packs')).length, 0); assert.equal((await records(service, 'loaded-packs')).length, 0);
  assert.deepEqual((await records(service, 'prompts')).map(row => row.sourceId), ['q']);
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  await mutate(left, { ...await requestFor(left, imported.sourceBinding), members: [] }, 'left');
  await mutate(right, await requestFor(right, imported.sourceBinding, 'remove'), 'right');
  const incoming = await createTransfer(await right.read()), review = await left.previewReconcile({ ...await query(left), incoming });
  assert.equal(review.commitAvailable, false);
  const resolutions = Object.fromEntries(review.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'incoming']));
  const resolved = await left.previewReconcile({ ...await query(left), incoming, resolutions });
  assert.equal(resolved.commitAvailable, true); await left.apply({ ...resolved, idempotencyKey: 'merge' }); await select(left, 'merge-select');
  assert.equal((await records(left, 'packs')).length, 0); assert.equal((await records(left, 'loaded-packs')).length, 0);
  assert.deepEqual((await inspectTransfer(await createTransfer(await left.read()))).state, await left.read());
});

test('pack publication cannot assign a prompt from another source or bypass read-only API access', async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service), input = await requestFor(service, imported.sourceBinding);
  const other = fixture(); other.library = [{ id: 'foreign', original: 'Foreign prompt' }];
  const foreign = await publish(service, other, 'other', 'other-source');
  await assert.rejects(service.previewPack({ ...input, ...await query(service), sourceBinding: foreign.sourceBinding }), { code: 'PACK_TARGET_UNAVAILABLE' });
  const token = 'synthetic-readonly-pack-token-'.repeat(2), api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read'], expiresAt: Date.now()+60000 }] });
  const baseUrl = await api.listen();t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => token });
  await assert.rejects(transport.preview({ ...input, ...await query(service), mode: 'pack' }), { code: 'FORBIDDEN' });
});
