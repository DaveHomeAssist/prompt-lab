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

const pkgFor = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const entry = (id, original, extra = {}) => ({ id, title: id, original, ...extra });
const firstContent = () => ({ library: [entry('keep', 'old keep', { versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, content: `historical ${n}`, unknown: true })) }), entry('erased', 'old erased')],
  runs: [{ id: 'run', promptId: 'erased', output: 'preserved output' }], scratch: { pads: [{ id: 'note', content: 'retained', linkedPromptId: 'erased' }] },
  packs: { unknown: { bytes: 'data:application/octet-stream;base64,AA==' } }, future: { keep: [1, null, true] } });
async function inputFor(content, { sourceIdentity = 'origin-a', markers = {}, surface = 'web', journal, unbound = false } = {}) {
  const input = { libraryId: 'lib', sourceText: JSON.stringify(content), mode: 'import' };
  if (unbound) return input;
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...markers };
  input.sourceInventory = await captureSourceInventory({ surface, sourceIdentity,
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async ({ store }) => {
      if (store === 'journal' && journal === 'unavailable') throw new Error('private detail');
      return store === 'journal' && journal ? { state: 'present', records: journal } : { state: 'absent', reason: 'Synthetic store is absent.' };
    }, archives: { reviewed: true, records: [] }, capturedAt: '2026-10-29T00:00:00Z' });
  return input;
}
async function publish(service, input, key, action = 'replace') {
  input = { ...input, expectedRevision: (await service.read()).revision };
  let preview = await service.preview(input);
  const unresolved = preview.importPlan?.rows.filter(row => !row.choice) ?? [];
  if (unresolved.length) preview = await service.preview({ ...input, resolutions: Object.fromEntries(unresolved.map(row => [row.member,
    { action, ...(action === 'replace' ? { target: row.matches[0] } : {}) }])) });
  return service.apply({ ...preview, idempotencyKey: key });
}
async function seed(service) {
  const first = await publish(service, await inputFor(firstContent()), 'first');
  const second = await publish(service, await inputFor({ library: [entry('keep', 'new keep'), entry('new', 'new only')] },
    { markers: { 'pl2-library-deleted:erased': '1' } }), 'second');
  return { first, second };
}
async function inspect(service) { return inspectPackage(pkgFor(await service.read())); }
function activeRows(state, manifest) {
  const nodes = new Map(manifest.nodes.map(node => [node.key, node]));
  return manifest.groups.filter(group => group.selected !== null).map(group => {
    const node = nodes.get(group.selected);
    return node.path.reduce((value, key) => value[key], state.objects[node.source].data);
  });
}

test('reviewed restore selects the checkpoint, suppresses deletion and retains the complete graph', async () => {
  const service = createCommandService(createMemoryAdapter()), { first, second } = await seed(service);
  const before = await service.read();
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision });
  assert.equal(preview.commitAvailable, true); assert.equal(preview.mode, 'restore');
  assert.equal(preview.restorePlan.counts.selectedBefore, 2);
  assert.equal(preview.restorePlan.counts.selectedAfter, 1);
  assert.equal(preview.restorePlan.deletionReview.suppressed.length, 1);
  assert.equal(preview.restorePlan.deletionReview.suppressed[0].reasons[0].sourceId, 'erased');
  assert.deepEqual(await service.read(), before);
  const receipt = await service.apply({ ...preview, idempotencyKey: 'restore' });
  assert.equal(receipt.checkpointId, second.revision); assert.equal(receipt.restoredCheckpointId, first.revision);
  assert.equal(receipt.parentRevision, second.revision); assert.notEqual(receipt.revision, first.revision);
  const after = await service.read(), verified = await inspect(service);
  assert.deepEqual(activeRows(after, verified.manifest).map(row => row.original), ['old keep']);
  assert.equal(verified.manifest.nodes.filter(node => node.kind === 'version').length, 41);
  assert.equal(verified.manifest.groups.filter(group => group.selected === null).length, 2);
  assert.ok(verified.manifest.references.some(link => link.sourceId === 'erased' && link.reason === 'prompt-not-selected'));
  for (const [id, object] of Object.entries(before.objects)) assert.deepEqual(after.objects[id], object);
  for (const [id, operation] of Object.entries(before.operations)) assert.deepEqual(after.operations[id], operation);
  assert.deepEqual(after.checkpoints, [first.revision, second.revision]);
  const reconstructed = await inspectTransfer(await createTransfer(after));
  assert.deepEqual(reconstructed.state, after);
  const restarted = createCommandService(createMemoryAdapter(reconstructed.state));
  assert.deepEqual(await restarted.apply({ ...preview, idempotencyKey: 'restore' }), receipt);
  const backups = await restarted.backups({ libraryId: 'lib', expectedRevision: receipt.revision });
  assert.equal(backups.items[1].stateKind, 'library-state');
});

test('later imports cannot reselect a deleted group and unbound imports cannot bypass its policy', async () => {
  const service = createCommandService(createMemoryAdapter()), { first, second } = await seed(service);
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision });
  const restored = await service.apply({ ...preview, idempotencyKey: 'restore' });
  await publish(service, await inputFor({ library: [entry('erased', 'attempted return')] }), 'later');
  const state = await service.read(), verified = await inspect(service);
  assert.equal(activeRows(state, verified.manifest).some(row => row.id === 'erased'), false);
  assert.equal(verified.manifest.groups.find(group => group.inactiveReason === 'permanent-deletion').members.length, 2);
  const unbound = await service.preview({ ...await inputFor({ library: [entry('external', 'unbound')] }, { unbound: true }), expectedRevision: state.revision });
  assert.equal(unbound.commitAvailable, false);
  assert.ok(unbound.importPlan.deletionReview.blocked.some(issue => issue.code === 'UNBOUND_SOURCE'));
  await assert.rejects(service.apply({ ...unbound, idempotencyKey: 'bypass' }), { code: 'DELETION_EVIDENCE_UNKNOWN' });
  assert.deepEqual(await service.read(), state);
  const again = await service.previewRestore({ libraryId: 'lib', expectedRevision: state.revision, checkpointId: restored.revision });
  await service.apply({ ...again, idempotencyKey: 'restore-restored' });
  await inspectTransfer(await createTransfer(await service.read()));
});

test('same-ID Keep groups from distinct origins retain independent deletion scopes', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, await inputFor({ library: [entry('shared', 'origin A')] }), 'a');
  const checkpoint = await publish(service, await inputFor({ library: [entry('shared', 'origin B')] }, { sourceIdentity: 'origin-b' }), 'b', 'keep');
  const current = await publish(service, await inputFor({ library: [] }, { markers: { 'pl2-library-deleted:shared': '1' } }), 'erase-a');
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: current.revision, checkpointId: checkpoint.revision });
  await service.apply({ ...preview, idempotencyKey: 'restore' });
  const state = await service.read(), verified = await inspect(service);
  assert.deepEqual(activeRows(state, verified.manifest).map(row => row.original), ['origin B']);
});

test('a permanent marker on an older alias suppresses the logical replacement group', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, await inputFor({ library: [entry('old-id', 'first', { title: 'same title' })] }), 'a');
  const checkpoint = await publish(service, await inputFor({ library: [entry('new-id', 'replacement', { title: 'same title' })] }, { sourceIdentity: 'origin-b' }), 'b');
  const current = await publish(service, await inputFor({ library: [] }, { markers: { 'pl2-library-deleted:old-id': '1' } }), 'erase');
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: current.revision, checkpointId: checkpoint.revision });
  assert.equal(preview.restorePlan.counts.selectedAfter, 0);
  assert.ok(preview.restorePlan.deletionReview.suppressed[0].reasons.some(reason => reason.sourceId === 'old-id'));
  await service.apply({ ...preview, idempotencyKey: 'restore' });
});

test('clear generations are monotonic and suppress checkpoint records without erasing their history', async () => {
  const service = createCommandService(createMemoryAdapter());
  const first = await publish(service, await inputFor(firstContent()), 'first');
  const generation = '0000000000000009:abc-123';
  await publish(service, await inputFor({ library: [entry('new-generation', 'current', { metadata: { libraryGeneration: generation } })] },
    { markers: { [`pl2-library-clear:${generation}`]: '1' } }), 'clear');
  const latest = await publish(service, await inputFor({ library: [] }, { markers: { 'pl2-library-clear:0000000000000002:abc': '1' } }), 'older-marker');
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: latest.revision, checkpointId: first.revision });
  assert.equal(preview.restorePlan.counts.selectedAfter, 0);
  assert.equal(preview.restorePlan.deletionReview.evidence.scopes[0].generation, generation);
  assert.ok(preview.restorePlan.deletionReview.suppressed.every(item => item.reasons.every(reason => reason.code === 'CLEARED_GENERATION')));
  await service.apply({ ...preview, idempotencyKey: 'restore' });
  assert.equal((await inspect(service)).manifest.nodes.filter(node => node.kind === 'version').length, 41);
});

for (const scenario of ['unbound', 'unavailable', 'malformed', 'ambiguous', 'invalid-generation']) {
  test(`restore refuses ${scenario} evidence without treating it as empty`, async () => {
    const service = createCommandService(createMemoryAdapter());
    const options = scenario === 'unbound' ? { unbound: true } : { surface: 'desktop' };
    const content = scenario === 'invalid-generation' ? { library: [entry('p', 'p', { metadata: { libraryGeneration: 42 } })] } : firstContent();
    const first = await publish(service, { ...await inputFor(content, options), mode: 'snapshot' }, 'first');
    const secondOptions = scenario === 'unavailable' ? { surface: 'desktop', journal: 'unavailable' }
      : scenario === 'malformed' ? { markers: { 'pl2-library-deleted-batch:broken': '{bad' } }
        : scenario === 'ambiguous' ? { sourceIdentity: 'origin-b' } : {};
    const secondContent = scenario === 'ambiguous' ? content : { library: [] };
    const current = await publish(service, { ...await inputFor(secondContent, secondOptions), mode: 'snapshot' }, 'second');
    const before = await service.read();
    const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: current.revision, checkpointId: first.revision });
    assert.equal(preview.commitAvailable, false); assert.ok(preview.restorePlan.deletionReview.blocked.length);
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'unsafe' }), { code: 'DELETION_EVIDENCE_UNKNOWN' });
    assert.deepEqual(await service.read(), before);
  });
}

test('restore rejects stale or expired reviews and unsupported bypass options', async () => {
  let clock = 0;
  const service = createCommandService(createMemoryAdapter(), { now: () => clock, previewLifetimeMs: 10 });
  const { first, second } = await seed(service);
  const input = { libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision };
  await assert.rejects(service.previewRestore({ ...input, reintroduceDeleted: true }), { code: 'INVALID_REQUEST' });
  const expired = await service.previewRestore(input); clock = 11;
  await assert.rejects(service.apply({ ...expired, idempotencyKey: 'expired' }), { code: 'PREVIEW_EXPIRED' });
  const stale = await service.previewRestore(input);
  await publish(service, await inputFor({ library: [entry('another', 'another')] }), 'another');
  await assert.rejects(service.previewRead(stale.previewId), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.apply({ ...stale, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
});

test('false-like malformed generations cannot masquerade as an absent legacy generation', async () => {
  for (const generation of [0, false, '', [], {}]) {
    const service = createCommandService(createMemoryAdapter());
    const preview = await service.preview({ ...await inputFor({ library: [entry('p', 'p', { metadata: { libraryGeneration: generation } })] }), expectedRevision: null });
    assert.equal(preview.commitAvailable, false);
    assert.ok(preview.importPlan.deletionReview.blocked.some(issue => issue.code === 'INVALID_RECORD_GENERATION'));
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'invalid' }), { code: 'DELETION_EVIDENCE_UNKNOWN' });
    assert.equal((await service.read()).revision, null);
  }
});

test('a retained checkpoint on an unrelated branch cannot be restored over current ancestry', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const { second } = await seed(service);
  const branch = createCommandService(createMemoryAdapter());
  const foreign = await publish(branch, await inputFor({ library: [entry('branch', 'branch')] }), 'branch');
  const foreignState = await branch.read();
  await adapter.transact(state => { Object.assign(state.objects, foreignState.objects); Object.assign(state.operations, foreignState.operations); state.checkpoints.push(foreign.revision); });
  await assert.rejects(service.previewRestore({ libraryId: 'lib', expectedRevision: second.revision, checkpointId: foreign.revision }), { code: 'INVALID_CHECKPOINT' });
});

test('rehashing a restore plan cannot turn a suppressed row back into an active selection', async () => {
  const service = createCommandService(createMemoryAdapter()), { first, second } = await seed(service);
  const preview = await service.previewRestore({ libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision });
  await service.apply({ ...preview, idempotencyKey: 'restore' });
  const state = await service.read(), commit = state.objects[state.revision].data;
  const plan = structuredClone(state.objects[commit.restorePlan].data);
  const group = plan.manifest.groups.find(group => group.inactiveReason === 'permanent-deletion');
  group.selected = group.retainedSelection;
  const { fingerprint, ...unsigned } = plan; plan.fingerprint = await hash(unsigned);
  const planObject = await makeObject('restore-plan', plan), manifest = await makeObject('library-state', plan.manifest);
  const altered = await makeObject('commit', { ...commit, restorePlan: planObject.hash, state: manifest.hash });
  const objects = { ...state.objects, [planObject.hash]: planObject.object, [manifest.hash]: manifest.object, [altered.hash]: altered.object };
  await assert.rejects(inspectPackage({ ...pkgFor(state), head: altered.hash, objects }), { code: 'RESTORE_PLAN_MISMATCH' });
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`restore interruption at ${point} preserves the old head or the complete new receipt`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'promptlab-restore-')); t.after(() => rm(dir, { recursive: true, force: true }));
    let fail = false;
    const service = createCommandService(await createFolderAdapter(dir, { fault: async phase => { if (fail && phase === point) throw new Error('injected restore interruption'); } }));
    const { first, second } = await seed(service), before = await service.read();
    const input = { libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision };
    const preview = await service.previewRestore(input); fail = true;
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'restore' }), /injected restore interruption/);
    const reopened = createCommandService(await createFolderAdapter(dir));
    if (point === 'after-publication') assert.equal((await reopened.apply({ ...preview, idempotencyKey: 'restore' })).checkpointId, second.revision);
    else {
      assert.deepEqual(await reopened.read(), before);
      await reopened.apply({ ...await reopened.previewRestore(input), idempotencyKey: 'restore' });
    }
    const state = await reopened.read();
    assert.equal(Object.keys(state.operations).length, 3);
    assert.deepEqual(activeRows(state, (await inspect(reopened)).manifest).map(row => row.original), ['old keep']);
    await inspectTransfer(await createTransfer(state));
  });
}

test('loopback restore reviews apply through the normal commit route and enforce scopes', async t => {
  const token = 'synthetic-write-token'.repeat(3), read = 'synthetic-read-token'.repeat(3), adapter = createMemoryAdapter();
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 },
    { token: read, scopes: ['read'], expiresAt: Date.now() + 60_000 }] });
  const base = await api.listen(); t.after(() => api.close());
  const { first, second } = await seed(api.service);
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const input = { libraryId: 'lib', expectedRevision: second.revision, checkpointId: first.revision };
  assert.equal((await post('/v1/library/restores', input, { Authorization: `Bearer ${read}` })).status, 403);
  assert.equal((await post('/v1/library/restores', { ...input, libraryId: 'other' })).status, 409);
  const result = await post('/v1/library/restores', input); assert.equal(result.status, 201); const preview = await result.json();
  const saved = await post('/v1/library/commits', preview, { 'Idempotency-Key': 'http-restore' }); assert.equal(saved.status, 201); const receipt = await saved.json();
  assert.equal(receipt.restoredCheckpointId, first.revision);
  assert.deepEqual(await (await post('/v1/library/commits', preview, { 'Idempotency-Key': 'http-restore' })).json(), receipt);
  const snapshot = await fetch(base + '/v1/library/snapshot?revision=' + encodeURIComponent(receipt.revision), { headers: { Authorization: `Bearer ${read}` } });
  assert.equal((await snapshot.json()).stateKind, 'library-state');
});
