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

const fixture = () => ({ library: ['a', 'b'].map(id => ({ id, original: `Prompt ${id}`, title: `Title ${id}`, currentVersionId: `${id}-current`,
  metadata: { future: { first: 1, second: false } }, variants: [{ id: `${id}-variant`, text: 'Variant', future: 3 }],
  versions: Array.from({ length: 31 }, (_, n) => ({ id: `${id}-v${n}`, original: `History ${n}`, future: { n } })) })),
  runs: [{ id: 'run', promptId: 'a', output: 'Retained output' }], testCases: [{ id: 'case', promptId: 'a', input: 'Retained case' }],
  scratch: { pads: [{ id: 'note', content: 'Retained note' }], tombstones: {} }, future: { preserved: [false, null] } });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
async function publish(service, content = fixture(), operationId = 'import', markers = {}) {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': '[]', ...markers };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'original-browser',
    localStorage: { length: Object.keys(entries).length, key: n => Object.keys(entries)[n], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic absent store.' }), archives: { reviewed: true, records: [] },
    capturedAt: '2026-10-29T00:00:00Z' });
  const input = { ...await query(service), sourceText: JSON.stringify(content), sourceInventory: inventory, mode: 'import' };
  let review = await service.preview(input);
  const pending = review.importPlan.rows.filter(row => !row.choice);
  if (pending.length) review = await service.preview({ ...input, resolutions: Object.fromEntries(pending.map(row => [row.member, { action: 'replace', target: row.matches[0] }])) });
  assert.equal(review.commitAvailable, true);
  return service.apply({ ...review, idempotencyKey: operationId });
}
async function select(service, operationId = 'select') {
  const review = await service.previewCurrentView(await query(service));
  assert.equal(review.commitAvailable, true, canonical(review.currentViewPlan.blocked));
  return service.apply({ ...review, idempotencyKey: operationId });
}
async function ready(adapter = createMemoryAdapter()) {
  const service = createCommandService(adapter); await publish(service); await select(service); return service;
}
async function input(service, id = 'a', text = 'Changed prompt') {
  const page = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  const row = page.items.find(row => row.sourceId === id), group = page.groups.find(group => group.selected === row.key);
  return { ...await query(service), groupId: group.id, expectedRecordHash: row.valueHash,
    editedAt: '2026-10-29T12:00:00.000Z', updates: [{ path: ['original'], value: text }] };
}
async function edit(service, id, text, operationId) {
  const request = await input(service, id, text), review = await service.previewEdit(request);
  assert.equal(review.commitAvailable, true, canonical(review.editPlan.currentViewPlan.blocked));
  return { request, review, receipt: await service.apply({ ...review, idempotencyKey: operationId }) };
}
async function values(service, domain = 'prompts') {
  return (await service.currentRecords({ ...await query(service), domain })).items.map(row => row.value);
}

test('ordinary prompt edits preserve history, unknown values and other current domains', async () => {
  const service = await ready(), before = await service.read(), original = fixture();
  const related = await Promise.all(['evaluations', 'test-cases', 'scratch'].map(domain => values(service, domain)));
  const request = await input(service);
  request.updates.push({ path: ['metadata', 'future', 'first'], value: 2 });
  const review = await service.previewEdit(request); assert.equal(review.commitAvailable, true);
  const receipt = await service.apply({ ...review, idempotencyKey: 'edit' });
  const after = await service.read(), [changed, untouched] = (await values(service)).sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(changed.original, 'Changed prompt'); assert.deepEqual(changed.metadata.future, { first: 2, second: false });
  assert.deepEqual(changed.versions.slice(0, 31), original.library[0].versions);
  assert.equal(changed.versions.length, 32); assert.equal(changed.versions.at(-1).original, original.library[0].original);
  assert.deepEqual(changed.variants, original.library[0].variants); assert.deepEqual(untouched, original.library[1]);
  assert.deepEqual(await Promise.all(['evaluations', 'test-cases', 'scratch'].map(domain => values(service, domain))), related);
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  assert.deepEqual((await inspectPackage(pkg(after))).sourceBindings, (await inspectPackage(pkg(before))).sourceBindings);
  const rows = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  assert.equal(rows.items.find(row => row.sourceId === 'a').origin.derivedFrom, before.revision);
  assert.equal(receipt.operation, 'edit'); assert.equal(receipt.checkpointId, before.revision);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
});

test('repeated edits and restart retry retain exactly one new version per operation', async () => {
  const service = await ready(), first = await edit(service, 'a', 'First', 'first');
  const second = await edit(service, 'a', 'Second', 'second'), state = await service.read();
  assert.equal((await values(service)).find(row => row.id === 'a').versions.length, 33);
  const reopened = createCommandService(createMemoryAdapter((await inspectTransfer(await createTransfer(state))).state));
  assert.deepEqual(await reopened.apply({ ...first.review, idempotencyKey: 'first' }), first.receipt);
  assert.deepEqual(await reopened.apply({ ...second.review, idempotencyKey: 'second' }), second.receipt);
  assert.deepEqual(await reopened.read(), state);
});

test('stale records, revisions and conflicting operation IDs cannot overwrite a prompt', async () => {
  const service = await ready(), request = await input(service), review = await service.previewEdit(request);
  await assert.rejects(service.previewEdit({ ...request, expectedRecordHash: `sha256:${'0'.repeat(64)}` }), { code: 'RECORD_CONFLICT' });
  await edit(service, 'b', 'Another prompt edit', 'other'); const before = await service.read();
  await assert.rejects(service.apply({ ...review, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.previewEdit(request), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.previewEdit({ ...request, libraryId: 'other' }), { code: 'WRONG_LIBRARY' });
  const fresh = await service.previewEdit(await input(service));
  await assert.rejects(service.apply({ ...fresh, idempotencyKey: 'other' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await service.read(), before);
});

test('identity, generations, invalid paths, overlapping updates and no-op edits reject before mutation', async () => {
  const service = await ready(), request = await input(service), before = await service.read();
  for (const updates of [[], [{ path: ['id'], value: 'replacement' }], [{ path: ['versions'], value: [] }],
    [{ path: ['deletedAt'], value: null }], [{ path: ['original'], value: { invalid: true } }], [{ path: ['metadata'], value: [] }],
    [{ path: ['tags'], value: [3] }], [{ path: ['variants'], value: ['invalid'] }], [{ path: ['favorite'], value: 'false' }],
    [{ path: ['metadata', 'libraryGeneration'], value: '0000000000000001:a' }], [{ path: ['__proto__', 'bad'], value: true }],
    [{ path: ['variants', '0'], value: {} }], [{ path: ['title'], value: 'One' }, { path: ['title'], value: 'Two' }],
    [{ path: ['metadata'], value: {} }, { path: ['metadata', 'future'], value: null }]]) {
    await assert.rejects(service.previewEdit({ ...request, updates }), { code: 'INVALID_EDIT' });
  }
  await assert.rejects(service.previewEdit({ ...request, updates: [{ path: ['original'], value: 'Prompt a' }] }), { code: 'NO_CHANGE' });
  await assert.rejects(service.previewEdit({ ...request, editedAt: '2026-02-31T00:00:00.000Z' }), { code: 'INVALID_EDIT' });
  await assert.rejects(service.previewEdit({ ...request, unexpected: true }), { code: 'INVALID_EDIT' });
  assert.deepEqual(await service.read(), before);
});

test('edit review owns its input before asynchronous hashing and never activates an unreviewed library', async () => {
  const service = await ready(), request = await input(service);
  const promised = service.previewEdit(request); request.updates[0].value = 'Unreviewed later mutation';
  const review = await promised; await service.apply({ ...review, idempotencyKey: 'owned' });
  assert.equal((await values(service)).find(row => row.id === 'a').original, 'Changed prompt');
  const unreviewed = createCommandService(createMemoryAdapter()); await publish(unreviewed);
  await assert.rejects(unreviewed.previewEdit({ ...request, ...await query(unreviewed) }), { code: 'SELECTION_REQUIRED' });
});

test('real edit forks reconcile causally and restore preserves their complete ancestry', async () => {
  const service = await ready(), base = await service.read();
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  await edit(left, 'a', 'Left', 'left'); await edit(right, 'b', 'Right', 'right');
  const leftState = await left.read(), rightState = await right.read();
  const request = { ...await query(left), incoming: await createTransfer(rightState) };
  const review = await left.previewReconcile(request); assert.equal(review.commitAvailable, true);
  await left.apply({ ...review, idempotencyKey: 'merge' }); await select(left, 'merged-view');
  assert.deepEqual((await values(left)).map(row => row.original).sort(), ['Left', 'Right']);
  const restore = await left.previewRestore({ ...await query(left), checkpointId: base.revision });
  assert.equal(restore.commitAvailable, true); await left.apply({ ...restore, idempotencyKey: 'restore' }); await select(left, 'restored-view');
  assert.deepEqual((await values(left)).map(row => row.original).sort(), ['Prompt a', 'Prompt b']);
  const final = await left.read();
  for (const state of [leftState, rightState]) for (const [key, value] of Object.entries(state.objects)) assert.deepEqual(final.objects[key], value);
  assert.deepEqual((await inspectTransfer(await createTransfer(final))).state, final);
});

test('concurrent edits to one prompt need a choice and retain both versions', async () => {
  const left = await ready(), right = createCommandService(createMemoryAdapter(await left.read()));
  await edit(left, 'a', 'Left', 'left'); await edit(right, 'a', 'Right', 'right');
  const request = { ...await query(left), incoming: await createTransfer(await right.read()) };
  const pending = await left.previewReconcile(request); assert.equal(pending.commitAvailable, false);
  await assert.rejects(left.apply({ ...pending, idempotencyKey: 'unreviewed' }), { code: 'UNRESOLVED_RECONCILIATION' });
  const resolutions = Object.fromEntries(pending.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'incoming']));
  const reviewed = await left.previewReconcile({ ...request, resolutions }); await left.apply({ ...reviewed, idempotencyKey: 'merge' });
  await select(left, 'selected-merge'); assert.equal((await values(left)).find(row => row.id === 'a').original, 'Right');
  const records = await left.records({ ...await query(left), domain: 'prompts' });
  assert.ok(records.items.some(row => row.value.original === 'Left')); assert.ok(records.items.some(row => row.value.original === 'Right'));
});

test('later source deletion suppresses edited successors and cannot be undone by restore or edit', async () => {
  const service = await ready(), beforeEdit = (await service.read()).revision, edited = await edit(service, 'a', 'Edited', 'edit');
  await publish(service, fixture(), 'deleted-source', { 'pl2-library-deleted:a': '1' }); await select(service, 'deleted-view');
  assert.deepEqual((await values(service)).map(row => row.id), ['b']);
  await assert.rejects(service.previewEdit({ ...edited.request, ...await query(service) }), { code: 'EDIT_TARGET_UNAVAILABLE' });
  const restore = await service.previewRestore({ ...await query(service), checkpointId: beforeEdit });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored');
  assert.deepEqual((await values(service)).map(row => row.id), ['b']);
});

test('hash-valid forged edit plans are rejected by ancestry verification', async () => {
  const service = await ready(); await edit(service, 'a', 'Changed', 'edit'); const state = await service.read(), commit = state.objects[state.revision].data;
  const forged = structuredClone(state.objects[commit.editPlan].data); forged.currentViewPlan.selected = [];
  const planObject = await makeObject('prompt-edit-plan', forged), head = await makeObject('commit', { ...commit, editPlan: planObject.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [planObject.hash]: planObject.object, [head.hash]: head.object } }), { code: 'EDIT_PLAN_MISMATCH' });
});

test('folder publication failures preserve the previous head and recover a lost acknowledgement once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-edit-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure;
  const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected write interruption'); } });
  const service = await ready(adapter), before = await service.read(), request = await input(service), review = await service.previewEdit(request);
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'edit' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'edit' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('edit');
  assert.equal(receipt.operation, 'edit'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'edit' }), receipt);
  assert.equal((await values(reopened)).find(row => row.id === 'a').versions.length, 32);
});

test('direct and authenticated API edits use the same durable reviewed command and readback', async t => {
  const adapter = createMemoryAdapter(), service = await ready(adapter), token = 'synthetic-local-credential-'.repeat(2);
  const credentials = [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }];
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials }); const url = await api.listen(); t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  const direct = createServiceTransport(service, { libraryId: 'lib' });
  const request = { ...await input(service), mode: 'edit' }, review = await transport.preview(request), directReview = await direct.preview(request);
  assert.deepEqual(review.editPlan, directReview.editPlan); assert.equal(review.fingerprint, directReview.fingerprint);
  const rows = new Map(), store = { async read(library, id) { return structuredClone(rows.get(id) ?? null); },
    async list() { return structuredClone([...rows.values()]); }, async write(row, version) { assert.equal(rows.get(row.operationId)?.version ?? null, version); rows.set(row.operationId, structuredClone(row)); } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued-edit' });
  const losing = { ...transport, async apply(input) { await transport.apply(input); throw new Error('Lost response'); } };
  await assert.rejects(outbox.replay('lib', 'queued-edit', losing));
  const restarted = createCommandOutbox(store), result = await restarted.replay('lib', 'queued-edit', transport);
  assert.equal(result.state, 'committed'); assert.deepEqual(result.receipt, await service.operation('queued-edit'));
  assert.deepEqual(await transport.currentRecords({ ...await query(service), domain: 'prompts' }), await direct.currentRecords({ ...await query(service), domain: 'prompts' }));
  assert.equal((await values(service)).find(row => row.id === 'a').versions.length, 32);
  credentials[0].scopes = ['read']; const fresh = { ...await input(service, 'a', 'Forbidden edit'), mode: 'edit' };
  await assert.rejects(transport.preview(fresh), { code: 'FORBIDDEN' });
  credentials[0].revoked = true; await assert.rejects(transport.preview(fresh), { code: 'UNAUTHORIZED' });
});
