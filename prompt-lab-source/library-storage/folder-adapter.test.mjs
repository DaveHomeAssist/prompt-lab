import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createCommandService, inspectPackage, FORMAT, VERSION } from './contract.mjs';

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
  await writeFile(join(journal, name), before.replace('keep', 'LOSS'));
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
