import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, hash, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createLocalApi } from './local-api.mjs';
import { commonAncestor } from './reconcile-plan.mjs';

const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const initial = () => ({ library: [
  { id: 'a', title: 'A', original: 'original A', versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, content: `history ${i}`, future: true })) },
  { id: 'b', title: 'B', original: 'original B' },
], runs: [{ id: 'run', promptId: 'missing', output: 'retained' }], future: { untouched: [null, false, 'unknown'] } });
async function input(content, markers = {}) {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...markers };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'shared-origin',
    localStorage: { length: Object.keys(entries).length, key: n => Object.keys(entries)[n], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic empty store.' }),
    archives: { reviewed: true, records: [] }, capturedAt: '2026-10-29T00:00:00Z' });
  return { libraryId: 'lib', sourceText: JSON.stringify(content), mode: 'import', sourceInventory };
}
async function publish(service, content, operation, markers) {
  const request = { ...await input(content, markers), expectedRevision: (await service.read()).revision };
  let preview = await service.preview(request);
  const rows = preview.importPlan.rows.filter(row => !row.choice);
  if (rows.length) preview = await service.preview({ ...request, resolutions: Object.fromEntries(rows.map(row => [row.member, { action: 'replace', target: row.matches[0] }])) });
  assert.equal(preview.commitAvailable, true);
  return service.apply({ ...preview, idempotencyKey: operation });
}
async function branches(leftAdapter = createMemoryAdapter()) {
  const left = createCommandService(leftAdapter);
  const base = await publish(left, initial(), 'base');
  const rightAdapter = createMemoryAdapter(await left.read()), right = createCommandService(rightAdapter);
  return { left, right, base, leftAdapter, rightAdapter };
}
async function review(left, right, resolutions = {}) {
  return left.previewReconcile({ libraryId: 'lib', expectedRevision: (await left.read()).revision,
    incoming: await createTransfer(await right.read()), resolutions });
}
async function selected(service) {
  const state = await service.read(), inspected = await inspectPackage(pkg(state));
  const nodes = new Map(inspected.manifest.nodes.map(node => [node.key, node]));
  return inspected.manifest.groups.filter(group => group.selected !== null).map(group => {
    const node = nodes.get(group.selected);
    return node.path.reduce((value, key) => value[key], state.objects[node.source].data);
  });
}
const changed = (index, text) => { const value = initial(); value.library[index].original = text; return value; };

test('independent branch edits converge while every object, receipt and unknown metadata survives', async () => {
  const { left, right, rightAdapter, base } = await branches();
  const a = await publish(left, changed(0, 'A from left'), 'left');
  const b = await publish(right, changed(1, 'B from right'), 'right');
  await rightAdapter.transact(state => { state.futureMetadata = { keep: ['all', null] }; });
  const before = await left.read(), remote = await right.read(), preview = await review(left, right);
  assert.equal(preview.reconciliationPlan.ancestorRevision, base.revision);
  assert.equal(preview.commitAvailable, true);
  const receipt = await left.apply({ ...preview, idempotencyKey: 'merge' }), after = await left.read();
  assert.deepEqual(after.objects[receipt.revision].data.parents, [a.revision, b.revision]);
  assert.deepEqual((await selected(left)).map(row => row.original).sort(), ['A from left', 'B from right']);
  for (const [id, object] of Object.entries({ ...before.objects, ...remote.objects })) assert.deepEqual(after.objects[id], object);
  for (const [id, operation] of Object.entries({ ...before.operations, ...remote.operations })) assert.deepEqual(after.operations[id], operation);
  const archive = after.objects[after.objects[after.revision].data.incomingBranch].data;
  assert.deepEqual(archive.metadata.futureMetadata, remote.futureMetadata);
  assert.ok(after.checkpoints.includes(a.revision) && after.checkpoints.includes(b.revision));
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const reopened = createCommandService(createMemoryAdapter(after));
  assert.deepEqual(await reopened.apply({ ...preview, idempotencyKey: 'merge' }), receipt);
  assert.ok((await reopened.records({ libraryId: 'lib', expectedRevision: after.revision })).counts);
  const restore = await reopened.previewRestore({ libraryId: 'lib', expectedRevision: after.revision, checkpointId: b.revision });
  await reopened.apply({ ...restore, idempotencyKey: 'restore-right' });
  assert.deepEqual((await selected(reopened)).map(row => row.original).sort(), ['B from right', 'original A']);
  await inspectTransfer(await createTransfer(await reopened.read()));
});

test('concurrent changes require a choice; either choice keeps both histories', async () => {
  for (const choice of ['current', 'incoming']) {
    const { left, right } = await branches();
    await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(0, 'right'), 'right');
    const before = await left.read(), pending = await review(left, right);
    const conflicts = pending.reconciliationPlan.rows.filter(row => row.conflict);
    assert.equal(conflicts.length, 1); assert.equal(pending.commitAvailable, false);
    await assert.rejects(left.apply({ ...pending, idempotencyKey: 'pending' }), { code: 'UNRESOLVED_RECONCILIATION' });
    assert.deepEqual(await left.read(), before);
    const preview = await review(left, right, { [conflicts[0].groupId]: choice });
    await left.apply({ ...preview, idempotencyKey: 'chosen' });
    assert.equal((await selected(left)).find(row => row.id === 'a').original, choice === 'current' ? 'left' : 'right');
    const state = await left.read(), inspected = await inspectPackage(pkg(state));
    assert.equal(inspected.manifest.nodes.filter(node => node.kind === 'version').length, 123);
    await assert.rejects(review(left, right), { code: 'ALREADY_INTEGRATED' });
  }
});

test('permanent deletion on either branch suppresses an edited prompt without dropping its history', async () => {
  const { left, right } = await branches();
  await publish(left, changed(0, 'edited'), 'edit');
  await publish(right, { ...initial(), library: [initial().library[1]] }, 'delete', { 'pl2-library-deleted:a': '1' });
  const pending = await review(left, right);
  const resolutions = Object.fromEntries(pending.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'current']));
  const preview = await review(left, right, resolutions);
  assert.equal(preview.reconciliationPlan.deletionReview.suppressed.length, 1);
  await left.apply({ ...preview, idempotencyKey: 'merge' });
  assert.deepEqual((await selected(left)).map(row => row.id), ['b']);
  assert.ok(Object.values((await left.read()).objects).some(object => object.kind === 'workspace' && object.data.library.some(row => row.original === 'edited')));
});

test('stale, invalid, foreign, reused and unrelated branch inputs cannot mutate current state', async () => {
  const { left, right } = await branches();
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  const pending = await review(left, right);
  await publish(left, changed(0, 'later left'), 'later');
  await assert.rejects(left.apply({ ...pending, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  const before = await left.read();
  await assert.rejects(review(left, right, { invalid: 'current' }), { code: 'INVALID_RESOLUTIONS' });
  const unrelated = createCommandService(createMemoryAdapter());
  await publish(unrelated, changed(0, 'unrelated'), 'unrelated');
  await assert.rejects(review(left, unrelated), { code: 'AMBIGUOUS_ANCESTRY' });
  const duplicate = createCommandService(createMemoryAdapter((await branches()).leftAdapter.read()));
  await publish(duplicate, changed(1, 'duplicate'), 'left');
  await assert.rejects(review(left, duplicate), { code: 'IDEMPOTENCY_CONFLICT' });
  const preview = await review(left, right);
  await assert.rejects(left.apply({ ...preview, idempotencyKey: 'right' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await left.read(), before);
});

test('review owns the transferred bytes and expires without publishing', async () => {
  const { left, right } = await branches();
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  const incoming = await createTransfer(await right.read()), before = await left.read();
  let clock = 0;
  const service = createCommandService(createMemoryAdapter(before), { now: () => clock, previewLifetimeMs: 5 });
  const request = { libraryId: 'lib', expectedRevision: before.revision, incoming };
  const pending = service.previewReconcile(request); incoming.metadata.libraryId = 'tampered';
  const preview = await pending; clock = 6;
  await assert.rejects(service.apply({ ...preview, idempotencyKey: 'expired' }), { code: 'PREVIEW_EXPIRED' });
  assert.deepEqual(await service.read(), before);
});

test('rehashed reconciliation cannot change the reviewed choice or branch metadata', async () => {
  const { left, right } = await branches();
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  await left.apply({ ...await review(left, right), idempotencyKey: 'merge' });
  const state = await left.read(), commit = state.objects[state.revision].data;
  const plan = structuredClone(state.objects[commit.reconciliationPlan].data);
  plan.manifest.groups[0].selected = plan.manifest.groups[0].members[0];
  const { fingerprint, ...unsigned } = plan; plan.fingerprint = await hash(unsigned);
  const alteredPlan = await makeObject('reconciliation-plan', plan), manifest = await makeObject('library-state', plan.manifest);
  const alteredCommit = await makeObject('commit', { ...commit, reconciliationPlan: alteredPlan.hash, state: manifest.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: alteredCommit.hash, objects: { ...state.objects,
    [alteredPlan.hash]: alteredPlan.object, [manifest.hash]: manifest.object, [alteredCommit.hash]: alteredCommit.object } }), { code: 'RECONCILIATION_MISMATCH' });
});

test('multiple common ancestors fail explicitly instead of selecting by timestamp', () => {
  const commit = parents => ({ kind: 'commit', data: { parents } });
  const objects = { root: commit([]), a: commit(['root']), b: commit(['root']), left: commit(['a', 'b']), right: commit(['b', 'a']) };
  assert.throws(() => commonAncestor(objects, 'left', 'right'), { code: 'AMBIGUOUS_ANCESTRY' });
});

test('a later verified descendant can reconcile again without losing the first merge', async () => {
  const { left, right } = await branches();
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  const first = await left.apply({ ...await review(left, right), idempotencyKey: 'merge' });
  const later = createCommandService(createMemoryAdapter(await left.read()));
  await publish(later, { library: [{ id: 'new', title: 'New', original: 'later addition' }] }, 'later');
  const preview = await review(left, later);
  assert.equal(preview.reconciliationPlan.ancestorRevision, first.revision);
  await left.apply({ ...preview, idempotencyKey: 'merge-again' });
  assert.deepEqual((await selected(left)).map(row => row.original).sort(), ['later addition', 'left', 'right']);
  await inspectTransfer(await createTransfer(await left.read()));
});

for (const phase of ['before-flush', 'before-publication', 'after-publication']) test(`reconciliation recovers after ${phase}`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-reconcile-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let interrupt = false;
  const adapter = await createFolderAdapter(directory, { fault: async point => { if (interrupt && point === phase) throw new Error('injected interruption'); } });
  const { left, right } = await branches(adapter);
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  const before = await left.read(), preview = await review(left, right); interrupt = true;
  await assert.rejects(left.apply({ ...preview, idempotencyKey: 'merge' }), /injected interruption/);
  const reopened = createCommandService(await createFolderAdapter(directory));
  if (phase === 'after-publication') await reopened.apply({ ...preview, idempotencyKey: 'merge' });
  else { assert.deepEqual(await reopened.read(), before); await reopened.apply({ ...await review(reopened, right), idempotencyKey: 'merge' }); }
  assert.deepEqual((await selected(reopened)).map(row => row.original).sort(), ['left', 'right']);
  await inspectTransfer(await createTransfer(await reopened.read()));
});

test('loopback reconciliation enforces write scope and uses normal commit and readback routes', async t => {
  const token = 'synthetic-write-token'.repeat(3), reader = 'synthetic-read-token'.repeat(3), adapter = createMemoryAdapter();
  const { left, right } = await branches(adapter);
  await publish(left, changed(0, 'left'), 'left'); await publish(right, changed(1, 'right'), 'right');
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }, { token: reader, scopes: ['read'], expiresAt: Date.now() + 60_000 }] });
  const base = await api.listen(); t.after(() => api.close());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const request = { libraryId: 'lib', expectedRevision: (await left.read()).revision, incoming: await createTransfer(await right.read()) };
  assert.equal((await post('/v1/library/reconciliations', request, { Authorization: `Bearer ${reader}` })).status, 403);
  const response = await post('/v1/library/reconciliations', request); assert.equal(response.status, 201);
  const preview = await response.json(), saved = await post('/v1/library/commits', preview, { 'Idempotency-Key': 'http-merge' });
  assert.equal(saved.status, 201); const receipt = await saved.json();
  assert.deepEqual(await (await post('/v1/library/commits', preview, { 'Idempotency-Key': 'http-merge' })).json(), receipt);
  assert.deepEqual((await selected(left)).map(row => row.original).sort(), ['left', 'right']);
});
