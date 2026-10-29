import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, canonical, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';
import { createServiceTransport, createLoopbackTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';

const fixture = () => ({ library: [{ id: 'old', original: 'Original prompt', metadata: { future: false }, deletedAt: null, tombstoneVersion: 0,
  versions: Array.from({ length: 31 }, (_, n) => ({ id: `v${n}`, original: `History ${n}`, future: n })) }],
  trash: [{ id: 'old-trash', original: 'Retained trash' }], runs: [{ id: 'run', promptId: 'old', output: 'Output' }],
  scratch: { pads: [{ id: 'note', content: 'Retained note' }], tombstones: {} } });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
async function publish(service, content = fixture(), operationId = 'import', markers = {}, sourceIdentity = 'original-browser') {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...markers };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity,
    localStorage: { length: Object.keys(entries).length, key: n => Object.keys(entries)[n], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic absent store.' }), archives: { reviewed: true, records: [] },
    capturedAt: '2026-10-29T00:00:00Z' });
  const review = await service.preview({ ...await query(service), sourceText: JSON.stringify(content), sourceInventory, mode: 'import' });
  assert.equal(review.commitAvailable, true);
  return service.apply({ ...review, idempotencyKey: operationId });
}
async function select(service, operationId = 'select') {
  const review = await service.previewCurrentView(await query(service));
  assert.equal(review.commitAvailable, true, canonical(review.currentViewPlan.blocked));
  return service.apply({ ...review, idempotencyKey: operationId });
}
async function ready(adapter = createMemoryAdapter(), content = fixture()) {
  const service = createCommandService(adapter); await publish(service, content); await select(service); return service;
}

async function target(service, domain, id) {
  const page = await service.currentRecords({ ...await query(service), domain });
  const row = page.items.find(row => row.sourceId === id);
  assert.ok(row, `Missing ${domain} record ${id}`);
  return { row, group: page.groups.find(group => group.selected === row.key) };
}
async function request(service, action, id = 'old') {
  const { row, group } = await target(service, action === 'trash' ? 'prompts' : 'trash', id);
  return { ...await query(service), groupId: group.id, expectedRecordHash: row.valueHash, action,
    changedAt: '2026-10-29T12:00:00.000Z', confirmPermanentDeletion: action === 'delete' };
}
async function act(service, action, id = 'old', operationId = action) {
  const input = await request(service, action, id), review = await service.previewLifecycle(input);
  assert.equal(review.commitAvailable, true, canonical(review.lifecyclePlan.currentViewPlan.blocked));
  const receipt = await service.apply({ ...review, idempotencyKey: operationId });
  return { input, review, receipt };
}
async function values(service, domain = 'prompts') {
  return (await service.currentRecords({ ...await query(service), domain })).items.map(row => row.value);
}

test('Trash and restore preserve complete history and expose exactly one current location', async () => {
  const service = await ready(), before = await service.read();
  const related = await Promise.all(['evaluations', 'scratch'].map(d => values(service, d)));
  const trashed = await act(service, 'trash');
  assert.equal((await values(service)).length, 0);
  const trash = (await values(service, 'trash')).find(row => row.id === 'old');
  assert.deepEqual(trash.versions, fixture().library[0].versions);
  assert.deepEqual(trash.metadata, fixture().library[0].metadata);
  assert.equal(trash.deletedAt, trashed.input.changedAt);
  const restored = await act(service, 'restore');
  assert.deepEqual(await values(service), fixture().library);
  assert.deepEqual(await values(service, 'trash'), fixture().trash);
  assert.deepEqual(await Promise.all(['evaluations', 'scratch'].map(d => values(service, d))), related);
  const after = await service.read();
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  assert.equal(restored.receipt.operation, 'lifecycle');
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  assert.deepEqual(await createCommandService(createMemoryAdapter(after)).apply({ ...restored.review, idempotencyKey: 'restore' }), restored.receipt);
});

test('imported Trash can be restored and then deleted without reviving stale replicas', async () => {
  const service = await ready(), original = fixture().trash[0];
  await act(service, 'restore', original.id);
  assert.equal((await values(service, 'trash')).length, 0);
  assert.deepEqual((await values(service)).find(row => row.id === original.id), original);
  await act(service, 'trash', original.id);
  assert.equal((await values(service, 'trash')).length, 1);
  await act(service, 'delete', original.id);
  assert.equal((await values(service, 'trash')).length, 0);
  assert.deepEqual(await values(service), fixture().library);
  await publish(service, fixture(), 'older-import'); await select(service, 'older-view');
  assert.equal((await values(service, 'trash')).length, 0);
  assert.deepEqual((await inspectTransfer(await createTransfer(await service.read()))).state, await service.read());
});

test('permanent deletion survives checkpoint restore and older workspace import', async () => {
  const service = await ready(), before = await service.read();
  await act(service, 'trash'); await act(service, 'delete');
  assert.equal((await values(service)).length, 0);
  assert.deepEqual(await values(service, 'trash'), fixture().trash);
  const review = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
  assert.equal(review.restorePlan.counts.suppressed, 1);
  await service.apply({ ...review, idempotencyKey: 'checkpoint' }); await select(service, 'checkpoint-view');
  assert.equal((await values(service)).length, 0);
  await publish(service, fixture(), 'old-import'); await select(service, 'old-view');
  assert.equal((await values(service)).length, 0);
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual((await service.read()).objects[key], value);
});

test('permanent deletion of an imported Trash record respects source identity', async () => {
  const service = await ready(); await act(service, 'delete', 'old-trash');
  assert.deepEqual(await values(service), fixture().library);
  assert.equal((await values(service, 'trash')).length, 0);
  await assert.rejects(service.previewLifecycle({ ...await query(service), groupId: `sha256:${'0'.repeat(64)}`,
    expectedRecordHash: `sha256:${'0'.repeat(64)}`, action: 'restore', changedAt: '2026-10-29T12:00:00.000Z', confirmPermanentDeletion: false }), { code: 'LIFECYCLE_TARGET_UNAVAILABLE' });
});

test('lifecycle rejects stale, invalid, foreign, unconfirmed and inactive requests without mutation', async () => {
  const service = await ready(), input = await request(service, 'trash'), before = await service.read();
  for (const extra of [{ action: 'erase' }, { changedAt: '2026-02-31T00:00:00.000Z' }, { unexpected: true }, { confirmPermanentDeletion: true }]) {
    await assert.rejects(service.previewLifecycle({ ...input, ...extra }), { code: 'INVALID_LIFECYCLE' });
  }
  await assert.rejects(service.previewLifecycle({ ...input, libraryId: 'other' }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(service.previewLifecycle({ ...input, expectedRecordHash: `sha256:${'0'.repeat(64)}` }), { code: 'RECORD_CONFLICT' });
  assert.deepEqual(await service.read(), before);
  await act(service, 'trash');
  await assert.rejects(service.previewLifecycle(input), { code: 'REVISION_CONFLICT' });
  const deletion = await request(service, 'delete');
  await assert.rejects(service.previewLifecycle({ ...deletion, confirmPermanentDeletion: false }), { code: 'INVALID_LIFECYCLE' });
  await assert.rejects(service.previewEdit({ ...await query(service), groupId: input.groupId, expectedRecordHash: deletion.expectedRecordHash,
    editedAt: input.changedAt, updates: [{ path: ['original'], value: 'Hidden edit' }] }), { code: 'EDIT_TARGET_UNAVAILABLE' });
});

test('concurrent edit and Trash require an explicit choice; permanent deletion wins across either branch choice', async () => {
  const left = await ready(), base = await left.read(), right = createCommandService(createMemoryAdapter(base));
  const { row, group } = await target(right, 'prompts', 'old');
  const edit = await right.previewEdit({ ...await query(right), groupId: group.id, expectedRecordHash: row.valueHash,
    editedAt: '2026-10-29T13:00:00.000Z', updates: [{ path: ['original'], value: 'Concurrent edit' }] });
  await right.apply({ ...edit, idempotencyKey: 'right-edit' });
  await act(left, 'trash');
  const incoming = await createTransfer(await right.read());
  let pending = await left.previewReconcile({ ...await query(left), incoming });
  assert.equal(pending.commitAvailable, false);
  await act(left, 'delete');
  pending = await left.previewReconcile({ ...await query(left), incoming });
  const resolutions = Object.fromEntries(pending.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'incoming']));
  const review = await left.previewReconcile({ ...await query(left), incoming, resolutions });
  await left.apply({ ...review, idempotencyKey: 'merge' }); await select(left, 'merged-view');
  assert.equal((await values(left)).length, 0);
  assert.deepEqual(await values(left, 'trash'), fixture().trash);
  for (const [key, value] of Object.entries((await right.read()).objects)) assert.deepEqual((await left.read()).objects[key], value);
});


test('same IDs in another source scope survive permanent deletion', async () => {
  const service = await ready(); await act(service, 'delete', 'old-trash');
  await publish(service, { library: [], trash: fixture().trash }, 'second-source', {}, 'another-browser');
  await select(service, 'second-view');
  assert.deepEqual(await values(service, 'trash'), fixture().trash);
});

test('a checkpoint can return an imported record to Trash and an explicit restore reuses its retained group', async () => {
  const service = await ready(), before = await service.read(); await act(service, 'restore', 'old-trash');
  const first = (await target(service, 'prompts', 'old-trash')).group.id;
  const review = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
  await service.apply({ ...review, idempotencyKey: 'checkpoint' }); await select(service, 'checkpoint-view');
  assert.deepEqual(await values(service, 'trash'), fixture().trash);
  await act(service, 'restore', 'old-trash', 'restore-again');
  assert.equal((await target(service, 'prompts', 'old-trash')).group.id, first);
  assert.equal((await values(service, 'trash')).length, 0);
});

test('hash-valid altered lifecycle evidence cannot forge a committed deletion', async () => {
  const service = await ready(); await act(service, 'trash'); const state = await service.read(), commit = state.objects[state.revision].data;
  const forged = structuredClone(state.objects[commit.lifecyclePlan].data); forged.derivedSource.lifecycle.action = 'delete';
  const plan = await makeObject('prompt-lifecycle-plan', forged), head = await makeObject('commit', { ...commit, lifecyclePlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'LIFECYCLE_PLAN_MISMATCH' });
});

test('lifecycle interruption preserves the previous folder and lost acknowledgement recovers once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-lifecycle-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure; const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected interruption'); } });
  const service = await ready(adapter), before = await service.read(), review = await service.previewLifecycle(await request(service, 'trash'));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'trashed' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'trashed' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('trashed');
  assert.equal(receipt.operation, 'lifecycle'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'trashed' }), receipt);
  assert.equal((await values(reopened)).length, 0); assert.equal((await values(reopened, 'trash')).length, 2);
});

test('all lifecycle actions use direct and authenticated transports with durable response-loss recovery', async t => {
  const adapter = createMemoryAdapter(), service = await ready(adapter), token = 'synthetic-lifecycle-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const url = await api.listen(); t.after(() => api.close());
  const direct = createServiceTransport(service, { libraryId: 'lib' }), transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  for (const [index, action] of ['trash', 'restore', 'trash', 'delete'].entries()) {
    const command = { ...await request(service, action), mode: 'lifecycle' }, review = await direct.preview(command), remote = await transport.preview(command);
    assert.deepEqual(remote.lifecyclePlan, review.lifecyclePlan);
    let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
      assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
    } };
    const operationId = `queued-${index}`, outbox = createCommandOutbox(store); await outbox.enqueue({ request: command, review, operationId });
    const lost = { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } };
    await assert.rejects(outbox.replay('lib', operationId, lost));
    assert.equal((await createCommandOutbox(store).replay('lib', operationId, transport)).state, 'committed');
  }
  assert.equal((await values(service)).length, 0); assert.deepEqual(await values(service, 'trash'), fixture().trash);
  const denied = await fetch(`${url}/v1/library/lifecycles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
});
