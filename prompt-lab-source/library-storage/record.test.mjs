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

const domains = { evaluations: 'evaluations', 'test-cases': 'testCases', 'execution-traces': 'traceRuns', experiments: 'experiments' };
const identity = domain => domain === 'execution-traces' ? 'run_id' : 'id';
const stamp = '2026-10-29T16:00:00.000Z';
const fixture = () => ({ library: [{ id: 'prompt', original: 'Prompt', versions: [{ id: 'v1', original: 'Original', unknown: ['retained'] }] }],
  evaluations: [{ id: 'eval', output: 'Before', promptId: 'prompt', future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  testCases: [{ id: 'case', input: 'Case', promptId: 'prompt', future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  traceRuns: [{ run_id: 'trace', trace_id: 'parent', outputs: { text: 'Trace' }, future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  experiments: [{ id: 'experiment', variants: [{ id: 'variant', long: 'v'.repeat(5000), unknown: true }], future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  scratch: { pads: [{ id: 'note', content: 'Keep this note', unknown: 9 }], tombstones: {} }, trash: [] });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
async function publish(service, value = fixture(), operationId = 'import', sourceIdentity = 'origin', mode = 'import') {
  const entries = { 'pl2-library': JSON.stringify(value.library), 'pl2-library-trash': JSON.stringify(value.trash ?? []) };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity,
    localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture.' }), archives: { reviewed: true, records: [] }, capturedAt: stamp });
  let review = await service.preview({ ...await query(service), sourceText: JSON.stringify(value), sourceInventory, mode });
  assert.equal(review.commitAvailable, true);
  const receipt = await service.apply({ ...review, idempotencyKey: operationId });
  if (mode === 'import') await select(service, operationId + '-select');
  return receipt;
}
async function select(service, id = 'select') {
  const review = await service.previewCurrentView(await query(service));
  assert.equal(review.commitAvailable, true, JSON.stringify(review.currentViewPlan.blocked));
  return service.apply({ ...review, idempotencyKey: id });
}
async function inputFor(service, domain, action = 'update', sourceId) {
  const page = await service.currentRecords({ ...await query(service), domain });
  const row = sourceId ? page.items.find(row => row.sourceId === sourceId) : page.items[0];
  const group = page.groups.find(group => group.selected === row?.key);
  assert.ok(row && group);
  return { ...await query(service), domain, action, changedAt: stamp, groupId: group.id, expectedRecordHash: row.valueHash,
    ...(action === 'delete' ? { confirmPermanentDeletion: true } : { updates: [{ path: ['future', 'edit'], value: 2 }] }) };
}
async function mutate(service, input, id) {
  const review = await service.previewRecord(input);
  assert.equal(review.commitAvailable, true, JSON.stringify(review.recordPlan.currentViewPlan.blocked));
  return { review, receipt: await service.apply({ ...review, idempotencyKey: id }) };
}
async function records(service, domain) { return (await service.currentRecords({ ...await query(service), domain })).items; }

for (const [domain, key] of Object.entries(domains)) test(`${domain} create, nested update and confirmed delete retain every prior object and unrelated selection`, async () => {
  const service = createCommandService(createMemoryAdapter()), content = fixture();
  const imported = await publish(service, content), before = await service.read();
  const priorView = (await inspectPackage(pkg(before))).currentView;
  const input = await inputFor(service, domain);
  const { receipt } = await mutate(service, input, 'update');
  const expected = structuredClone(content[key][0]); expected.future.edit = 2;
  assert.deepEqual((await records(service, domain))[0].value, expected);
  const current = await service.read(), view = (await inspectPackage(pkg(current))).currentView;
  for (const group of priorView.groups.filter(group => group.id !== input.groupId)) assert.equal(view.groups.find(row => row.id === group.id).selected, group.selected);
  assert.equal(receipt.checkpointId, before.revision);
  const created = { [identity(domain)]: 'new-record', unknown: { value: ['kept', null, false] } };
  await mutate(service, { ...await query(service), action: 'create', domain, changedAt: stamp, sourceBinding: imported.sourceBinding, record: created }, 'create');
  assert.deepEqual((await records(service, domain)).find(row => row.sourceId === 'new-record').value, created);
  const deletion = await mutate(service, await inputFor(service, domain, 'delete', 'new-record'), 'delete');
  assert.equal((await records(service, domain)).length, 1);
  const after = await service.read();
  for (const [id, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], value);
  for (const [id, value] of Object.entries(before.operations)) assert.deepEqual(after.operations[id], value);
  const transferred = (await inspectTransfer(await createTransfer(after))).state;
  assert.deepEqual(transferred, after);
  const reopened = createCommandService(createMemoryAdapter(transferred));
  assert.deepEqual(await reopened.apply({ ...deletion.review, idempotencyKey: 'delete' }), deletion.receipt);
  await assert.rejects(reopened.previewRecord({ ...await query(reopened), domain, action: 'create', changedAt: stamp, sourceBinding: imported.sourceBinding, record: created }), { code: 'IDENTITY_CONFLICT' });
});

test('record changes reject stale identity, invalid fields, wrong source and unreviewed selections', async () => {
  const service = createCommandService(createMemoryAdapter()); const imported = await publish(service);
  const input = await inputFor(service, 'evaluations');
  for (const updates of [[{ path: ['id'], value: 'changed' }], [{ path: ['__proto__'], value: {} }],
    [{ path: ['future'], value: {} }, { path: ['future', 'edit'], value: 3 }], [{ path: ['output'], value: false }], [{ path: ['output', 'nested'], value: 3 }]]) {
    await assert.rejects(service.previewRecord({ ...input, updates }), { code: 'INVALID_RECORD_COMMAND' });
  }
  await assert.rejects(service.previewRecord({ ...input, expectedRecordHash: 'sha256:' + '0'.repeat(64) }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(service.previewRecord({ ...input, libraryId: 'wrong' }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(service.previewRecord({ ...input, action: 'delete', updates: undefined }), { code: 'INVALID_JSON' });
  const { updates, ...deletion } = input;
  await assert.rejects(service.previewRecord({ ...deletion, action: 'delete', confirmPermanentDeletion: false }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...await query(service), domain: 'evaluations', action: 'create', changedAt: stamp,
    sourceBinding: 'sha256:' + '0'.repeat(64), record: { id: 'new' } }), { code: 'UNBOUND_SOURCE' });
  await assert.rejects(service.previewRecord({ ...await query(service), domain: 'evaluations', action: 'create', changedAt: stamp,
    sourceBinding: imported.sourceBinding, record: { id: 'eval', output: 'new' } }), { code: 'IDENTITY_CONFLICT' });
  await mutate(service, input, 'changed');
  await assert.rejects(service.previewRecord(input), { code: 'REVISION_CONFLICT' });
  const view = await service.previewCurrentView(await query(service));
  await assert.rejects(service.previewCurrentView({ ...await query(service), resolutions: { [input.groupId]: null } }), { code: 'INVALID_RESOLUTIONS' });
  assert.equal(view.commitAvailable, true);
});

test('checkpoint restore reinstates prior record values and keeps later creation inactive and deletion final', async () => {
  const service = createCommandService(createMemoryAdapter()); const imported = await publish(service), original = await service.read();
  await mutate(service, await inputFor(service, 'evaluations'), 'edit');
  await mutate(service, { ...await query(service), domain: 'test-cases', action: 'create', changedAt: stamp,
    sourceBinding: imported.sourceBinding, record: { id: 'created-later', input: 'Later' } }, 'create');
  await mutate(service, await inputFor(service, 'experiments', 'delete'), 'delete');
  const restore = await service.previewRestore({ ...await query(service), checkpointId: original.revision });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'after-restore');
  assert.deepEqual((await records(service, 'evaluations'))[0].value, fixture().evaluations[0]);
  assert.equal((await records(service, 'test-cases')).length, 1);
  assert.equal((await records(service, 'experiments')).length, 0);
  await publish(service, fixture(), 'older-import');
  assert.equal((await records(service, 'experiments')).length, 0);
  assert.equal((await records(service, 'test-cases')).length, 1);
});

test('independent record changes reconcile causally while concurrent changes require an explicit branch', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  for (const same of [false, true]) {
    const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
    await mutate(left, await inputFor(left, 'evaluations'), 'left');
    const input = await inputFor(right, same ? 'evaluations' : 'test-cases'); input.updates[0].value = 3;
    await mutate(right, input, 'right');
    const incoming = await createTransfer(await right.read());
    let review = await left.previewReconcile({ ...await query(left), incoming });
    assert.equal(review.commitAvailable, !same);
    const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict);
    assert.equal(conflicts.length, same ? 1 : 0);
    if (same) review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflicts[0].groupId]: 'incoming' } });
    await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
    assert.equal((await records(left, 'evaluations'))[0].value.future.edit, same ? 3 : 2);
    assert.equal((await records(left, 'test-cases'))[0].value.future.edit, same ? 1 : 3);
    assert.deepEqual((await inspectTransfer(await createTransfer(await left.read()))).state, await left.read());
  }
});

test('permanent record deletion remains source scoped and constrains an explicitly chosen edited branch', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  await mutate(left, await inputFor(left, 'evaluations', 'delete'), 'left-delete');
  await mutate(right, await inputFor(right, 'evaluations'), 'right-edit');
  const incoming = await createTransfer(await right.read());
  let review = await left.previewReconcile({ ...await query(left), incoming });
  const conflict = review.reconciliationPlan.rows.find(row => row.conflict); assert.ok(conflict);
  review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflict.groupId]: 'incoming' } });
  await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
  assert.equal((await records(left, 'evaluations')).length, 0);
  const other = fixture(); other.library = [{ id: 'other', original: 'Other prompt' }];
  await publish(left, other, 'other-source', 'other-origin');
  assert.equal((await records(left, 'evaluations')).length, 1);
});

test('record selection survives ordinary prompt edits and creations', async () => {
  const service = createCommandService(createMemoryAdapter()); const imported = await publish(service);
  await mutate(service, await inputFor(service, 'evaluations'), 'record-update');
  const page = await service.currentRecords({ ...await query(service), domain: 'prompts' }), row = page.items[0];
  const edit = await service.previewEdit({ ...await query(service), groupId: page.groups.find(group => group.selected === row.key).id,
    expectedRecordHash: row.valueHash, editedAt: stamp, updates: [{ path: ['original'], value: 'Edited prompt' }] });
  await service.apply({ ...edit, idempotencyKey: 'prompt-edit' });
  const create = await service.previewCreate({ ...await query(service), sourceBinding: imported.sourceBinding,
    creationId: 'new-prompt', createdAt: stamp, record: { original: 'New prompt' } });
  await service.apply({ ...create, idempotencyKey: 'prompt-create' });
  assert.equal((await records(service, 'evaluations'))[0].value.future.edit, 2);
});

test('hash-valid changed record plans and forged selections fail committed ancestry verification', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service);
  await mutate(service, await inputFor(service, 'evaluations'), 'update');
  const state = await service.read(), commit = state.objects[state.revision].data;
  const forged = structuredClone(state.objects[commit.recordPlan].data); forged.manifest.recordGroups[0].selectedHash = 'sha256:' + '0'.repeat(64);
  const plan = await makeObject('record-mutation-plan', forged), head = await makeObject('commit', { ...commit, recordPlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'RECORD_PLAN_MISMATCH' });
});

test('restoring a bound workspace checkpoint recovers its earlier record selection', async () => {
  const service = createCommandService(createMemoryAdapter()), content = fixture();
  const original = await publish(service, content, 'snapshot', 'origin', 'snapshot');
  await publish(service, content);
  await mutate(service, await inputFor(service, 'evaluations'), 'updated');
  const review = await service.previewRestore({ ...await query(service), checkpointId: original.revision });
  assert.equal(review.commitAvailable, true);
  await service.apply({ ...review, idempotencyKey: 'restore-snapshot' });
  await select(service, 'select-restored');
  assert.deepEqual((await records(service, 'evaluations'))[0].value, content.evaluations[0]);
});

test('interrupted record publication preserves previous state and restart recovers a lost acknowledgement once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-record-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure; const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected interruption'); } });
  const service = createCommandService(adapter); await publish(service);
  const before = await service.read(), review = await service.previewRecord(await inputFor(service, 'evaluations'));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'update' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'update' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('update');
  assert.equal(receipt.operation, 'record'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'update' }), receipt);
  assert.equal((await records(reopened, 'evaluations'))[0].value.future.edit, 2);
});

for (const action of ['create', 'update', 'delete']) test(`record ${action} shares direct/API reviews and recovers a durable queued response loss`, async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service);
  const token = 'synthetic-record-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const url = await api.listen(); t.after(() => api.close());
  const direct = createServiceTransport(service, { libraryId: 'lib' }), transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  const input = action === 'create' ? { ...await query(service), domain: 'evaluations', action, changedAt: stamp,
    sourceBinding: imported.sourceBinding, record: { id: 'created', output: 'Complete result', unknown: true } } : await inputFor(service, 'evaluations', action);
  const request = { ...input, mode: 'record' }, review = await direct.preview(request), remote = await transport.preview(request);
  assert.deepEqual(remote.recordPlan, review.recordPlan);
  let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued-record' });
  await assert.rejects(outbox.replay('lib', 'queued-record', { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } }));
  const committed = await createCommandOutbox(store).replay('lib', 'queued-record', transport);
  assert.equal(committed.state, 'committed'); assert.equal((await records(service, 'evaluations')).length, action === 'create' ? 2 : action === 'delete' ? 0 : 1);
  assert.equal(Object.keys((await service.read()).operations).length, 3);
  const denied = await fetch(`${url}/v1/library/record-mutations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
});
