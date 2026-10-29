import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, rename, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createCommandService, createMemoryAdapter, inspectPackage, readObject, canonical, hash, MAX_BYTES, FORMAT, VERSION } from './contract.mjs';

const input = { libraryId: 'test-library', expectedRevision: null, sourceText: JSON.stringify({ library: [{ id: 'p1', versions: Array.from({ length: 40 }, (_, id) => ({ id, content: 'keep' })) }], unknown: { nested: [1, 2] } }) };
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'promptlab-disposable-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const apply = (service, preview) => service.apply({ ...preview, idempotencyKey: 'first' });

test('folder close/reopen preserves source, history and acknowledged operation', async t => {
  const dir = await fixture(t);
  const service = createCommandService(await createFolderAdapter(dir));
  const preview = await service.preview(input), receipt = await apply(service, preview);
  const reopened = await createFolderAdapter(dir), restarted = createCommandService(reopened);
  assert.deepEqual(await apply(restarted, preview), receipt);
  const state = await reopened.read();
  const inspected = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
  assert.equal(inspected.sourceText, input.sourceText);
  assert.deepEqual(inspected.workspace, JSON.parse(input.sourceText));
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`interruption at ${point} preserves committed state and safe retry`, async t => {
    const dir = await fixture(t);
    const service = createCommandService(await createFolderAdapter(dir, { fault: async phase => { if (phase === point) throw new Error('injected interruption'); } }));
    const preview = await service.preview(input);
    await assert.rejects(apply(service, preview), /injected interruption/);
    const adapter = await createFolderAdapter(dir), restarted = createCommandService(adapter);
    if (point === 'after-publication') {
      assert.equal((await restarted.operation('first')).state, 'committed');
      await apply(restarted, preview);
    } else {
      assert.equal((await adapter.read()).revision, null);
      const retry = await restarted.preview(input);
      await apply(restarted, retry);
    }
    assert.equal(Object.keys((await adapter.read()).operations).length, 1);
  });
}

test('corrupt cloud file fails read without silently selecting older data', async t => {
  const dir = await fixture(t), service = createCommandService(await createFolderAdapter(dir));
  await apply(service, await service.preview(input));
  const journal = join(dir, 'transactions'), name = (await readdir(journal)).find(name => name.endsWith('.json'));
  const before = await readFile(join(journal, name), 'utf8');
  await writeFile(join(journal, name), before.replace('test-library', 'lost-library'));
  await assert.rejects((await createFolderAdapter(dir)).read(), { code: 'HASH_MISMATCH' });
});

test('cloud conflict copies fail closed and are preserved for review', async t => {
  const dir = await fixture(t), service = createCommandService(await createFolderAdapter(dir));
  await apply(service, await service.preview(input));
  const journal = join(dir, 'transactions'), name = (await readdir(journal))[0];
  await rename(join(journal, name), join(journal, name.replace('.json', ' conflict.json')));
  await assert.rejects((await createFolderAdapter(dir)).read(), { code: 'CLOUD_CONFLICT' });
  assert.equal((await readdir(journal)).length, 1);
});

test('warm folder reads reject changed historical bytes even at the same size and timestamp', async t => {
  const dir = await fixture(t), adapter = await createFolderAdapter(dir), service = createCommandService(adapter);
  await apply(service, await service.preview(input));
  const before = await adapter.read(), journal = join(dir, 'transactions');
  const file = join(journal, (await readdir(journal))[0]), text = await readFile(file, 'utf8'), metadata = await stat(file);
  const next = await service.preview({ ...input, expectedRevision: before.revision });
  await service.apply({ ...next, idempotencyKey: 'second' });
  await adapter.read();
  await writeFile(file, text.replace('test-library', 'lost-library')); await utimes(file, metadata.atime, metadata.mtime);
  await assert.rejects(adapter.read(), { code: 'HASH_MISMATCH' });
  await writeFile(file, text);
  assert.equal(Object.keys((await adapter.read()).operations).length, 2);
  await rename(file, file + '.missing');
  await assert.rejects(adapter.read(), { code: 'MISSING_OBJECT' });
});

test('warm folder reads see external commits and never share mutable state with callers', async t => {
  const dir = await fixture(t), adapter = await createFolderAdapter(dir), service = createCommandService(adapter);
  await apply(service, await service.preview(input));
  const before = await adapter.read(), original = structuredClone(before);
  before.objects = {}; before.operations.first.verified = false; before.checkpoints.push('caller edit');
  assert.deepEqual(await adapter.read(), original);
  const external = createCommandService(await createFolderAdapter(dir));
  const next = await external.preview({ ...input, expectedRevision: original.revision });
  const receipt = await external.apply({ ...next, idempotencyKey: 'external' });
  assert.equal((await adapter.read()).revision, receipt.revision);
  assert.deepEqual((await adapter.read()).operations.external, receipt);
});

test('internal folder snapshots retain immutable proofs while public reads and receipts stay independent', async t => {
  const dir = await fixture(t), adapter = await createFolderAdapter(dir), service = createCommandService(adapter);
  const receipt = await apply(service, await service.preview(input));
  const snapshot = await adapter.readSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.throws(() => { snapshot.operations.first.verified = false; }, TypeError);
  const commit = snapshot.objects[snapshot.revision].data;
  assert.throws(() => { snapshot.objects[commit.state].data.unknown.nested[0] = 99; }, TypeError);
  const original = globalThis.crypto.subtle.digest;
  let digests = 0;
  globalThis.crypto.subtle.digest = function (...args) { digests++; return original.apply(this, args); };
  try {
    const next = await adapter.readSnapshot();
    await readObject(next.objects, next.revision, 'commit');
    await readObject(next.objects, commit.state, 'workspace');
    assert.equal(digests, 0, 'Fresh unchanged file bytes retain owned canonical hash proofs');
  } finally { globalThis.crypto.subtle.digest = original; }
  const publicRead = await service.read();
  publicRead.objects[commit.state].data.unknown.nested[0] = 99;
  const operation = await service.operation('first'); operation.verified = false;
  assert.deepEqual(await service.operation('first'), receipt);
  assert.equal((await service.read()).objects[commit.state].data.unknown.nested[0], 1);
});

test('internal command reads still reject changed object bytes after a warm snapshot', async t => {
  const dir = await fixture(t), adapter = await createFolderAdapter(dir), service = createCommandService(adapter);
  const receipt = await apply(service, await service.preview(input));
  await service.records({ libraryId: input.libraryId, expectedRevision: receipt.revision });
  const file = join(dir, 'objects', receipt.stateHash.slice(7) + '.json');
  const original = await readFile(file, 'utf8'), metadata = await stat(file);
  await writeFile(file, original.replace('keep', 'loss'));
  await utimes(file, metadata.atime, metadata.mtime);
  await assert.rejects(service.records({ libraryId: input.libraryId, expectedRevision: receipt.revision }), { code: 'HASH_MISMATCH' });
  await writeFile(file, original);
  assert.equal((await service.read()).revision, receipt.revision);
});

test('journals above the snapshot cache budget retain verification without trusting stale file metadata', async t => {
  const dir = await fixture(t), journal = join(dir, 'transactions'); await mkdir(journal);
  const service = createCommandService(createMemoryAdapter());
  const sourceText = JSON.stringify({ library: [{ id: 'large', original: 'Keep' }], future: 'x'.repeat(3_500_000) });
  let revision = null, parent = null, totalBytes = 0, oldest;
  for (let i = 0; i < 11; i++) {
    const review = await service.preview({ libraryId: 'large-history', expectedRevision: revision, sourceText });
    revision = (await service.apply({ ...review, idempotencyKey: `snapshot-${i}` })).revision;
    const row = { schemaVersion: 2, parents: parent ? [parent] : [], state: await service.read() };
    parent = await hash(row);
    const contents = canonical(row), file = join(journal, parent.slice(7) + '.json');
    totalBytes += Buffer.byteLength(contents); oldest ??= file;
    await writeFile(file, contents);
  }
  assert.ok(totalBytes > MAX_BYTES, 'Exercise the real snapshot cache budget');
  const adapter = await createFolderAdapter(dir), before = await adapter.read();
  const originalDigest = globalThis.crypto.subtle.digest, originalClone = globalThis.structuredClone;
  let semanticDigests = 0, journalClones = 0;
  globalThis.crypto.subtle.digest = function (...args) { semanticDigests++; return originalDigest.apply(this, args); };
  globalThis.structuredClone = function (value, ...args) {
    if (value?.schemaVersion === 2 && value.state?.objects) journalClones++;
    return originalClone(value, ...args);
  };
  try {
    const warm = await adapter.read();
    assert.deepEqual(warm, before);
    assert.equal(semanticDigests, 0, 'Unchanged freshly read bytes reuse their canonical and semantic proof');
    assert.equal(journalClones, 0, 'Evicted legacy journal envelopes are not cloned for canonical cache ownership');
    warm.operations['snapshot-0'].verified = false;
    assert.equal((await adapter.read()).operations['snapshot-0'].verified, true);
    const contents = await readFile(oldest, 'utf8'), metadata = await stat(oldest);
    await writeFile(oldest, contents.replace('Keep', 'LOSS')); await utimes(oldest, metadata.atime, metadata.mtime);
    await assert.rejects(adapter.read(), { code: 'HASH_MISMATCH' });
    await writeFile(oldest, contents);
    assert.equal((await adapter.read()).revision, revision);
    await rename(oldest, oldest + '.missing');
    await assert.rejects(adapter.read(), { code: 'MISSING_OBJECT' });
    await rename(oldest + '.missing', oldest);
    assert.deepEqual(await adapter.read(), before);
  } finally { globalThis.crypto.subtle.digest = originalDigest; globalThis.structuredClone = originalClone; }
});
