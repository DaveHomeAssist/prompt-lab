import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, cp, unlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createCommandService } from './contract.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'promptlab-inspection-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function contents(root) {
  const result = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    result[entry.name] = entry.isDirectory() ? await contents(join(root, entry.name)) : (await readFile(join(root, entry.name))).toString('base64');
  }
  return result;
}
async function commit(root, key, expectedRevision = null) {
  const service = createCommandService(await createFolderAdapter(root));
  const preview = await service.preview({ libraryId: 'inspected-library', expectedRevision,
    sourceText: JSON.stringify({ library: [{ id: key, original: key, versions: Array.from({ length: 40 }, (_, index) => ({ id: index, content: 'retained' })) }], unknown: { retained: true } }) });
  return service.apply({ ...preview, idempotencyKey: key });
}

test('inspection leaves an empty directory untouched and cannot publish', async t => {
  const root = await fixture(t), before = await contents(root);
  const adapter = await createFolderAdapter(root, { readOnly: true });
  const result = await adapter.inspect();
  assert.equal(result.libraryId, null); assert.equal(result.headCount, 0);
  assert.equal(result.recoveryRequired, false); assert.deepEqual(result.heads, []);
  assert.deepEqual(await contents(root), before);
  await assert.rejects(adapter.transact(() => assert.fail('read-only transaction ran')), { code: 'READ_ONLY' });
  await assert.rejects(createFolderAdapter(join(root, 'absent'), { readOnly: true }), { code: 'ENOENT' });
  assert.deepEqual(await contents(root), before);
});

test('inspection verifies complete history and preserves every existing byte', async t => {
  const root = await fixture(t), receipt = await commit(root, 'first');
  const before = await contents(root), adapter = await createFolderAdapter(root, { readOnly: true });
  const result = await adapter.inspect();
  assert.equal(result.libraryId, 'inspected-library'); assert.equal(result.headCount, 1);
  assert.equal(result.heads[0].revision, receipt.revision);
  assert.ok(result.heads[0].counts.objects > 0);
  assert.deepEqual(await contents(root), before);
  await assert.rejects(adapter.transact(() => assert.fail('read-only transaction ran')), { code: 'READ_ONLY' });
  assert.deepEqual(await contents(root), before);
});

test('inspection rejects unrelated files and retained partial publication without cleanup', async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'my-file.txt'), 'retain this unrelated file');
  const adapter = await createFolderAdapter(root, { readOnly: true }), before = await contents(root);
  await assert.rejects(adapter.inspect(), { code: 'UNRECOGNIZED_FOLDER' });
  assert.deepEqual(await contents(root), before);
  await unlink(join(root, 'my-file.txt'));
  await mkdir(join(root, 'transactions')); await writeFile(join(root, 'transactions', 'interrupted.pending'), 'partial');
  const partial = await contents(root);
  await assert.rejects(adapter.inspect(), { code: 'INCOMPLETE_STORE' });
  assert.deepEqual(await contents(root), partial);
});

test('corrupt and missing objects reject without recreating missing content', async t => {
  const root = await fixture(t); await commit(root, 'first');
  const path = join(root, 'objects', (await readdir(join(root, 'objects')))[0]);
  const original = await readFile(path); await writeFile(path, '{}');
  const broken = await contents(root), adapter = await createFolderAdapter(root, { readOnly: true });
  await assert.rejects(adapter.inspect(), { code: 'HASH_MISMATCH' });
  assert.deepEqual(await contents(root), broken);
  await writeFile(path, original); await unlink(path);
  const missing = await contents(root);
  await assert.rejects(adapter.inspect(), { code: 'MISSING_OBJECT' });
  assert.deepEqual(await contents(root), missing);
});

test('inspection exposes both divergent heads without selecting or merging either', async t => {
  const base = await fixture(t), remote = await fixture(t);
  const initial = await commit(base, 'base'); await cp(base, remote, { recursive: true });
  const left = await commit(base, 'left', initial.revision), right = await commit(remote, 'right', initial.revision);
  await cp(remote, base, { recursive: true, force: false });
  const before = await contents(base), adapter = await createFolderAdapter(base, { readOnly: true });
  const result = await adapter.inspect();
  assert.equal(result.headCount, 2); assert.equal(result.recoveryRequired, true);
  assert.deepEqual(result.heads.map(item => item.revision).sort(), [left.revision, right.revision].sort());
  assert.deepEqual(await contents(base), before);
  await assert.rejects(adapter.read(), { code: 'DIVERGENT_HEADS' });
});

test('inspection refuses symlinked library roots and content directories', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t), target = await fixture(t);
  await symlink(target, join(root, 'alias'));
  await assert.rejects(createFolderAdapter(join(root, 'alias'), { readOnly: true }), { code: 'UNSAFE_DIRECTORY' });
  await symlink(target, join(target, 'objects'));
  await assert.rejects(createFolderAdapter(target, { readOnly: true }), { code: 'UNSAFE_DIRECTORY' });
});
