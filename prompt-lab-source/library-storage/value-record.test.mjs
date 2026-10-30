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

const stamp = '2026-10-29T20:00:00.000Z';
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const fixture = () => ({ library: [{ id: 'prompt', original: 'Prompt', artwork: { url: 'nested', future: true },
  versions: [{ id: 'v1', original: 'Original', unknown: ['retained'] }] }],
  packs: { pack: { title: 'Pack', future: true } }, loadedPacks: ['pack'], assets: { named: 'raw artwork' } });
const localFixture = () => ({ 'pl2-session-pl2-session': JSON.stringify({ draft: 'Before', future: { keep: ['unknown'], edit: 1 } }),
  'pl2-session-pl2-dual-draft': JSON.stringify(['old', { future: true }]),
  'pl2-recent-artwork': JSON.stringify([{ url: 'anonymous', future: { keep: ['art'], edit: 1 } }]),
  'pl2-draft-reset-recovery-v1': JSON.stringify('raw recovery \u0000 🧪') });
async function select(service, id) {
  const review = await service.previewCurrentView(await query(service));
  assert.equal(review.commitAvailable, true, JSON.stringify(review.currentViewPlan));
  return service.apply({ ...review, idempotencyKey: id });
}
async function publish(service, { content = fixture(), local = localFixture(), sourceIdentity = 'origin', id = 'import', mode = 'import' } = {}) {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...local };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity,
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture.' }), archives: { reviewed: true, records: [] }, capturedAt: stamp });
  const review = await service.preview({ ...await query(service), sourceText: JSON.stringify(content), sourceInventory, mode });
  assert.equal(review.commitAvailable, true);
  const receipt = await service.apply({ ...review, idempotencyKey: id });
  if (mode === 'import') await select(service, id + '-select');
  return receipt;
}
const records = async (service, domain) => (await service.currentRecords({ ...await query(service), domain })).items;
async function target(service, domain, predicate = () => true) {
  const page = await service.currentRecords({ ...await query(service), domain });
  const row = page.items.find(predicate), group = page.groups.find(group => group.selected === row?.key);
  assert.ok(row && group);
  return { ...await query(service), domain, changedAt: stamp, groupId: group.id, expectedRecordHash: row.valueHash };
}
async function mutate(service, input, id) {
  const review = await service.previewRecord(input);
  assert.equal(review.commitAvailable, true, JSON.stringify(review.recordPlan.currentViewPlan));
  return { review, receipt: await service.apply({ ...review, idempotencyKey: id }) };
}
async function update(service, domain, id, value = 2) {
  return mutate(service, { ...await target(service, domain, row => row.value?.future?.keep), action: 'update',
    updates: [{ path: ['future', 'edit'], value }] }, id);
}

for (const domain of ['drafts', 'assets']) test(`${domain} anonymous field changes retain identity, unknown fields and unrelated selections`, async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const before = await service.read();
  const initialPage = await service.currentRecords({ ...await query(service), domain });
  const initial = initialPage.items.find(row => row.value?.future?.keep);
  assert.equal(initial.sourceId, null);
  const input = await target(service, domain, row => row.value?.future?.keep);
  await update(service, domain, 'change');
  const page = await service.currentRecords({ ...await query(service), domain });
  const changed = page.items.find(row => row.commandGroupId === input.groupId);
  assert.equal(page.items.length, initialPage.items.length);
  assert.equal(changed.sourceId, null);
  assert.deepEqual(changed.value, { ...initial.value, future: { ...initial.value.future, edit: 2 } });
  assert.equal(page.groups.find(group => group.id === input.groupId).candidates.length, 2);
  assert.deepEqual((await records(service, 'prompts'))[0].value, fixture().library[0]);
  const beforeView = (await inspectPackage(pkg(before))).currentView;
  for (const group of beforeView.groups.filter(group => group.id !== input.groupId)) {
    assert.equal(page.groups.find(row => row.id === group.id).selected, group.selected);
  }
  await update(service, domain, 'change-again', 3);
  assert.equal((await records(service, domain)).filter(row => row.commandGroupId === input.groupId).length, 1);
  const after = await service.read();
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  for (const [key, value] of Object.entries(before.operations)) assert.deepEqual(after.operations[key], value);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
});

for (const [domain, value] of [['drafts', null], ['assets', ['image', { future: true }]], ['recovery', 'raw \u0000 bytes'], ['loaded-packs', 'new-pack']]) {
  test(`${domain} creates values without inserting IDs and retains confirmed deletion across restore and import`, async () => {
    const service = createCommandService(createMemoryAdapter()), imported = await publish(service), before = await service.read();
    const recordId = domain === 'loaded-packs' ? value : 'new-record';
    const creation = { ...await query(service), domain, action: 'create', changedAt: stamp, sourceBinding: imported.sourceBinding, recordId, record: value };
    await mutate(service, creation, 'create');
    assert.deepEqual((await records(service, domain)).find(row => row.sourceId === recordId).value, value);
    await mutate(service, { ...await target(service, domain, row => row.sourceId === recordId), action: 'delete', confirmPermanentDeletion: true }, 'delete');
    const restore = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
    assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored-select');
    await publish(service, { id: 'old-import' });
    assert.equal((await records(service, domain)).some(row => row.sourceId === recordId), false);
    await assert.rejects(service.previewRecord({ ...creation, ...await query(service) }), { code: 'IDENTITY_CONFLICT' });
    assert.deepEqual((await records(service, 'packs'))[0].value, fixture().packs.pack);
  });
}

for (const [domain, predicate, value] of [['drafts', row => Array.isArray(row.value), ['new', { keep: 'complete' }]],
  ['assets', row => row.sourceId === 'named', 'new artwork'], ['recovery', () => true, { recovered: true, future: ['kept'] }]]) {
  test(`${domain} replaces a legacy value and restores its exact old shape with one group`, async () => {
    const service = createCommandService(createMemoryAdapter()); await publish(service); const before = await service.read();
    const original = (await records(service, domain)).find(predicate), input = await target(service, domain, predicate);
    await mutate(service, { ...input, action: 'replace', value }, 'replace');
    const changed = (await records(service, domain)).filter(row => row.commandGroupId === input.groupId);
    assert.equal(changed.length, 1); assert.deepEqual(changed[0].value, value); assert.equal(changed[0].sourceId, original.sourceId);
    const restore = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
    assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored-select');
    assert.deepEqual((await records(service, domain)).find(predicate).value, original.value);
  });
}

test('legacy anonymous deletion is source scoped and remains final after older imports and snapshot restore', async () => {
  const service = createCommandService(createMemoryAdapter()); const snapshot = await publish(service, { mode: 'snapshot', id: 'snapshot' });
  await publish(service); const input = await target(service, 'assets', row => row.value?.url === 'anonymous');
  await mutate(service, { ...input, action: 'delete', confirmPermanentDeletion: true }, 'delete');
  const restore = await service.previewRestore({ ...await query(service), checkpointId: snapshot.revision });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored-select');
  await publish(service, { id: 'older-import' });
  assert.equal((await records(service, 'assets')).filter(row => row.value?.url === 'anonymous').length, 0);
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'assets' })).groups.find(row => row.id === input.groupId).selected, null);
  await publish(service, { content: { ...fixture(), library: [{ id: 'other', original: 'Other' }] }, sourceIdentity: 'other-origin', id: 'other' });
  assert.equal((await records(service, 'assets')).filter(row => row.value?.url === 'anonymous').length, 1);
});

test('anonymous records reconcile independently and competing edits require an explicit branch', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  for (const same of [false, true]) {
    const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
    await update(left, 'assets', 'left'); await update(right, same ? 'assets' : 'drafts', 'right', 3);
    const incoming = await createTransfer(await right.read());
    let review = await left.previewReconcile({ ...await query(left), incoming });
    assert.equal(review.commitAvailable, !same);
    const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict); assert.equal(conflicts.length, same ? 1 : 0);
    if (same) review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflicts[0].groupId]: 'incoming' } });
    await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
    assert.equal((await records(left, 'assets')).find(row => row.value?.future?.keep).value.future.edit, same ? 3 : 2);
    assert.equal((await records(left, 'drafts')).find(row => row.value?.future?.keep).value.future.edit, same ? 1 : 3);
    assert.deepEqual((await inspectTransfer(await createTransfer(await left.read()))).state, await left.read());
  }
});

test('value commands reject stale values, implicit metadata loss, nested artwork and loaded-pack identity changes', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), before = await service.read();
  const draft = await target(service, 'drafts', row => row.value?.future?.keep);
  await assert.rejects(service.previewRecord({ ...draft, action: 'replace', value: {} }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...draft, action: 'update', updates: [{ path: ['id'], value: 'other' }] }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...draft, expectedRecordHash: 'sha256:' + '0'.repeat(64), action: 'delete', confirmPermanentDeletion: true }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(service.previewRecord({ ...await target(service, 'recovery'), action: 'update', updates: [{ path: ['x'], value: 1 }] }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...await target(service, 'recovery'), action: 'replace' }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...await target(service, 'loaded-packs'), action: 'replace', value: 'other' }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...await query(service), domain: 'loaded-packs', action: 'create', changedAt: stamp,
    sourceBinding: imported.sourceBinding, recordId: 'new', record: 'different' }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...await query(service), domain: 'recovery', action: 'create', changedAt: stamp,
    sourceBinding: imported.sourceBinding, recordId: 'singleton', record: 'Cannot claim the legacy group' }), { code: 'IDENTITY_CONFLICT' });
  const nested = (await records(service, 'assets')).find(row => row.value?.url === 'nested');
  await assert.rejects(service.previewRecord({ ...draft, domain: 'assets', groupId: nested.key, expectedRecordHash: nested.valueHash,
    action: 'delete', confirmPermanentDeletion: true }), { code: 'RECORD_TARGET_UNAVAILABLE' });
  assert.deepEqual(await service.read(), before);
});

test('anonymous deletion constrains a competing edit even when its branch is explicitly selected', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  const input = await target(left, 'assets', row => row.value?.url === 'anonymous');
  await mutate(left, { ...input, action: 'delete', confirmPermanentDeletion: true }, 'deleted');
  await update(right, 'assets', 'edited');
  const incoming = await createTransfer(await right.read());
  let review = await left.previewReconcile({ ...await query(left), incoming });
  assert.equal(review.commitAvailable, false);
  const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict); assert.equal(conflicts.length, 1);
  review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflicts[0].groupId]: 'incoming' } });
  await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'reconciled-select');
  assert.equal((await records(left, 'assets')).some(row => row.value?.url === 'anonymous'), false);
  for (const [key, value] of Object.entries(base.objects)) assert.deepEqual((await left.read()).objects[key], value);
});

test('imported command lookalikes cannot introduce value groups and hash-valid forged metadata is rejected', async () => {
  const content = fixture(); content.valueRecords = [{ domain: 'drafts', groupId: 'sha256:' + '0'.repeat(64), sourceId: 'forged', value: 'Injected' }];
  content.recordMutation = { domain: 'drafts' };
  const service = createCommandService(createMemoryAdapter()); await publish(service, { content });
  assert.equal((await records(service, 'drafts')).some(row => row.sourceId === 'forged'), false);
  await update(service, 'drafts', 'update');
  const state = await service.read(), commit = state.objects[state.revision].data;
  const forged = structuredClone(state.objects[commit.recordPlan].data); forged.derivedSource.groupId = 'sha256:' + '0'.repeat(64);
  const plan = await makeObject('record-mutation-plan', forged), head = await makeObject('commit', { ...commit, recordPlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'RECORD_PLAN_MISMATCH' });
});

for (const domain of ['drafts', 'assets', 'recovery', 'loaded-packs']) test(`${domain} folder interruption and lost acknowledgement preserve atomicity through reopen and transfer`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-value-record-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure;
  const adapter = await createFolderAdapter(directory, { fault: async point => { if (point === failure) throw new Error('Injected interruption'); } });
  const service = createCommandService(adapter), imported = await publish(service);
  const before = await service.read(), value = domain === 'loaded-packs' ? 'new-pack' : { future: ['complete'] };
  const review = await service.previewRecord({ ...await query(service), domain, action: 'create', changedAt: stamp,
    sourceBinding: imported.sourceBinding, recordId: 'new-pack', record: value });
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'write' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'write' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('write');
  assert.equal(receipt.operation, 'record'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'write' }), receipt);
  assert.deepEqual((await records(reopened, domain)).find(row => row.sourceId === 'new-pack').value, value);
  const state = await reopened.read(); assert.deepEqual((await inspectTransfer(await createTransfer(state))).state, state);
});

for (const [domain, action] of [['drafts', 'update'], ['assets', 'create'], ['recovery', 'replace'], ['loaded-packs', 'delete']]) {
  test(`${domain} ${action} shares API reviews and recovers a durable queued response loss`, async t => {
    const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service);
    const token = 'synthetic-value-credential-'.repeat(2);
    const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
    const url = await api.listen(); t.after(() => api.close());
    const direct = createServiceTransport(service, { libraryId: 'lib' }), transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
    const input = action === 'create' ? { ...await query(service), sourceBinding: imported.sourceBinding, recordId: 'created', record: ['bytes'] }
      : await target(service, domain, row => domain !== 'drafts' || row.value?.future?.keep);
    const request = { ...input, domain, action, changedAt: stamp, mode: 'record', ...(action === 'update'
      ? { updates: [{ path: ['draft'], value: 'Queued' }] } : action === 'replace' ? { value: 'Recovered' } : action === 'delete' ? { confirmPermanentDeletion: true } : {}) };
    const review = await direct.preview(request); assert.deepEqual((await transport.preview(request)).recordPlan, review.recordPlan);
    let entry = null;
    const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
      assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
    } };
    const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued' });
    await assert.rejects(outbox.replay('lib', 'queued', { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } }));
    const committed = await createCommandOutbox(store).replay('lib', 'queued', transport);
    assert.equal(committed.state, 'committed'); assert.equal(Object.keys((await service.read()).operations).length, 3);
    const rows = await records(service, domain);
    if (action === 'delete') assert.equal(rows.length, 0);
    else if (action === 'update') assert.equal(rows.find(row => row.value?.future?.keep).value.draft, 'Queued');
    else if (action === 'replace') assert.equal(rows[0].value, 'Recovered');
    else assert.deepEqual(rows.find(row => row.sourceId === 'created').value, ['bytes']);
  });
}
