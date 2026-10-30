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
  { id: 'p', original: 'Parent prompt', folderId: 'root', collection: 'Ops', currentVersionId: 'current',
    versions: Array.from({ length: 31 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: true })), future: { text: 'x'.repeat(5000) } },
  { id: 'child-prompt', original: 'Child prompt', collection: 'Ops/Shows' },
  { id: 'other-prompt', original: 'Other prompt', collection: 'Other', folderId: 'other' }],
  folders: [{ id: 'root', name: 'Ops', parentId: null, collection: 'Ops', artwork: { future: true, image: 'opaque' } },
    { id: 'child', name: 'Shows', parentId: 'root', collection: 'Ops/Shows', future: [1, false] },
    { id: 'other', name: 'Other', parentId: null, collection: 'Other' }],
  collections: ['Ops', 'Ops/Shows', 'Other'], trash: [{ id: 'trashed', original: 'Keep', collection: 'Ops' }],
  scratch: { pads: [{ id: 'note', content: 'Keep' }], tombstones: {} },
  runs: [{ id: 'run', promptId: 'p', promptVersionId: 'v0', output: 'Keep' }], future: { untouched: true } });
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
async function inputFor(service, sourceBinding, folderId = 'root', action = 'change', changes = { name: 'Production' }) {
  const row = (await records(service, 'folders')).find(row => row.sourceId === folderId && row.origin.binding === sourceBinding);
  assert.ok(row);
  return { ...await query(service), sourceBinding, changedAt: stamp, action, folderId, expectedFolderHash: row.valueHash,
    ...(action === 'change' ? { changes } : { confirmRemoval: true }) };
}
async function mutate(service, input, id) {
  const review = await service.previewFolder(input);
  assert.equal(review.commitAvailable, true, JSON.stringify(review.folderPlan.currentViewPlan.blocked));
  return { review, receipt: await service.apply({ ...review, idempotencyKey: id }) };
}

test('folder publication updates descendants and assignments together and retains every prior object and prompt version', async () => {
  const service = createCommandService(createMemoryAdapter()), source = fixture(), imported = await publish(service, source), before = await service.read();
  const { receipt } = await mutate(service, await inputFor(service, imported.sourceBinding), 'rename');
  assert.equal(receipt.operation, 'folder'); assert.equal(receipt.checkpointId, before.revision);
  const prompts = await records(service, 'prompts'), parent = prompts.find(row => row.sourceId === 'p').value;
  assert.equal(parent.collection, 'Production'); assert.equal(parent.folderId, 'root');
  assert.equal(parent.versions.length, 32); assert.deepEqual(parent.versions.slice(0, 31), source.library[0].versions);
  const { versions, ...old } = source.library[0];
  assert.deepEqual(parent.versions.at(-1), { ...old, id: 'current' });
  assert.deepEqual(parent.future, source.library[0].future);
  assert.equal(prompts.find(row => row.sourceId === 'child-prompt').value.collection, 'Production/Shows');
  assert.deepEqual(prompts.find(row => row.sourceId === 'other-prompt').value, source.library[2]);
  assert.deepEqual((await records(service, 'collections')).map(row => row.value).sort(), ['Other', 'Production', 'Production/Shows']);
  const folders = await records(service, 'folders');
  assert.deepEqual(folders.find(row => row.sourceId === 'root').value, { ...source.folders[0], name: 'Production', collection: 'Production' });
  assert.deepEqual((await records(service, 'trash'))[0].value, source.trash[0]);
  const after = await service.read(); for (const [id, object] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], object);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const view = await service.previewCurrentView(await query(service));
  const collection = view.currentViewPlan.groups.find(group => group.domain === 'collections');
  await assert.rejects(service.previewCurrentView({ ...await query(service), resolutions: { [collection.id]: null } }), { code: 'INVALID_RESOLUTIONS' });
});

test('folder create, move, removal and checkpoint restore keep identities and do not resurrect obsolete paths', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), base = await service.read();
  await mutate(service, { ...await query(service), sourceBinding: imported.sourceBinding, changedAt: stamp, action: 'create',
    folder: { id: 'later', name: 'Later', parentId: null, future: { keep: true } } }, 'create');
  await mutate(service, await inputFor(service, imported.sourceBinding, 'child', 'change', { parentId: 'later' }), 'move');
  assert.equal((await records(service, 'prompts')).find(row => row.sourceId === 'child-prompt').value.collection, 'Later/Shows');
  await mutate(service, await inputFor(service, imported.sourceBinding, 'child', 'remove'), 'remove');
  assert.equal((await records(service, 'prompts')).find(row => row.sourceId === 'child-prompt').value.collection, '');
  assert.equal((await records(service, 'folders')).length, 3);
  await assert.rejects(service.previewFolder({ ...await query(service), sourceBinding: imported.sourceBinding, changedAt: stamp, action: 'create',
    folder: { id: 'child', name: 'Reuse', parentId: null } }), { code: 'IDENTITY_CONFLICT' });
  const restore = await service.previewRestore({ ...await query(service), checkpointId: base.revision });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restore-select');
  assert.deepEqual((await records(service, 'collections')).map(row => row.value).sort(), fixture().collections.sort());
  assert.deepEqual((await records(service, 'folders')).map(row => row.value).sort((a, b) => a.id.localeCompare(b.id)), fixture().folders.sort((a, b) => a.id.localeCompare(b.id)));
  assert.deepEqual((await records(service, 'prompts')).map(row => row.value).sort((a, b) => a.id.localeCompare(b.id)), fixture().library.sort((a, b) => a.id.localeCompare(b.id)));
});

test('independent folder renames reconcile by identity; competing names require consistent explicit choices', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), base = await service.read();
  for (const same of [false, true]) {
    const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
    await mutate(left, await inputFor(left, imported.sourceBinding), 'left');
    await mutate(right, await inputFor(right, imported.sourceBinding, same ? 'root' : 'other', 'change', { name: 'Alternate' }), 'right');
    const incoming = await createTransfer(await right.read());
    let review = await left.previewReconcile({ ...await query(left), incoming });
    assert.equal(review.commitAvailable, !same);
    if (same) {
      const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict); assert.equal(conflicts.length, 4);
      const resolutions = Object.fromEntries(conflicts.map(row => [row.groupId, 'incoming']));
      const folderId = (await inspectPackage(pkg(await left.read()))).manifest.recordGroups.find(group => group.sourceId === 'root').id;
      const mixed = await left.previewReconcile({ ...await query(left), incoming, resolutions: { ...resolutions, [folderId]: 'current' } });
      assert.equal(mixed.commitAvailable, false); assert.ok(mixed.reconciliationPlan.folderReview.blocked.length);
      review = await left.previewReconcile({ ...await query(left), incoming, resolutions });
      assert.equal(review.commitAvailable, true);
    }
    await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
    assert.deepEqual((await records(left, 'collections')).map(row => row.value).sort(), same ? ['Alternate', 'Alternate/Shows', 'Other'] : ['Alternate', 'Production', 'Production/Shows']);
    assert.deepEqual((await inspectTransfer(await createTransfer(await left.read()))).state, await left.read());
  }
});

test('folder removal versus a concurrent assigned prompt edit cannot publish a dangling assignment', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), base = await service.read();
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  await mutate(left, await inputFor(left, imported.sourceBinding, 'other', 'remove'), 'remove');
  const page = await right.currentRecords({ ...await query(right), domain: 'prompts' }), row = page.items.find(row => row.sourceId === 'other-prompt');
  const edit = await right.previewEdit({ ...await query(right), groupId: page.groups.find(group => group.selected === row.key).id,
    expectedRecordHash: row.valueHash, editedAt: stamp, updates: [{ path: ['original'], value: 'Concurrent edit' }] });
  await right.apply({ ...edit, idempotencyKey: 'edit' });
  const incoming = await createTransfer(await right.read()), first = await left.previewReconcile({ ...await query(left), incoming });
  const conflict = first.reconciliationPlan.rows.find(row => row.conflict);
  const unsafe = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflict.groupId]: 'incoming' } });
  assert.equal(unsafe.commitAvailable, false); assert.equal(unsafe.reconciliationPlan.folderReview.blocked[0].code, 'INVALID_FOLDER_REFERENCES');
  await assert.rejects(left.apply({ ...unsafe, idempotencyKey: 'unsafe' }));
  const safe = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflict.groupId]: 'current' } });
  assert.equal(safe.commitAvailable, true);
});

test('concurrent folder creations cannot merge case-insensitive sibling name collisions', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), base = await service.read();
  const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
  for (const [branch, id, name] of [[left, 'new-left', 'Future'], [right, 'new-right', 'future']]) {
    await mutate(branch, { ...await query(branch), sourceBinding: imported.sourceBinding, changedAt: stamp, action: 'create',
      folder: { id, name, parentId: 'root' } }, id);
  }
  const incoming = await createTransfer(await right.read()), review = await left.previewReconcile({ ...await query(left), incoming });
  assert.equal(review.commitAvailable, false); assert.equal(review.reconciliationPlan.folderReview.blocked[0].code, 'INVALID_FOLDER_GRAPH');
  await assert.rejects(left.apply({ ...review, idempotencyKey: 'invalid-merge' }));
  assert.equal((await records(left, 'folders')).length, 4);
});

test('folder commands reject stale, cross-source and malformed requests; hash-valid forged plans fail verification', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), input = await inputFor(service, imported.sourceBinding);
  for (const patch of [{ changedAt: '2026-02-30T00:00:00.000Z' }, { changes: { id: 'different' } }, { unexpected: true }]) {
    await assert.rejects(service.previewFolder({ ...input, ...patch }), { code: 'INVALID_FOLDER_COMMAND' });
  }
  await assert.rejects(service.previewFolder({ ...input, expectedFolderHash: 'sha256:' + '0'.repeat(64) }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(service.previewFolder({ ...input, sourceBinding: 'sha256:' + '0'.repeat(64) }), { code: 'UNBOUND_SOURCE' });
  await mutate(service, input, 'rename'); await assert.rejects(service.previewFolder(input), { code: 'REVISION_CONFLICT' });
  const state = await service.read(), commit = state.objects[state.revision].data, forged = structuredClone(state.objects[commit.folderPlan].data);
  forged.manifest.recordGroups[0].selectedHash = 'sha256:' + '0'.repeat(64);
  const plan = await makeObject('folder-mutation-plan', forged), head = await makeObject('commit', { ...commit, folderPlan: plan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects, [plan.hash]: plan.object, [head.hash]: head.object } }), { code: 'FOLDER_PLAN_MISMATCH' });
  const other = fixture(); other.library = [{ id: 'other-source', original: 'Other source' }];
  const foreign = await publish(service, other, 'other-import', 'foreign');
  const request = await inputFor(service, imported.sourceBinding);
  await assert.rejects(service.previewFolder({ ...request, sourceBinding: foreign.sourceBinding }), { code: 'RECORD_CONFLICT' });
});

test('folder publication is atomic across interruption and recovers one receipt after a lost acknowledgement', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-folder-command-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure; const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) throw new Error('Injected interruption'); } });
  const service = createCommandService(adapter), imported = await publish(service), before = await service.read();
  const review = await service.previewFolder(await inputFor(service, imported.sourceBinding));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'rename' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'rename' }));
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('rename');
  assert.equal(receipt.operation, 'folder'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'rename' }), receipt);
  assert.deepEqual((await records(reopened, 'collections')).map(row => row.value).sort(), ['Other', 'Production', 'Production/Shows']);
  assert.equal((await records(reopened, 'prompts')).find(row => row.sourceId === 'p').value.versions.length, 32);
});

for (const action of ['create', 'change', 'remove']) test(`folder ${action} has direct/API parity and durable outbox recovery without a duplicate operation`, async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service);
  const token = 'synthetic-folder-credential-'.repeat(2), readToken = token + 'read';
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [
    { token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }, { token: readToken, scopes: ['read'], expiresAt: Date.now() + 60_000 }] });
  const url = await api.listen(); t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  const input = action === 'create' ? { ...await query(service), action, changedAt: stamp, sourceBinding: imported.sourceBinding,
    folder: { id: 'new', name: 'New', parentId: 'root', unknown: true } } : await inputFor(service, imported.sourceBinding, 'child', action);
  const request = { ...input, mode: 'folder' }, review = await createServiceTransport(service, { libraryId: 'lib' }).preview(request);
  assert.deepEqual((await transport.preview(request)).folderPlan, review.folderPlan);
  let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'queued-folder' });
  await assert.rejects(outbox.replay('lib', 'queued-folder', { ...transport, apply: async input => { await transport.apply(input); throw new Error('Lost response'); } }));
  assert.equal((await createCommandOutbox(store).replay('lib', 'queued-folder', transport)).state, 'committed');
  assert.equal(Object.keys((await service.read()).operations).length, 3);
  assert.equal((await records(service, 'folders')).length, action === 'create' ? 4 : action === 'remove' ? 2 : 3);
  for (const bearer of [undefined, readToken]) {
    const response = await fetch(`${url}/v1/library/folder-mutations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(input) });
    assert.equal(response.status, bearer ? 403 : 401);
  }
});
