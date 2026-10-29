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

const fixture = () => ({ library: [{ id: 'old', original: 'Original prompt', metadata: { future: false },
  versions: Array.from({ length: 31 }, (_, n) => ({ id: `v${n}`, original: `History ${n}`, future: n })) }],
  trash: [{ id: 'old-trash', original: 'Retained trash' }], runs: [{ id: 'run', promptId: 'old', output: 'Output' }],
  scratch: { pads: [{ id: 'note', content: 'Retained note' }], tombstones: {} } });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
async function publish(service, content = fixture(), operationId = 'import', markers = {}) {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...markers };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'original-browser',
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
async function input(service, creationId = 'new', record = { title: 'New prompt', original: 'Complete $& {{input}}',
  metadata: { future: [false, null, { exact: '  untrimmed  ' }] }, unknown: { nested: true } }) {
  const state = await service.read(), inspected = await inspectPackage(pkg(state));
  return { ...await query(service), sourceBinding: inspected.sourceBindings[0], creationId,
    createdAt: '2026-10-29T12:00:00.000Z', record };
}
async function create(service, creationId = 'new', record, operationId = creationId) {
  const request = await input(service, creationId, record), review = await service.previewCreate(request);
  assert.equal(review.commitAvailable, true, canonical(review.createPlan.currentViewPlan.blocked));
  const receipt = await service.apply({ ...review, idempotencyKey: operationId });
  return { request, review, receipt };
}
async function values(service, domain = 'prompts') {
  return (await service.currentRecords({ ...await query(service), domain })).items.map(row => row.value);
}

test('creation preserves every supplied field and existing history without inventing source capture', async () => {
  const service = await ready(), before = await service.read(), other = await Promise.all(['trash', 'evaluations', 'scratch'].map(d => values(service, d)));
  const { request, review, receipt } = await create(service), after = await service.read();
  const rows = await values(service), created = rows.find(row => row.id === review.createPlan.createdId);
  assert.equal(rows.length, 2); assert.deepEqual(rows.find(row => row.id === 'old'), fixture().library[0]);
  for (const [key, value] of Object.entries(request.record)) assert.deepEqual(created[key], value);
  assert.deepEqual(created.versions, []); assert.equal(created.createdAt, request.createdAt); assert.equal(created.updatedAt, request.createdAt);
  assert.match(created.currentVersionId, /^v-[a-f0-9]{64}$/);
  assert.deepEqual(await Promise.all(['trash', 'evaluations', 'scratch'].map(d => values(service, d))), other);
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  assert.deepEqual((await inspectPackage(pkg(after))).sourceBindings, (await inspectPackage(pkg(before))).sourceBindings);
  assert.equal(receipt.operation, 'create'); assert.equal(receipt.checkpointId, before.revision);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
});

test('empty reviewed libraries accept creation and intentional duplicate content stays distinct', async () => {
  const service = await ready(createMemoryAdapter(), { library: [] });
  const first = await create(service, 'first'), second = await create(service, 'second');
  assert.notEqual(first.review.createPlan.createdId, second.review.createPlan.createdId);
  assert.deepEqual((await values(service)).map(row => row.original), ['Complete $& {{input}}', 'Complete $& {{input}}']);
  const before = await service.read();
  await assert.rejects(service.previewCreate(await input(service, 'first')), { code: 'IDENTITY_CONFLICT' });
  assert.deepEqual(await service.read(), before);
  const reopened = createCommandService(createMemoryAdapter((await inspectTransfer(await createTransfer(before))).state));
  assert.deepEqual(await reopened.apply({ ...first.review, idempotencyKey: 'first' }), first.receipt);
  assert.deepEqual(await reopened.apply({ ...second.review, idempotencyKey: 'second' }), second.receipt);
  assert.deepEqual(await reopened.read(), before);
});

test('creation rejects stale, foreign, unbound and unreviewed requests before mutation', async () => {
  const service = await ready(), request = await input(service), review = await service.previewCreate(request);
  await assert.rejects(service.previewCreate({ ...request, libraryId: 'other' }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(service.previewCreate({ ...request, sourceBinding: `sha256:${'0'.repeat(64)}` }), { code: 'UNBOUND_SOURCE' });
  await create(service, 'other'); const before = await service.read();
  await assert.rejects(service.apply({ ...review, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.previewCreate(request), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await service.read(), before);
  const unreviewed = createCommandService(createMemoryAdapter()); await publish(unreviewed);
  await assert.rejects(unreviewed.previewCreate(await input(unreviewed)), { code: 'SELECTION_REQUIRED' });
});

test('creation owns its complete input and rejects invalid or service-owned fields', async () => {
  const service = await ready(), request = await input(service), before = await service.read();
  for (const record of [[], { id: 'chosen' }, { versions: [] }, { currentVersionId: 'chosen' }, { createdAt: request.createdAt },
    { updatedAt: request.createdAt }, { deletedAt: null }, { metadata: { libraryGeneration: '0' } }, { original: 3 },
    { tags: [false] }, { favorite: 'false' }, { variants: [null] }]) {
    await assert.rejects(service.previewCreate({ ...request, record }), { code: 'INVALID_CREATE' });
  }
  for (const extra of [{ unexpected: true }, { creationId: '' }, { createdAt: '2026-02-31T00:00:00.000Z' }]) {
    await assert.rejects(service.previewCreate({ ...request, ...extra }), { code: 'INVALID_CREATE' });
  }
  assert.deepEqual(await service.read(), before);
  const promised = service.previewCreate(request); request.record.original = 'Changed after review began';
  const review = await promised; await service.apply({ ...review, idempotencyKey: 'owned' });
  assert.equal((await values(service)).find(row => row.id !== 'old').original, 'Complete $& {{input}}');
});

test('new records use the current clear generation and deleted identities cannot be recreated', async () => {
  const service = await ready(), generation = '0000000000000001:abc';
  await publish(service, fixture(), 'clear', { [`pl2-library-clear:${generation}`]: '1' }); await select(service, 'cleared-view');
  const created = await create(service), createdId = created.review.createPlan.createdId;
  assert.equal((await values(service))[0].metadata.libraryGeneration, generation);
  await publish(service, fixture(), 'deleted', { [`pl2-library-clear:${generation}`]: '1', [`pl2-library-deleted:${createdId}`]: '1' });
  await select(service, 'deleted-view'); assert.equal((await values(service)).length, 0);
  await assert.rejects(service.previewCreate(await input(service)), { code: 'IDENTITY_CONFLICT' });
  const restore = await service.previewRestore({ ...await query(service), checkpointId: created.receipt.revision });
  await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored-view');
  assert.equal((await values(service)).length, 0);
});

test('independent creations merge and checkpoint restore keeps complete created ancestry', async () => {
  const left = await ready(), base = await left.read(), right = createCommandService(createMemoryAdapter(base));
  await create(left, 'left'); await create(right, 'right');
  const branches = [await left.read(), await right.read()];
  const review = await left.previewReconcile({ ...await query(left), incoming: await createTransfer(branches[1]) });
  assert.equal(review.commitAvailable, true); await left.apply({ ...review, idempotencyKey: 'merge' }); await select(left, 'merged-view');
  assert.equal((await values(left)).length, 3);
  const restore = await left.previewRestore({ ...await query(left), checkpointId: base.revision });
  await left.apply({ ...restore, idempotencyKey: 'restore' }); await select(left, 'restored-view');
  assert.deepEqual(await values(left), fixture().library);
  const final = await left.read();
  for (const branch of branches) for (const [key, value] of Object.entries(branch.objects)) assert.deepEqual(final.objects[key], value);
  assert.deepEqual((await inspectTransfer(await createTransfer(final))).state, final);
});

test('same creation identity on divergent branches requires an explicit content choice', async () => {
  const left = await ready(), right = createCommandService(createMemoryAdapter(await left.read()));
  await create(left, 'same', { original: 'Left' }, 'left-create'); await create(right, 'same', { original: 'Right' }, 'right-create');
  const request = { ...await query(left), incoming: await createTransfer(await right.read()) };
  const pending = await left.previewReconcile(request); assert.equal(pending.commitAvailable, false);
  const resolutions = Object.fromEntries(pending.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'incoming']));
  const review = await left.previewReconcile({ ...request, resolutions }); await left.apply({ ...review, idempotencyKey: 'merged' }); await select(left, 'merged-view');
  assert.deepEqual((await values(left)).map(row => row.original).sort(), ['Original prompt', 'Right']);
});

test('new prompts can be edited without breaking creation ancestry or retained values', async () => {
  const service = await ready(), created = await create(service), page = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  const row = page.items.find(row => row.sourceId === created.review.createPlan.createdId);
  const review = await service.previewEdit({ ...await query(service), groupId: created.review.createPlan.derivedSource.groupId,
    expectedRecordHash: row.valueHash, editedAt: '2026-10-29T12:01:00.000Z', updates: [{ path: ['original'], value: 'Edited new prompt' }] });
  await service.apply({ ...review, idempotencyKey: 'edit-created' });
  const current = (await values(service)).find(item => item.id === row.sourceId);
  assert.equal(current.original, 'Edited new prompt'); assert.equal(current.versions.length, 1);
  assert.deepEqual(current.unknown, created.request.record.unknown);
  assert.deepEqual((await inspectTransfer(await createTransfer(await service.read()))).state, await service.read());
});

test('hash-valid altered creation plans cannot forge committed prompts', async () => {
  const service = await ready(); await create(service); const state = await service.read(), commit = state.objects[state.revision].data;
  const forged = structuredClone(state.objects[commit.createPlan].data); forged.createdId = 'forged';
  const plan = await makeObject('prompt-create-plan', forged), head = await makeObject('commit', { ...commit, createPlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'CREATE_PLAN_MISMATCH' });
});

test('creation interruption keeps the previous folder and lost acknowledgement recovers once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-create-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure; const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected interruption'); } });
  const service = await ready(adapter), before = await service.read(), review = await service.previewCreate(await input(service));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'new' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'new' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('new');
  assert.equal(receipt.operation, 'create'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'new' }), receipt);
  assert.equal((await values(reopened)).length, 2);
});

test('creation uses direct and authenticated transports with durable lost-response recovery', async t => {
  const adapter = createMemoryAdapter(), service = await ready(adapter), token = 'synthetic-create-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const url = await api.listen(); t.after(() => api.close());
  const direct = createServiceTransport(service, { libraryId: 'lib' }), transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  const request = { ...await input(service), mode: 'create' }, review = await direct.preview(request), remote = await transport.preview(request);
  assert.deepEqual(remote.createPlan, review.createPlan);
  let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued-create' });
  const lost = { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } };
  await assert.rejects(outbox.replay('lib', 'queued-create', lost));
  const committed = await createCommandOutbox(store).replay('lib', 'queued-create', transport);
  assert.equal(committed.state, 'committed'); assert.equal((await values(service)).length, 2);
  const denied = await fetch(`${url}/v1/library/creations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
});
