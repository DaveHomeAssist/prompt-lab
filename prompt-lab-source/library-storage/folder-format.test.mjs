import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile, rename, rm, stat, utimes, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createCommandService, createMemoryAdapter, canonical, hash, MAX_BYTES } from './contract.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';

const input = { libraryId: 'lib', sourceText: JSON.stringify({ library: [{ id: 'p', original: 'Keep', versions: [{ id: 'old', original: 'Prior' }] }], future: { retained: true } }) };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'promptlab-format-disposable-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function save(adapter, key = 'first', sourceText = input.sourceText) {
  const service = createCommandService(adapter);
  const preview = await service.preview({ ...input, sourceText, expectedRevision: (await adapter.read()).revision });
  return service.apply({ ...preview, idempotencyKey: key });
}
async function files(root, section) {
  return new Map(await Promise.all((await readdir(join(root, section))).filter(name => name.endsWith('.json')).map(async name => [name, await readFile(join(root, section, name))])));
}

test('generation 3 stores new objects once and preserves exact transfer state across restart', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root);
  await save(adapter);
  const before = await adapter.read(), original = await files(root, 'objects');
  await save(adapter, 'second', input.sourceText.replace('Keep', 'Next'));
  const after = await adapter.read();
  assert.deepEqual(await (await createFolderAdapter(root)).read(), after);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const stored = await files(root, 'objects');
  assert.equal(stored.size, Object.keys(after.objects).length);
  for (const [name, bytes] of original) assert.deepEqual(stored.get(name), bytes);
  const rows = [...(await files(root, 'transactions')).values()].map(bytes => JSON.parse(bytes));
  assert.ok(rows.every(row => row.schemaVersion === 3 && !Object.hasOwn(row, 'state')));
  const last = rows.find(row => row.parents.length);
  assert.deepEqual(last.objects, Object.keys(after.objects).filter(id => !Object.hasOwn(before.objects, id)).sort());
  assert.deepEqual(Object.keys(last.operations), ['second']);
  assert.ok(rows.every(row => Buffer.byteLength(canonical(row)) < 4096));
});

for (const generation of [1, 2]) test(`generation ${generation} state and metadata survive a generation 3 descendant`, async t => {
  const root = await fixture(t), memory = createMemoryAdapter(); await save(memory);
  await memory.transact(state => { state.futureMetadata = { preserve: ['unknown', false, null] }; });
  const state = await memory.read(), row = { schemaVersion: generation, ...(generation === 1 ? { parent: null } : { parents: [] }), state };
  const id = await hash(row), text = canonical(row), file = join(root, 'transactions', id.slice(7) + '.json');
  await mkdir(join(root, 'transactions')); await writeFile(file, text);
  const adapter = await createFolderAdapter(root); assert.deepEqual(await adapter.read(), state);
  await save(adapter, 'second');
  const after = await (await createFolderAdapter(root)).read();
  assert.deepEqual(after.futureMetadata, state.futureMetadata);
  for (const [id, object] of Object.entries(state.objects)) assert.deepEqual(after.objects[id], object);
  assert.equal(await readFile(file, 'utf8'), text);
  const rows = [...(await files(root, 'transactions')).values()].map(bytes => JSON.parse(bytes));
  assert.deepEqual(rows.find(row => row.schemaVersion === 3).parents, [id]);
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
});

for (const point of ['object-before-flush', 'object-before-publication', 'object-after-publication', 'receipt-before-flush', 'receipt-before-publication', 'receipt-after-publication']) {
  test(`interrupted ${point} leaves the earlier head readable and retryable`, async t => {
    const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
    const before = await adapter.read(), original = await files(root, 'transactions');
    const faulty = await createFolderAdapter(root, { fault: async phase => { if (phase === point) throw new Error('Synthetic interruption'); } });
    await assert.rejects(save(faulty, 'retry', input.sourceText.replace('Keep', 'Next')), /Synthetic interruption/);
    const reopened = await createFolderAdapter(root);
    assert.deepEqual(await reopened.read(), before);
    assert.deepEqual(await files(root, 'transactions'), original);
    await save(reopened, 'retry', input.sourceText.replace('Keep', 'Next'));
    assert.equal(Object.keys((await reopened.read()).operations).length, 2);
    for (const [name, bytes] of original) assert.deepEqual((await files(root, 'transactions')).get(name), bytes);
  });
}

for (const section of ['objects', 'receipts']) test(`fresh and warm reads reject changed or missing ${section}`, async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  const before = await adapter.read(), initial = await files(root, section), [name, bytes] = [...initial][0];
  const path = join(root, section, name), meta = await stat(path);
  // Change a value without changing the byte count or mtime.
  const changed = Buffer.from(bytes); const index = changed.indexOf(Buffer.from('lib'));
  if (index >= 0) changed[index] = 'x'.charCodeAt(0);
  else { const parsed = JSON.parse(bytes); parsed.changed = true; await writeFile(path, canonical(parsed)); }
  if (index >= 0) { await writeFile(path, changed); await utimes(path, meta.atime, meta.mtime); }
  await assert.rejects(adapter.read(), { code: 'HASH_MISMATCH' });
  await assert.rejects((await createFolderAdapter(root)).read(), { code: 'HASH_MISMATCH' });
  await writeFile(path, bytes); assert.deepEqual(await adapter.read(), before);
  await rename(path, path + '.missing');
  await assert.rejects(adapter.read(), { code: 'MISSING_OBJECT' });
  await rename(path + '.missing', path); assert.deepEqual(await adapter.read(), before);
});

test('manifest arriving before content stays unavailable until every referenced file arrives', async t => {
  const root = await fixture(t), left = join(root, 'left'), right = join(root, 'right');
  const adapter = await createFolderAdapter(left); await save(adapter);
  const target = await createFolderAdapter(right);
  for (const [name, bytes] of await files(left, 'transactions')) await writeFile(join(right, 'transactions', name), bytes);
  await assert.rejects(target.read(), { code: 'MISSING_OBJECT' });
  for (const [name, bytes] of await files(left, 'objects')) await writeFile(join(right, 'objects', name), bytes);
  await assert.rejects(target.read(), { code: 'MISSING_OBJECT' });
  for (const [name, bytes] of await files(left, 'receipts')) await writeFile(join(right, 'receipts', name), bytes);
  assert.deepEqual(await target.read(), await adapter.read());
});

test('publication never overwrites corrupt orphan content at an expected address', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  const before = await adapter.read(); let damaged;
  const faulty = await createFolderAdapter(root, { fault: async phase => {
    if (phase !== 'object-before-publication' || damaged) return;
    const pending = (await readdir(join(root, 'objects'))).find(name => name.endsWith('.pending'));
    const value = JSON.parse(await readFile(join(root, 'objects', pending)));
    const id = await hash(value);
    damaged = join(root, 'objects', id.slice(7) + '.json');
    await writeFile(damaged, '{"corrupt":true}', { flag: 'wx' });
  } });
  await assert.rejects(save(faulty, 'collision', input.sourceText.replace('Keep', 'Next')), { code: 'HASH_MISMATCH' });
  assert.equal(await readFile(damaged, 'utf8'), '{"corrupt":true}');
  assert.deepEqual(await adapter.read(), before);
});

test('a manifest cannot erase inherited checkpoints or overwrite an earlier receipt', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter); await save(adapter, 'second');
  const before = await adapter.read(), page = await adapter.branches({ libraryId: 'lib' });
  const head = page.items[0].transactionId, previous = JSON.parse(await readFile(join(root, 'transactions', head.slice(7) + '.json')));
  const bad = { ...previous, parents: [head], objects: [], operations: {}, checkpoints: [] }, id = await hash(bad);
  const path = join(root, 'transactions', id.slice(7) + '.json');
  await writeFile(path, canonical(bad));
  await assert.rejects(adapter.read(), { code: 'HISTORY_LOSS' });
  await rename(path, path + '.preserved');
  const replacement = { ...before.operations.first, verified: false }, receiptId = await hash(replacement);
  await writeFile(join(root, 'receipts', receiptId.slice(7) + '.json'), canonical(replacement));
  const other = { ...bad, operations: { first: receiptId }, checkpoints: before.checkpoints }, otherId = await hash(other);
  await writeFile(join(root, 'transactions', otherId.slice(7) + '.json'), canonical(other));
  await assert.rejects(adapter.read(), { code: 'HISTORY_LOSS' });
});

test('late callback mutation cannot change a transaction after verification begins', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  let draft;
  const guarded = await createFolderAdapter(root, { fault: async phase => {
    if (phase === 'before-publication') draft.future = 'Changed after verification';
  } });
  await guarded.transact(value => { draft = value; value.future = 'Reviewed'; });
  assert.equal((await guarded.read()).future, 'Reviewed');
  assert.equal(draft.future, 'Changed after verification');
});

test('conflict copies and symlinks in content directories fail closed without modifying files', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  const [name, bytes] = [...await files(root, 'objects')][0], path = join(root, 'objects', name), conflict = path.replace('.json', ' conflict.json');
  await writeFile(conflict, bytes);
  await assert.rejects(adapter.read(), { code: 'CLOUD_CONFLICT' });
  await rename(conflict, conflict + '.preserved');
  await rename(path, path + '.original'); await symlink(path + '.original', path);
  await assert.rejects(adapter.read(), { code: 'UNSAFE_DIRECTORY' });
  assert.deepEqual(await readFile(path + '.original'), bytes);
});

test('aggregate history above 64 MiB saves, reopens and transfers as bounded individual objects', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  const before = await adapter.read();
  const extras = {};
  for (let n = 0; n < 7; n++) {
    const object = { schemaVersion: 1, kind: 'future-asset', data: String(n) + 'x'.repeat(10 * 1024 * 1024) };
    extras[await hash(object)] = object;
  }
  await adapter.transact(state => { Object.assign(state.objects, extras); });
  const after = await (await createFolderAdapter(root)).read();
  assert.deepEqual(after.objects, { ...before.objects, ...extras });
  assert.deepEqual((await inspectTransfer(await createTransfer(after))).state, after);
  const stored = await files(root, 'objects');
  assert.ok([...stored.values()].reduce((sum, bytes) => sum + bytes.length, 0) > MAX_BYTES);
  assert.ok([...stored.values()].every(bytes => bytes.length < MAX_BYTES));
  assert.ok([...(await files(root, 'transactions')).values()].every(bytes => bytes.length < 4096));
  await save(await createFolderAdapter(root), 'after-large-history');
  const final = await (await createFolderAdapter(root)).read();
  for (const [id, value] of Object.entries(after.objects)) assert.deepEqual(final.objects[id], value);
  assert.equal(Object.keys(final.operations).length, 2);
});

test('individual object depth does not acquire an aggregate transaction envelope limit', async t => {
  const root = await fixture(t), adapter = await createFolderAdapter(root); await save(adapter);
  let data = 'preserved';
  for (let n = 0; n < 127; n++) data = [data];
  const object = { schemaVersion: 1, kind: 'future-depth', data }, id = await hash(object);
  await adapter.transact(state => { state.objects[id] = object; });
  assert.deepEqual((await (await createFolderAdapter(root)).read()).objects[id], object);
});
