import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { normalizeCommandRequest, commandFingerprint, createCommandOutbox } from './command-outbox.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';
import { createLoopbackTransport } from './command-client.mjs';

const content = () => ({ library: [{ id: 'p', original: 'Original', versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, unknown: n })) }],
  evaluations: [{ id: 'eval', output: 'Original result', future: { preserved: true } }],
  scratch: { pads: [{ id: 'note', content: 'Keep my note' }], tombstones: {} }, future: { raw: ['retained'] } });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: 'lib', head: state.revision, objects: state.objects });
async function input(service, value, markers = {}) {
  const entries = { 'pl2-library': JSON.stringify(value.library), 'pl2-library-trash': '[]', ...markers };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'origin',
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture.' }),
    archives: { reviewed: true, records: [] }, capturedAt: '2026-10-30T00:00:00Z' });
  return { ...await query(service), mode: 'import', sourceText: JSON.stringify(value), sourceInventory };
}
async function seed(adapter = createMemoryAdapter()) {
  const service = createCommandService(adapter);
  await service.apply({ ...await service.preview(await input(service, content())), idempotencyKey: 'seed' });
  await service.apply({ ...await service.previewCurrentView(await query(service)), idempotencyKey: 'select' });
  return service;
}
const page = async (service, domain) => service.currentRecords({ ...await query(service), domain });
async function request(service, value, markers) {
  const next = { ...await input(service, value, markers), currentView: { resolutions: {} } };
  const review = await service.preview(next);
  next.resolutions = Object.fromEntries(review.importPlan.rows.filter(row => !row.choice)
    .map(row => [row.member, { action: 'replace', target: row.matches[0] }]));
  return next;
}

test('import commits archive and reviewed app view together, preserves history and retries after transfer', async () => {
  const service = await seed(), before = await service.read(), next = content();
  next.library[0].original = 'Imported change'; next.library.push({ id: 'new', original: 'New prompt' });
  const req = await request(service, next), review = await service.preview(req);
  assert.ok(review.importPlan.currentViewPlan, 'import must review its resulting app view');
  assert.equal(review.commitAvailable, true);
  assert.deepEqual(await service.read(), before);
  assert.equal(review.fingerprint, await commandFingerprint(req));
  assert.deepEqual(normalizeCommandRequest(req).currentView, req.currentView);
  const receipt = await service.apply({ ...review, idempotencyKey: 'atomic-import' });
  assert.equal((await page(service, 'prompts')).items.find(row => row.sourceId === 'p').value.original, 'Imported change');
  assert.equal((await page(service, 'prompt-versions')).items.length, 41);
  assert.equal((await page(service, 'evaluations')).items[0].value.output, 'Original result');
  assert.equal((await page(service, 'scratch-notes')).items[0].value.content, 'Keep my note');
  const after = await service.read();
  assert.equal(Object.keys(after.operations).length, Object.keys(before.operations).length + 1);
  for (const [id, object] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], object);
  const transferred = (await inspectTransfer(await createTransfer(after))).state;
  assert.deepEqual(transferred, after);
  const restarted = createCommandService(createMemoryAdapter(transferred));
  assert.deepEqual(await restarted.apply({ ...review, idempotencyKey: 'atomic-import' }), receipt);
  assert.deepEqual(await page(restarted, 'prompts'), await page(service, 'prompts'));
});

for (const commandOwned of [false, true]) test(`changed related record requires a choice, command owned: ${commandOwned}`, async () => {
  const service = await seed();
  if (commandOwned) {
    const current = await page(service, 'evaluations'), row = current.items[0], group = current.groups.find(g => g.selected === row.key);
    const edit = await service.previewRecord({ ...await query(service), action: 'update', domain: 'evaluations',
      groupId: group.id, expectedRecordHash: row.valueHash, changedAt: '2026-10-30T01:00:00.000Z', updates: [{ path: ['output'], value: 'Command change' }] });
    await service.apply({ ...edit, idempotencyKey: 'edit-evaluation' });
  }
  const before = await service.read(), next = content(); next.evaluations[0].output = 'Incoming result';
  const req = await request(service, next), pending = await service.preview(req);
  assert.equal(pending.commitAvailable, false, 'incoming related records cannot silently disappear from review');
  const row = pending.importPlan.recordReview.find(row => row.domain === 'evaluations');
  assert.equal(row.decision, 'choice-required');
  await assert.rejects(service.apply({ ...pending, idempotencyKey: 'unresolved' }), { code: 'UNRESOLVED_IMPORT' });
  assert.deepEqual(await service.read(), before);
  const selected = row.candidates.find(candidate => candidate.valueHash !== row.previousHash && candidate.incoming);
  assert.ok(selected);
  req.currentView.resolutions[row.id] = selected.key;
  const reviewed = await service.preview(req);
  assert.equal(reviewed.commitAvailable, true);
  await service.apply({ ...reviewed, idempotencyKey: 'resolved' });
  assert.deepEqual((await page(service, 'evaluations')).items[0].value, next.evaluations[0]);
  await inspectTransfer(await createTransfer(await service.read()));
});

test('atomic view options reject unsupported use and invalid choices without writes', async () => {
  const service = await seed(), req = await request(service, content()), before = await service.read();
  for (const currentView of [true, null, {}, { resolutions: {}, extra: true }, { resolutions: [] }]) {
    await assert.rejects(service.preview({ ...req, currentView }), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(service.preview({ ...req, mode: 'snapshot' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(service.preview({ ...req, currentView: { resolutions: { ['sha256:' + '0'.repeat(64)]: null } } }), { code: 'INVALID_RESOLUTIONS' });
  const empty = createCommandService(createMemoryAdapter());
  await assert.rejects(empty.preview({ ...req, expectedRevision: null }), { code: 'SELECTION_REQUIRED' });
  assert.deepEqual(await service.read(), before);
});

test('omitting the option preserves archive-only behavior and old request fingerprint', async () => {
  const service = await seed(), req = await input(service, content()), review = await service.preview(req);
  assert.equal(Object.hasOwn(review.importPlan, 'currentViewPlan'), false);
  assert.equal(review.fingerprint, await commandFingerprint(req));
  await service.apply({ ...review, idempotencyKey: 'legacy-import' });
  const inspected = await inspectPackage(pkg(await service.read()));
  assert.equal(inspected.currentView, undefined);
  await inspectTransfer(await createTransfer(await service.read()));
});

test('missing incoming related records require an explicit keep or inactive choice', async () => {
  for (const keep of [true, false]) {
    const service = await seed(), next = content(); delete next.evaluations;
    const req = await request(service, next), pending = await service.preview(req);
    assert.equal(pending.commitAvailable, false);
    const row = pending.importPlan.recordReview.find(row => row.domain === 'evaluations');
    assert.equal(row.decision, 'choice-required');
    req.currentView.resolutions[row.id] = keep ? row.previous : null;
    const review = await service.preview(req); assert.equal(review.commitAvailable, true);
    await service.apply({ ...review, idempotencyKey: 'missing-evaluation' });
    assert.equal((await page(service, 'evaluations')).items.length, keep ? 1 : 0);
    assert.ok((await service.records({ ...await query(service), domain: 'evaluations' })).items.length);
  }
});

test('import retains permanent prompt and related record deletions', async () => {
  const service = await seed(), current = await page(service, 'evaluations'), item = current.items[0];
  const group = current.groups.find(row => row.selected === item.key);
  const deletion = await service.previewRecord({ ...await query(service), action: 'delete', domain: 'evaluations',
    groupId: group.id, expectedRecordHash: item.valueHash, changedAt: '2026-10-30T01:00:00.000Z', confirmPermanentDeletion: true });
  await service.apply({ ...deletion, idempotencyKey: 'deleted-evaluation' });
  const next = content(); next.library[0].original = 'Attempted return'; next.evaluations[0].output = 'Attempted return';
  const req = await request(service, next, { 'pl2-library-deleted:p': '1' }), review = await service.preview(req);
  assert.equal(review.commitAvailable, true);
  const row = review.importPlan.recordReview.find(row => row.domain === 'evaluations');
  assert.equal(row.decision, 'deleted');
  await assert.rejects(service.preview({ ...req, currentView: { resolutions: { [row.id]: row.candidates.find(r => r.incoming).key } } }), { code: 'INVALID_RESOLUTIONS' });
  await service.apply({ ...review, idempotencyKey: 'suppressed-import' });
  assert.equal((await page(service, 'evaluations')).items.length, 0);
  assert.equal((await page(service, 'prompts')).items.length, 0);
  await inspectTransfer(await createTransfer(await service.read()));
});

test('an explicitly inactive command-owned record remains archived through transfer', async () => {
  const service = await seed(), current = await page(service, 'evaluations'), row = current.items[0];
  const group = current.groups.find(group => group.selected === row.key);
  const edit = await service.previewRecord({ ...await query(service), action: 'update', domain: 'evaluations', groupId: group.id,
    expectedRecordHash: row.valueHash, changedAt: '2026-10-30T01:00:00.000Z', updates: [{ path: ['output'], value: 'Command change' }] });
  await service.apply({ ...edit, idempotencyKey: 'owned' });
  const next = content(); next.evaluations[0].output = 'Incoming';
  const req = await request(service, next); req.currentView.resolutions[group.id] = null;
  const review = await service.preview(req);
  assert.equal(review.commitAvailable, true);
  assert.equal(review.importPlan.manifest.recordGroups.find(row => row.id === group.id).inactiveReason, 'import-not-selected');
  await service.apply({ ...review, idempotencyKey: 'inactive' });
  assert.equal((await page(service, 'evaluations')).items.length, 0);
  assert.equal((await service.records({ ...await query(service), domain: 'evaluations' })).items.length, 3);
  await inspectTransfer(await createTransfer(await service.read()));
});

test('preview owns caller inputs, readback owns its result and a competing write invalidates apply', async () => {
  const service = await seed(), req = await request(service, content());
  const pending = service.preview(req);
  req.currentView.resolutions['sha256:' + 'f'.repeat(64)] = null;
  req.sourceInventory.manifestHash = 'sha256:' + 'f'.repeat(64);
  const review = await pending, original = structuredClone(review);
  assert.deepEqual(review.importPlan.currentView, { resolutions: {} });
  review.importPlan.currentViewPlan.selected.length = 0;
  assert.deepEqual(await service.previewRead(review.previewId), original);
  const competing = await service.previewCurrentView(await query(service));
  await service.apply({ ...competing, idempotencyKey: 'competing' });
  const before = await service.read();
  await assert.rejects(service.apply({ ...review, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await service.read(), before);
});

test('forged imported view cannot pass commit inspection', async () => {
  const service = await seed(), review = await service.preview(await request(service, content()));
  await service.apply({ ...review, idempotencyKey: 'valid' });
  const state = await service.read(), commit = state.objects[state.revision].data;
  const plan = structuredClone(state.objects[commit.importPlan].data); plan.currentViewPlan.selected = [];
  const forgedPlan = await makeObject('import-plan', plan), head = await makeObject('commit', { ...commit, importPlan: forgedPlan.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: head.hash, objects: { ...state.objects,
    [forgedPlan.hash]: forgedPlan.object, [head.hash]: head.object } }), { code: 'IMPORT_PLAN_MISMATCH' });
});

test('authenticated folder API and queued response loss reopen the one imported view', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-import-view-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let failure = null;
  const adapter = await createFolderAdapter(directory, { fault: async point => { if (point === failure) throw new Error('Injected interruption'); } });
  const service = await seed(adapter), before = await service.read();
  const next = content(); next.library[0].original = 'Folder import';
  const req = await request(service, next), direct = await service.preview(req);
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...direct, idempotencyKey: 'interrupted' }));
    assert.deepEqual(await service.read(), before);
  }
  failure = null;
  const token = 'synthetic-import-view-credential-'.repeat(2);
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const baseUrl = await api.listen(); t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => token });
  const review = await transport.preview(req); assert.deepEqual(review.importPlan, direct.importPlan);
  let entry = null;
  const store = { read: async () => structuredClone(entry), write: async (value, expected) => {
    assert.equal(entry?.version ?? null, expected); entry = structuredClone(value); return structuredClone(entry);
  } };
  const outbox = createCommandOutbox(store); await outbox.enqueue({ request: req, review, operationId: 'queued-import' });
  await assert.rejects(outbox.replay('lib', 'queued-import', { ...transport, apply: async input => {
    await transport.apply(input); throw new Error('Lost response');
  } }), /Lost response/);
  const recovered = await createCommandOutbox(store).replay('lib', 'queued-import', transport);
  assert.equal(recovered.state, 'committed');
  const after = await service.read(), reopened = createCommandService(await createFolderAdapter(directory));
  assert.equal(Object.keys(after.operations).length, Object.keys(before.operations).length + 1);
  assert.deepEqual(await reopened.read(), after);
  assert.equal((await page(reopened, 'prompts')).items[0].value.original, 'Folder import');
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const denied = await fetch(baseUrl + '/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
  assert.equal(denied.status, 401);
});
