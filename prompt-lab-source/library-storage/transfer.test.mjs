import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryAdapter, createCommandService, makeObject, hash } from './contract.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { writeBackup, readBackup } from './backup-file.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';

async function fixture(adapter = createMemoryAdapter()) {
  const service = createCommandService(adapter), requests = [], receipts = [];
  for (const [index, count] of [41, 43].entries()) {
    const workspace = { library: [{ id: 'same', original: `source${index}`, versions: Array.from({ length: count }, (_, i) => ({ id: `v${i}`, original: `history${i}`, future: { index } })) }],
      runs: [{ id: 'run', promptId: 'same', promptVersionId: 'v0' }], testCases: [{ id: 'case', promptId: 'same' }],
      scratch: { pads: [{ id: 'pad', content: 'notes', linkedPromptId: 'same' }] }, trash: [{ id: 'trash', original: 'preserved' }],
      markers: { deleted: ['gone'], generation: '0' }, packs: { raw: { id: 'pack', future: true } }, assets: { bytes: 'AAE=' }, future: [null, false, 0] };
    const preview = await service.preview({ libraryId: 'portable', expectedRevision: (await service.read()).revision, mode: 'import', sourceText: JSON.stringify(workspace), resolutions: index ? { same: { action: 'replace', existingId: 'same' } } : {} });
    const request = { ...preview, idempotencyKey: index ? '__proto__' : 'first' };
    requests.push(request); receipts.push(await service.apply(request));
  }
  return { adapter, service, requests, receipts, state: await service.read() };
}

async function directories(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'promptlab-transfer-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const live = join(root, 'live'); await mkdir(live);
  return { root, live, target: join(root, 'independent.plbackup') };
}

test('complete transfer retains all raw objects, receipts, checkpoints and unknown library metadata', async () => {
  const { state, requests, receipts } = await fixture();
  const extra = await makeObject('future-content', { unknown: [1, false, null] });
  const future = { ...extra.object, schemaVersion: 2, futureEnvelope: { preserved: true } };
  state.objects[await hash(future)] = future;
  state.futureLibraryMetadata = { preserved: true };
  const transfer = await createTransfer(state);
  const checked = await inspectTransfer(transfer, { expectedManifestHash: transfer.manifestHash });
  assert.deepEqual(checked.state, state);
  assert.equal(checked.counts.commits, 2);
  assert.equal(checked.counts.operations, 2);
  assert.equal(checked.counts.checkpoints, 1);
  assert.equal(checked.state.objects[receipts[1].stateHash].data.nodes.filter(node => node.kind === 'version').length, 84);
  const reopened = createCommandService(createMemoryAdapter(checked.state));
  assert.deepEqual(await reopened.apply(requests[1]), receipts[1]);
  assert.deepEqual(await reopened.operation('first'), receipts[0]);
  assert.deepEqual(await createTransfer(checked.state), transfer);
});

test('transfer input and inspection own their data before asynchronous hashing', async () => {
  const { state } = await fixture();
  const expected = structuredClone(state), pending = createTransfer(state);
  state.checkpoints.length = 0;
  const transfer = await pending;
  const read = inspectTransfer(transfer);
  transfer.metadata.libraryId = 'mutated';
  transfer.objects = {};
  assert.deepEqual((await read).state, expected);
});

test('transfers from immutable folder snapshots return independently mutable object content', async t => {
  const { live } = await directories(t), adapter = await createFolderAdapter(live);
  const { state } = await fixture(adapter), snapshot = await adapter.readSnapshot();
  const transfer = await createTransfer(snapshot);
  const id = Object.keys(transfer.objects).find(key => transfer.objects[key].kind === 'workspace');
  transfer.objects[id].data.library[0].original = 'Caller edit';
  transfer.operations.first.verified = false;
  assert.deepEqual(await adapter.read(), state);
  assert.deepEqual((await createTransfer(snapshot)).objects, state.objects);
  await assert.rejects(inspectTransfer(transfer));
});

test('missing receipts, missing checkpoints and forged receipt fields cannot produce a valid transfer', async () => {
  const { state } = await fixture();
  const mutations = [
    value => { delete value.operations.first; },
    value => { value.checkpoints.length = 0; },
    value => { value.operations.first.fingerprint = 'sha256:' + 'f'.repeat(64); },
    value => { value.operations.first.operation = 'snapshot'; },
    value => { value.operations.first.stateHash = value.revision; },
    value => { value.operations.first.counts.historyRecords = 0; },
    value => { value.checkpoints.push(value.checkpoints[0]); },
  ];
  for (const mutate of mutations) {
    const altered = structuredClone(state); mutate(altered);
    await assert.rejects(createTransfer(altered), { code: 'INVALID_TRANSFER' });
  }
  await assert.rejects(createTransfer({ ...state, credentials: {} }), { code: 'EXCLUDED_STORE' });
  const invalid = await makeObject('', { invalid: 'kind' });
  await assert.rejects(createTransfer({ ...state, objects: { ...state.objects, [invalid.hash]: invalid.object } }), { code: 'INVALID_TRANSFER' });
  for (const kind of ['source', 'workspace']) {
    const workspace = { library: [], settings: {} };
    const extra = await makeObject(kind, kind === 'source' ? JSON.stringify(workspace) : workspace);
    await assert.rejects(createTransfer({ ...state, objects: { ...state.objects, [extra.hash]: extra.object } }), { code: 'EXCLUDED_STORE' });
  }
});

test('missing or extra objects, changed manifests and wrong reviewed hashes reject transfer inspection', async () => {
  const { state } = await fixture();
  const original = await createTransfer(state);
  const missing = structuredClone(original);
  delete missing.objects[missing.manifest.objects[0].hash];
  await assert.rejects(inspectTransfer(missing));
  const extra = await makeObject('future-content', { preserved: true });
  const expanded = structuredClone(original); expanded.objects[extra.hash] = extra.object;
  await assert.rejects(inspectTransfer(expanded), { code: 'INVALID_TRANSFER' });
  const changed = structuredClone(original); changed.metadata.future = 'unreviewed';
  await assert.rejects(inspectTransfer(changed), { code: 'INVALID_TRANSFER' });
  await assert.rejects(inspectTransfer(original, { expectedManifestHash: 'sha256:' + '0'.repeat(64) }), { code: 'TRANSFER_CHANGED' });
});

test('legacy snapshot receipt fingerprints remain recoverable without rewriting prior receipts', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const input = { libraryId: 'legacy', expectedRevision: null, sourceText: '{"library":[]}', resolutions: {} };
  const preview = await service.preview(input);
  await service.apply({ ...preview, idempotencyKey: 'legacy-op' });
  const state = adapter.read(), receipt = state.operations['legacy-op'];
  for (const key of ['operation', 'sourceHash', 'stateHash', 'counts']) delete receipt[key];
  receipt.fingerprint = await hash(input);
  const transfer = await createTransfer(state);
  assert.deepEqual((await inspectTransfer(transfer)).state.operations['legacy-op'], receipt);
});

test('command transfer requires the library and current revision, and publishes no state', async () => {
  const { service, state } = await fixture();
  await assert.rejects(service.transfer({ libraryId: 'other', expectedRevision: state.revision }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(service.transfer({ libraryId: state.libraryId, expectedRevision: null }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual((await inspectTransfer(await service.transfer({ libraryId: state.libraryId, expectedRevision: state.revision }))).state, state);
  assert.deepEqual(await service.read(), state);
  let reads = 0;
  const changing = createCommandService({ read: async () => (++reads === 1 ? state : { ...state, revision: 'changed' }) });
  await assert.rejects(changing.transfer({ libraryId: state.libraryId, expectedRevision: state.revision }), { code: 'REVISION_CONFLICT' });
});

test('independent backup reopens the complete graph and reconstructs a disposable folder with replayable receipts', async t => {
  const { live, target, root } = await directories(t);
  const { service, state, requests, receipts } = await fixture(await createFolderAdapter(live));
  const transfer = await service.transfer({ libraryId: state.libraryId, expectedRevision: state.revision });
  const receipt = await writeBackup(target, transfer, { liveDirectory: live });
  assert.equal(receipt.verified, true); assert.equal(receipt.outsideLiveDirectory, true);
  const recovered = await readBackup(target, { expectedManifestHash: receipt.manifestHash, expectedFileHash: receipt.fileSha256 });
  assert.equal(receipt.bytes, (await readFile(target)).length);
  assert.deepEqual(recovered.state, state);
  const destination = await createFolderAdapter(join(root, 'disposable-reconstruction'));
  // Adapter reconstruction exercises transport parity only. No public restore
  // command is exposed until reviewed deletion-aware restore is implemented.
  await destination.transact(candidate => { Object.assign(candidate, recovered.state); return { restored: true }; });
  const restarted = createCommandService(await createFolderAdapter(join(root, 'disposable-reconstruction')));
  assert.deepEqual(await restarted.read(), state);
  assert.deepEqual(await restarted.apply(requests[1]), receipts[1]);
  assert.deepEqual(await service.read(), state);
  assert.equal((await readdir(root)).filter(name => name.endsWith('.pending')).length, 0);
});

test('backup destination refuses overwrite, live-folder paths, excluded sync roots and symbolic links', async t => {
  const { live, target, root } = await directories(t);
  const { state } = await fixture(), transfer = await createTransfer(state);
  await writeFile(target, 'original backup');
  await assert.rejects(writeBackup(target, transfer, { liveDirectory: live }), { code: 'EEXIST' });
  assert.equal(await readFile(target, 'utf8'), 'original backup');
  await assert.rejects(writeBackup(join(live, 'inside.plbackup'), transfer, { liveDirectory: live }), { code: 'INVALID_BACKUP_LOCATION' });
  await assert.rejects(writeBackup(join(root, 'sync.plbackup'), transfer, { liveDirectory: live, excludedDirectories: [root] }), { code: 'INVALID_BACKUP_LOCATION' });
  await symlink(root, join(root, 'alias'));
  await assert.rejects(writeBackup(join(root, 'alias', 'unsafe.plbackup'), transfer, { liveDirectory: live }), { code: 'UNSAFE_DIRECTORY' });
  await symlink(target, join(root, 'linked.plbackup'));
  await assert.rejects(readBackup(join(root, 'linked.plbackup')), { code: 'UNSAFE_DIRECTORY' });
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`backup interruption at ${point} preserves source and never acknowledges an incomplete archive`, async t => {
    const { live, target, root } = await directories(t);
    const { service, state } = await fixture(await createFolderAdapter(live));
    const transfer = await createTransfer(state);
    await assert.rejects(writeBackup(target, transfer, { liveDirectory: live, fault: phase => { if (phase === point) throw new Error('backup interruption'); } }), /backup interruption/);
    assert.deepEqual(await service.read(), state);
    assert.equal((await readdir(root)).filter(name => name.endsWith('.pending')).length, 1);
    if (point === 'after-publication') assert.deepEqual((await readBackup(target, { expectedManifestHash: transfer.manifestHash })).state, state);
    else await assert.rejects(readFile(target), { code: 'ENOENT' });
    const retry = join(root, 'retry.plbackup');
    assert.equal((await writeBackup(retry, transfer, { liveDirectory: live })).verified, true);
  });
}

test('truncation, duplicate records, unlisted fields and changed receipt content reject file readback', async t => {
  const { live, target, root } = await directories(t);
  const { state } = await fixture(), transfer = await createTransfer(state);
  await writeBackup(target, transfer, { liveDirectory: live });
  const bytes = await readFile(target, 'utf8');
  const lines = bytes.trimEnd().split('\n');
  const variants = [bytes.slice(0, -2), lines.slice(0, -1).join('\n') + '\n', [...lines.slice(0, -1), lines[3], lines.at(-1)].join('\n') + '\n',
    lines.map((line, i) => i === 1 ? JSON.stringify({ ...JSON.parse(line), ignored: 'unbound' }) : line).join('\n') + '\n',
    lines.map(line => { const record = JSON.parse(line); if (record.type === 'operation') record.value.fingerprint = 'sha256:' + 'f'.repeat(64); return JSON.stringify(record); }).join('\n') + '\n'];
  for (const [i, body] of variants.entries()) {
    const path = join(root, `invalid${i}.plbackup`); await writeFile(path, body);
    await assert.rejects(readBackup(path, { expectedManifestHash: transfer.manifestHash }));
  }
});

test('configured backup limits reject before publication or reconstruction without trimming the source', async t => {
  const { live, target, root } = await directories(t);
  const { state } = await fixture(), transfer = await createTransfer(state);
  await assert.rejects(writeBackup(target, transfer, { liveDirectory: live, maxBytes: 1 }), { code: 'PAYLOAD_TOO_LARGE' });
  await assert.rejects(readFile(target), { code: 'ENOENT' });
  const complete = join(root, 'complete.plbackup');
  const receipt = await writeBackup(complete, transfer, { liveDirectory: live });
  await assert.rejects(readBackup(complete, { maxBytes: receipt.bytes - 1 }), { code: 'PAYLOAD_TOO_LARGE' });
  await assert.rejects(readBackup(complete, { expectedFileHash: '0'.repeat(64) }), { code: 'TRANSFER_CHANGED' });
  await assert.rejects(readBackup(complete, { maxBytes: Infinity }), { code: 'INVALID_REQUEST' });
  assert.deepEqual((await readBackup(complete)).state, state);
});
