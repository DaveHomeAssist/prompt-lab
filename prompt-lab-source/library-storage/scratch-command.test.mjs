import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, FORMAT, VERSION } from './contract.mjs';
import { recordGroupId } from './record-state.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';
import { createLoopbackTransport, createServiceTransport } from './command-client.mjs';
import { createCommandOutbox } from './command-outbox.mjs';

const stamp = '2026-10-29T16:00:00.000Z';
const fixture = () => ({ library: [{ id: 'prompt', original: 'Prompt', versions: [{ id: 'v1', original: 'Original', unknown: ['retained'] }] }],
  evaluations: [{ id: 'eval', output: 'Before', promptId: 'prompt', future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  testCases: [{ id: 'case', input: 'Case', promptId: 'prompt', future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  traceRuns: [{ run_id: 'trace', trace_id: 'parent', outputs: { text: 'Trace' }, future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  experiments: [{ id: 'experiment', variants: [{ id: 'variant', long: 'v'.repeat(5000), unknown: true }], future: { keep: { bytes: 'unknown' }, edit: 1 } }],
  packs: { pack: { id: 'pack', title: 'Pack', version: '7.2.0', source: 'authored', future: { keep: { bytes: 'unknown' }, edit: 1 } } }, loadedPacks: ['pack'],
  scratch: { pads: [{ id: 'note', name: 'First', content: 'Keep this note', createdAt: 12, unknown: { keep: 9 } }, { id: 'other', name: 'Other', content: 'Second note', createdAt: 13 }], activePadId: 'note', revision: 19, future: { preserve: true }, tombstones: { removed: 10 } }, trash: [] });
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
  assert.ok(row);
  const groupId = group?.id ?? row.commandGroupId;
  assert.equal(groupId, await recordGroupId('lib', domain, row.origin.sourceIdentity, row.sourceId));
  return { ...await query(service), domain, action, changedAt: stamp, groupId, expectedRecordHash: row.valueHash,
    ...(action === 'delete' ? { confirmPermanentDeletion: true } : { updates: [{ path: ['content'], value: 'Edited note' }] }) };
}
async function mutate(service, input, id) {
  const review = await service.previewRecord(input);
  assert.equal(review.commitAvailable, true, JSON.stringify(review.recordPlan.currentViewPlan.blocked));
  return { review, receipt: await service.apply({ ...review, idempotencyKey: id }) };
}
async function records(service, domain) { return (await service.currentRecords({ ...await query(service), domain })).items; }

const notes = service => records(service, 'scratch-notes');
async function createNote(service, binding, id = 'new') {
  return { ...await query(service), domain: 'scratch-notes', action: 'create', changedAt: stamp, sourceBinding: binding,
    record: { id, name: 'New note', content: 'Complete content 🧪'.repeat(1000), linkedPrompts: [{ id: 'prompt', title: 'Prompt', unknown: true }], future: ['preserved'] } };
}

test('Scratch commands preserve notes, unknown metadata and raw containers through transfer and restart', async () => {
  const service = createCommandService(createMemoryAdapter()), original = fixture();
  const imported = await publish(service, original), before = await service.read();
  const input = await inputFor(service, 'scratch-notes', 'update', 'note');
  input.updates.push({ path: ['name'], value: 'Renamed' }, { path: ['unknown', 'edit'], value: ['added'] });
  const { receipt } = await mutate(service, input, 'edit');
  assert.equal(receipt.checkpointId, before.revision);
  assert.deepEqual((await notes(service)).find(row => row.sourceId === 'note').value, { ...original.scratch.pads[0],
    name: 'Renamed', content: 'Edited note', unknown: { keep: 9, edit: ['added'] }, updatedAt: Date.parse(stamp), timestamp: Date.parse(stamp) });
  assert.deepEqual((await notes(service)).find(row => row.sourceId === 'other').value, original.scratch.pads[1]);
  await mutate(service, await createNote(service, imported.sourceBinding), 'create');
  const deletion = await mutate(service, await inputFor(service, 'scratch-notes', 'delete', 'note'), 'delete');
  const container = (await records(service, 'scratch'))[0];
  assert.equal(container.projection, 'scratch-notes'); assert.notEqual(container.valueHash, container.sourceValueHash);
  assert.deepEqual(container.value.future, original.scratch.future); assert.equal(container.value.revision, 19);
  assert.equal(container.value.activePadId, 'other');
  assert.equal(container.references[0].sourceId, 'other');
  assert.deepEqual(container.references[0].candidates, [(await notes(service)).find(row => row.sourceId === 'other').key]);
  assert.deepEqual(container.value.pads.map(note => note.id), ['other', 'new']);
  assert.deepEqual(container.value.tombstones, { removed: 10, note: Date.parse(stamp) });
  assert.deepEqual((await records(service, 'prompts'))[0].value, original.library[0]);
  const after = await service.read();
  for (const [id, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], value);
  for (const [id, value] of Object.entries(before.operations)) assert.deepEqual(after.operations[id], value);
  const transferred = (await inspectTransfer(await createTransfer(after))).state;
  assert.deepEqual(transferred, after);
  assert.deepEqual(await createCommandService(createMemoryAdapter(transferred)).apply({ ...deletion.review, idempotencyKey: 'delete' }), deletion.receipt);
});

test('Scratch creation initializes an absent container and deletion permits empty notes without invented content', async () => {
  const content = fixture(); delete content.scratch;
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service, content);
  await mutate(service, await createNote(service, imported.sourceBinding), 'create');
  assert.deepEqual((await records(service, 'scratch'))[0].value.pads.map(note => note.id), ['new']);
  await mutate(service, await inputFor(service, 'scratch-notes', 'delete', 'new'), 'delete');
  assert.deepEqual((await records(service, 'scratch'))[0].value, { pads: [], activePadId: '', tombstones: { new: Date.parse(stamp) } });
  await assert.rejects(service.previewRecord(await createNote(service, imported.sourceBinding)), { code: 'IDENTITY_CONFLICT' });
});

test('Scratch rejects unconfirmed deletion, reused tombstones, malformed fields, stale notes and metadata rewrites', async () => {
  const service = createCommandService(createMemoryAdapter()), imported = await publish(service), before = await service.read();
  const input = await inputFor(service, 'scratch-notes', 'update', 'note');
  for (const [path, value] of [[['id'], 'other'], [['createdAt'], 0], [['updatedAt'], 0], [['timestamp'], 0], [['content'], {}],
    [['pinned'], 1], [['status'], 'lost'], [['color'], 'invisible'], [['tags'], [12]], [['linkedPrompts'], [{}]], [['__proto__'], {}]]) {
    await assert.rejects(service.previewRecord({ ...input, updates: [{ path, value }] }), { code: 'INVALID_RECORD_COMMAND' });
  }
  const deletion = await inputFor(service, 'scratch-notes', 'delete', 'note');
  await assert.rejects(service.previewRecord({ ...deletion, confirmPermanentDeletion: false }), { code: 'INVALID_RECORD_COMMAND' });
  await assert.rejects(service.previewRecord({ ...input, expectedRecordHash: 'sha256:' + '0'.repeat(64) }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(service.previewRecord(await createNote(service, imported.sourceBinding, 'removed')), { code: 'IDENTITY_CONFLICT' });
  await assert.rejects(service.previewRecord({ ...await createNote(service, imported.sourceBinding), record: { id: 'new', name: 'Name', content: '', createdAt: 1 } }), { code: 'INVALID_RECORD_COMMAND' });
  assert.deepEqual(await service.read(), before);
  await mutate(service, input, 'first');
  await assert.rejects(service.previewRecord(input), { code: 'REVISION_CONFLICT' });
});

test('Scratch independent note changes merge and competing edits require an explicit choice', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  for (const same of [false, true]) {
    const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
    await mutate(left, await inputFor(left, 'scratch-notes', 'update', 'note'), 'left');
    const input = await inputFor(right, 'scratch-notes', 'update', same ? 'note' : 'other'); input.updates[0].value = 'Right content';
    await mutate(right, input, 'right');
    const incoming = await createTransfer(await right.read());
    let review = await left.previewReconcile({ ...await query(left), incoming });
    assert.equal(review.commitAvailable, !same);
    const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict);
    assert.equal(conflicts.length, same ? 1 : 0);
    if (same) review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflicts[0].groupId]: 'incoming' } });
    await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
    const result = (await records(left, 'scratch'))[0].value;
    assert.equal(result.pads.find(note => note.id === 'note').content, same ? 'Right content' : 'Edited note');
    assert.equal(result.pads.find(note => note.id === 'other').content, same ? 'Second note' : 'Right content');
    assert.deepEqual(result.future, fixture().scratch.future);
  }
});

test('Scratch restore recovers prior values, excludes later creations and honors deletion across older imports and other sources', async () => {
  const service = createCommandService(createMemoryAdapter()), content = fixture(), imported = await publish(service), before = await service.read();
  await mutate(service, await inputFor(service, 'scratch-notes', 'update', 'note'), 'edit');
  await mutate(service, await createNote(service, imported.sourceBinding), 'create');
  await mutate(service, await inputFor(service, 'scratch-notes', 'delete', 'other'), 'delete');
  const restore = await service.previewRestore({ ...await query(service), checkpointId: before.revision });
  assert.equal(restore.commitAvailable, true); await service.apply({ ...restore, idempotencyKey: 'restore' }); await select(service, 'restored-select');
  assert.deepEqual((await notes(service)).map(row => row.value), [content.scratch.pads[0]]);
  await publish(service, content, 'older-import');
  assert.deepEqual((await notes(service)).map(row => row.value), [content.scratch.pads[0]]);
  const otherSource = fixture(); otherSource.library = [{ id: 'other-source', original: 'Different source' }];
  await publish(service, otherSource, 'other-source-import', 'other-origin');
  assert.equal((await notes(service)).length, 3);
});

test('Scratch deletion survives a concurrent edit and untouched notes survive reconciliation with a non-Scratch branch', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); const base = await service.read();
  for (const deleting of [false, true]) {
    const left = createCommandService(createMemoryAdapter(base)), right = createCommandService(createMemoryAdapter(base));
    await mutate(left, await inputFor(left, 'scratch-notes', deleting ? 'delete' : 'update', 'note'), 'left');
    if (deleting) await mutate(right, await inputFor(right, 'scratch-notes', 'update', 'note'), 'right');
    else {
      const input = await inputFor(right, 'evaluations', 'update', 'eval'); input.updates = [{ path: ['output'], value: 'Unrelated evaluation' }];
      await mutate(right, input, 'right');
    }
    const incoming = await createTransfer(await right.read());
    let review = await left.previewReconcile({ ...await query(left), incoming });
    const conflicts = review.reconciliationPlan.rows.filter(row => row.conflict);
    assert.equal(conflicts.length, deleting ? 1 : 0);
    if (deleting) review = await left.previewReconcile({ ...await query(left), incoming, resolutions: { [conflicts[0].groupId]: 'incoming' } });
    assert.equal(review.commitAvailable, true);
    await left.apply({ ...review, idempotencyKey: 'reconcile' }); await select(left, 'merged-select');
    const result = await notes(left);
    assert.equal(result.length, deleting ? 1 : 2);
    assert.deepEqual(result.find(row => row.sourceId === 'other').value, fixture().scratch.pads[1]);
    if (!deleting) assert.equal(result.find(row => row.sourceId === 'note').value.content, 'Edited note');
  }
});

test('Scratch rejects malformed containers and explicitly inactive metadata without changing stored data', async () => {
  for (const kind of ['tombstone', 'duplicate', 'inactive']) {
    const content = fixture();
    if (kind === 'tombstone') content.scratch.tombstones.removed = 'unknown';
    if (kind === 'duplicate') content.scratch.pads.push({ ...content.scratch.pads[0] });
    const service = createCommandService(createMemoryAdapter()); const imported = await publish(service, content);
    if (kind === 'inactive') {
      const review = await service.previewCurrentView(await query(service));
      const id = review.currentViewPlan.groups.find(group => group.domain === 'scratch').id;
      const choice = await service.previewCurrentView({ ...await query(service), resolutions: { [id]: null } });
      await service.apply({ ...choice, idempotencyKey: 'deselect' });
    }
    const before = await service.read();
    await assert.rejects(service.previewRecord(await createNote(service, imported.sourceBinding)), { code: kind === 'inactive' ? 'SCRATCH_CONTAINER_UNAVAILABLE' : 'INVALID_SCRATCH_STATE' });
    assert.deepEqual(await service.read(), before);
  }
});

test('Scratch interrupted publication preserves previous state and restart recovers lost acknowledgement once', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-scratch-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure, injected = 0;
  const adapter = await createFolderAdapter(directory, { fault: async point => { if (failure === point) { injected++; throw new Error('Synthetic interruption'); } } });
  const service = createCommandService(adapter); await publish(service);
  const before = await service.read(), review = await service.previewRecord(await inputFor(service, 'scratch-notes', 'update', 'note'));
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'update' })); assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication'; await assert.rejects(service.apply({ ...review, idempotencyKey: 'update' }));
  assert.equal(injected, 3);
  const reopened = createCommandService(await createFolderAdapter(directory)), receipt = await reopened.operation('update');
  assert.equal(receipt.operation, 'record'); assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'update' }), receipt);
  assert.equal((await notes(reopened)).find(row => row.sourceId === 'note').value.content, 'Edited note');
  for (const [id, value] of Object.entries(before.objects)) assert.deepEqual((await reopened.read()).objects[id], value);
});

for (const action of ['create', 'update', 'delete']) test(`Scratch ${action} has direct/API parity and durable response-loss recovery`, async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter), imported = await publish(service);
  const token = 'synthetic-scratch-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const url = await api.listen(); t.after(() => api.close());
  const direct = createServiceTransport(service, { libraryId: 'lib' }), transport = createLoopbackTransport({ baseUrl: url, libraryId: 'lib', getToken: () => token });
  const input = action === 'create' ? await createNote(service, imported.sourceBinding) : await inputFor(service, 'scratch-notes', action, 'note');
  const request = { ...input, mode: 'record' }, review = await direct.preview(request);
  assert.deepEqual((await transport.preview(request)).recordPlan, review.recordPlan);
  let entry = null; const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request, review, operationId: 'scratch' });
  await assert.rejects(outbox.replay('lib', 'scratch', { ...transport, apply: async value => { await transport.apply(value); throw new Error('Lost response'); } }));
  const committed = await createCommandOutbox(store).replay('lib', 'scratch', transport);
  assert.equal(committed.state, 'committed'); assert.equal((await notes(service)).length, action === 'create' ? 3 : action === 'delete' ? 1 : 2);
  assert.equal(Object.keys((await service.read()).operations).length, 3);
});
