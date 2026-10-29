import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, canonical, hash } from './contract.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createLocalApi } from './local-api.mjs';
import { createLoopbackTransport, createServiceTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';

const content = () => ({ library: ['a', 'b'].map(id => ({ id, original: `Original ${id}`, future: { preserved: true },
  versions: Array.from({ length: 41 }, (_, n) => ({ id: `${id}${n}`, original: `History ${n}`, future: n })) })),
  runs: [{ id: 'run', output: 'Retained run', promptId: 'missing' }], future: { unknown: [null, false] } });
async function publish(service, value, operationId) {
  const entries = { 'pl2-library': JSON.stringify(value.library), 'pl2-library-trash': '[]' };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'shared-origin',
    localStorage: { length: 2, key: n => Object.keys(entries)[n], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic empty source.' }), archives: { reviewed: true, records: [] },
    capturedAt: '2026-10-29T00:00:00Z' });
  const request = { libraryId: 'lib', expectedRevision: (await service.read()).revision, sourceText: JSON.stringify(value), mode: 'import', sourceInventory };
  let review = await service.preview(request);
  const pending = review.importPlan.rows.filter(row => !row.choice);
  if (pending.length) review = await service.preview({ ...request, resolutions: Object.fromEntries(pending.map(row => [row.member, { action: 'replace', target: row.matches[0] }])) });
  return service.apply({ ...review, idempotencyKey: operationId });
}
async function copyJournal(source, destination) {
  const target = join(destination, 'transactions'); await mkdir(target, { recursive: true });
  for (const name of (await readdir(join(source, 'transactions'))).filter(name => name.endsWith('.json'))) {
    const bytes = await readFile(join(source, 'transactions', name));
    try { await writeFile(join(target, name), bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(join(target, name)), bytes); }
  }
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'promptlab-folder-recovery-')); t.after(() => rm(root, { recursive: true, force: true }));
  const dirs = ['left', 'right', 'third'].map(name => join(root, name));
  const left = createCommandService(await createFolderAdapter(dirs[0])); await publish(left, content(), 'base');
  for (const dir of dirs.slice(1)) await copyJournal(dirs[0], dir);
  const services = [left, ...await Promise.all(dirs.slice(1).map(async dir => createCommandService(await createFolderAdapter(dir))))];
  for (let n = 0; n < 3; n++) { const value = content(); value.library[n === 1 ? 1 : 0].original = `Edit ${n}`; await publish(services[n], value, `edit-${n}`); }
  const states = await Promise.all(services.map(service => service.read()));
  await copyJournal(dirs[1], dirs[0]);
  return { dirs, states, adapter: await createFolderAdapter(dirs[0]) };
}
async function recovery(f, current = f.states[0], incoming = f.states[1]) {
  const page = await f.adapter.branches({ libraryId: 'lib' }), head = page.items.find(item => item.revision === current.revision);
  const adapter = await f.adapter.selectBranch(head.transactionId), service = createCommandService(adapter);
  const request = { libraryId: 'lib', expectedRevision: current.revision, incoming: await createTransfer(incoming) };
  const review = await service.previewReconcile(request);
  return { adapter, service, request, review, transaction: head.transactionId };
}

test('divergent folder heads can be reviewed and reconciled without deleting either history', async t => {
  const f = await fixture(t); await assert.rejects(f.adapter.read(), { code: 'DIVERGENT_HEADS' });
  const before = new Map(await Promise.all((await readdir(join(f.dirs[0], 'transactions'))).map(async name => [name, await readFile(join(f.dirs[0], 'transactions', name))])));
  const r = await recovery(f); assert.equal(r.review.commitAvailable, true);
  const receipt = await r.service.apply({ ...r.review, idempotencyKey: 'merge' });
  const state = await f.adapter.read(); assert.equal(state.revision, receipt.revision);
  for (const branch of f.states.slice(0, 2)) {
    for (const [id, object] of Object.entries(branch.objects)) assert.deepEqual(state.objects[id], object);
    for (const [id, operation] of Object.entries(branch.operations)) assert.deepEqual(state.operations[id], operation);
    for (const checkpoint of branch.checkpoints) assert.ok(state.checkpoints.includes(checkpoint));
  }
  for (const [name, bytes] of before) assert.deepEqual(await readFile(join(f.dirs[0], 'transactions', name)), bytes);
  assert.deepEqual((await inspectTransfer(await createTransfer(state))).state, state);
  assert.equal((await f.adapter.branches({ libraryId: 'lib' })).total, 1);
  const reopened = createCommandService(await (await createFolderAdapter(f.dirs[0])).selectBranch(r.transaction));
  assert.deepEqual(await reopened.apply({ ...r.review, idempotencyKey: 'merge' }), receipt);
});

test('a third head remains inactive until another explicit conflict review', async t => {
  const f = await fixture(t); await copyJournal(f.dirs[2], f.dirs[0]);
  const r = await recovery(f); await r.service.apply({ ...r.review, idempotencyKey: 'first-merge' });
  await assert.rejects(f.adapter.read(), { code: 'DIVERGENT_HEADS' });
  assert.equal((await f.adapter.branches({ libraryId: 'lib' })).total, 2);
  const next = await recovery(f, await r.service.read(), f.states[2]);
  assert.ok(next.review.reconciliationPlan.unresolved > 0);
  await assert.rejects(next.service.apply({ ...next.review, idempotencyKey: 'unreviewed' }), { code: 'UNRESOLVED_RECONCILIATION' });
  const review = await next.service.previewReconcile({ ...next.request, resolutions: Object.fromEntries(next.review.reconciliationPlan.rows.filter(row => row.conflict).map(row => [row.groupId, 'current'])) });
  await next.service.apply({ ...review, idempotencyKey: 'second-merge' });
  const final = await f.adapter.read(); assert.equal(Object.keys(final.operations).length, 6);
  for (const state of f.states) for (const [id, object] of Object.entries(state.objects)) assert.deepEqual(final.objects[id], object);
});

test('head changes and ordinary recovery writes cannot publish a stale or unrelated edit', async t => {
  const f = await fixture(t), r = await recovery(f);
  await assert.rejects(publish(r.service, content(), 'ordinary'), { code: 'RECOVERY_ONLY' });
  const before = (await readdir(join(f.dirs[0], 'transactions'))).length;
  await copyJournal(f.dirs[2], f.dirs[0]);
  await assert.rejects(r.service.apply({ ...r.review, idempotencyKey: 'stale' }), { code: 'FOLDER_CHANGED' });
  assert.equal((await readdir(join(f.dirs[0], 'transactions'))).length, before + 1);
  const fresh = await recovery(f); assert.notDeepEqual(fresh.review.folderRecovery, r.review.folderRecovery);
});

test('a durable reconciliation requires fresh review when a sibling arrives across service restart', async t => {
  const f = await fixture(t), r = await recovery(f);
  let stored;
  const store = {
    async read() { return structuredClone(stored ?? null); },
    async list() { return stored ? [structuredClone(stored)] : []; },
    async write(row, version) {
      assert.equal(stored?.version ?? null, version);
      stored = structuredClone(row);
    },
  };
  const outbox = createCommandOutbox(store);
  await outbox.enqueue({ request: { ...r.request, mode: 'reconcile' }, review: r.review, operationId: 'queued-merge' });
  await copyJournal(f.dirs[2], f.dirs[0]);
  const fresh = await recovery(f), transport = createServiceTransport(fresh.service, { libraryId: 'lib' });
  assert.equal(fresh.review.fingerprint, r.review.fingerprint);
  await assert.rejects(createCommandOutbox(store).replay('lib', 'queued-merge', transport), { code: 'REVIEW_CHANGED' });
  const retained = await outbox.read('lib', 'queued-merge');
  assert.equal(retained.state, 'failed');
  assert.deepEqual(retained.request.incoming, r.request.incoming);
  assert.equal(await fresh.service.operation('queued-merge'), null);
  assert.equal((await f.adapter.branches({ libraryId: 'lib' })).total, 3);
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) test(`folder reconciliation recovers after ${point}`, async t => {
  const f = await fixture(t);
  f.adapter = await createFolderAdapter(f.dirs[0], { fault: async phase => { if (phase === point) throw new Error('Synthetic interruption'); } });
  const r = await recovery(f); await assert.rejects(r.service.apply({ ...r.review, idempotencyKey: 'merge' }), /Synthetic interruption/);
  const clean = await createFolderAdapter(f.dirs[0]), restarted = createCommandService(await clean.selectBranch(r.transaction));
  if (point === 'after-publication') assert.equal((await restarted.operation('merge')).state, 'committed');
  else {
    await assert.rejects(clean.read(), { code: 'DIVERGENT_HEADS' });
    const review = await restarted.previewReconcile(r.request); await restarted.apply({ ...review, idempotencyKey: 'merge' });
  }
  assert.equal((await clean.branches({ libraryId: 'lib' })).total, 1);
  assert.equal(Object.keys((await clean.read()).operations).length, 4);
});

test('legacy transaction bytes remain intact when a version 2 descendant is published', async t => {
  const root = await mkdtemp(join(tmpdir(), 'promptlab-legacy-journal-')); t.after(() => rm(root, { recursive: true, force: true }));
  const service = createCommandService(createMemoryAdapter()); await publish(service, content(), 'base');
  const row = { schemaVersion: 1, parent: null, state: await service.read() }, bytes = canonical(row), id = await hash(row);
  const journal = join(root, 'transactions'); await mkdir(journal); const original = join(journal, `${id.slice(7)}.json`); await writeFile(original, bytes);
  const adapter = await createFolderAdapter(root); assert.deepEqual(await adapter.read(), row.state);
  const changed = content(); changed.library[0].original = 'New'; await publish(createCommandService(adapter), changed, 'new');
  assert.equal(await readFile(original, 'utf8'), bytes);
  const head = (await adapter.branches({ libraryId: 'lib' })).items[0];
  const next = JSON.parse(await readFile(join(journal, `${head.transactionId.slice(7)}.json`), 'utf8'));
  assert.equal(next.schemaVersion, 2); assert.deepEqual(next.parents, [id]);
});

test('bounded branch pages reject changed graphs, wrong libraries and lost receipt history', async t => {
  const f = await fixture(t), page = await f.adapter.branches({ libraryId: 'lib', limit: 1 });
  assert.equal(page.total, 2); assert.equal(page.nextCursor, '1');
  assert.equal((await f.adapter.branches({ libraryId: 'lib', limit: 1, cursor: '1', expectedGraph: page.graphRevision })).items.length, 1);
  await assert.rejects(f.adapter.branches({ libraryId: 'other' }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(f.adapter.branches({ libraryId: 'lib', cursor: '1' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.adapter.selectBranch('sha256:' + '0'.repeat(64)), { code: 'BRANCH_NOT_FOUND' });
  await copyJournal(f.dirs[2], f.dirs[0]);
  await assert.rejects(f.adapter.branches({ libraryId: 'lib', expectedGraph: page.graphRevision }), { code: 'FOLDER_CHANGED' });
  const head = (await f.adapter.branches({ libraryId: 'lib' })).items[0], state = structuredClone(f.states.find(s => s.revision === head.revision));
  delete state.operations.base;
  const bad = { schemaVersion: 2, parents: [head.transactionId], state }, id = await hash(bad);
  await writeFile(join(f.dirs[0], 'transactions', `${id.slice(7)}.json`), canonical(bad));
  await assert.rejects(f.adapter.branches({ libraryId: 'lib' }), { code: 'HISTORY_LOSS' });
});

test('authenticated HTTP recovery uses the same service and survives API restart after response loss', async t => {
  const f = await fixture(t), token = 'synthetic-folder-recovery-'.repeat(3), readToken = 'synthetic-read-only-'.repeat(3);
  let api;
  const open = async () => { api = createLocalApi({ adapter: await createFolderAdapter(f.dirs[0]), libraryId: 'lib', credentials: [
    { token, scopes: ['read', 'write'], expiresAt: Date.now() + 120_000 }, { token: readToken, scopes: ['read'], expiresAt: Date.now() + 120_000 }], allowedOrigins: ['http://paired.example'] }); return api.listen(); };
  let baseUrl = await open(); t.after(() => api.close());
  const normal = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => token });
  await assert.rejects(normal.identity(), { code: 'DIVERGENT_HEADS' });
  assert.equal((await fetch(`${baseUrl}/v1/library/folder-branches`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/v1/library/folder-branches`, { headers: { Authorization: `Bearer ${token}`, Origin: 'http://hostile.example' } })).status, 403);
  const page = await normal.branches(), branch = page.items.find(item => item.revision === f.states[0].revision);
  const transport = createLoopbackTransport({ baseUrl, libraryId: 'lib', folderBranch: branch.transactionId, getToken: () => token });
  assert.equal((await transport.identity()).revision, f.states[0].revision);
  assert.deepEqual((await inspectTransfer(await transport.transfer(f.states[0].revision))).state, f.states[0]);
  await assert.rejects(transport.preview({ mode: 'snapshot', libraryId: 'lib', expectedRevision: f.states[0].revision, sourceText: '{"library":[]}' }), { code: 'RECOVERY_ONLY' });
  const request = { mode: 'reconcile', libraryId: 'lib', expectedRevision: f.states[0].revision, incoming: await createTransfer(f.states[1]) };
  const review = await transport.preview(request), commit = { ...review, idempotencyKey: 'http-merge' };
  const readOnly = createLoopbackTransport({ baseUrl, libraryId: 'lib', folderBranch: branch.transactionId, getToken: () => readToken });
  await assert.rejects(readOnly.apply(commit), { code: 'FORBIDDEN' });
  await transport.apply(commit); await api.close(); baseUrl = await open();
  const restarted = createLoopbackTransport({ baseUrl, libraryId: 'lib', folderBranch: branch.transactionId, getToken: () => token });
  const receipt = await restarted.operation('http-merge'); assert.equal(receipt.state, 'committed');
  assert.deepEqual(await restarted.apply(commit), receipt);
  assert.equal((await api.service.read()).revision, receipt.revision);
  assert.equal((await restarted.branches()).total, 1);
});
