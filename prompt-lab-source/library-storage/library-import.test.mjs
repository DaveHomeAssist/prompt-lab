import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, createPackage, inspectPackage, makeObject, FORMAT, VERSION } from './contract.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';

const libraryId = 'history-library';
const pkgFor = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId, head: state.revision, objects: state.objects });
const workspace = (label, count) => ({
  library: [{ id: 'same-id', title: 'Shared title', original: label, currentVersionId: 'current',
    versions: Array.from({ length: count }, (_, i) => ({ id: `v${i}`, original: `${label} history ${i}`, unknown: { label, i } })) }],
  trash: [{ id: 'trashed', original: `${label} trash` }],
  runs: [{ id: 'r', promptId: 'same-id', promptVersionId: 'v0', output: `${label} run` }],
  testCases: [{ id: 'case', promptId: 'same-id', expected: label }],
  scratch: { pads: [{ id: 'note', content: `${label} note`, linkedPromptId: 'same-id' }] },
  folders: [{ id: 'folder', name: label }], packs: { same: { label, unknown: true } },
  assets: { image: { bytes: 'AAE=', provenance: label } }, backups: [{ name: label, state: 'external-unavailable' }],
  future: { label, preserved: [null, 0, false] }, markers: { deleted: ['unavailable'], generation: '0' },
});

async function importSource(service, value, resolutions = {}, key = 'import', text = JSON.stringify(value, null, 2) + '\n') {
  const state = await service.read();
  const preview = await service.preview({ libraryId, expectedRevision: state.revision, mode: 'import', sourceText: text, resolutions });
  const receipt = await service.apply({ ...preview, idempotencyKey: key });
  return { preview, receipt, text };
}

async function snapshot(service, value) {
  const preview = await service.preview({ libraryId, expectedRevision: null, sourceText: JSON.stringify(value) });
  return service.apply({ ...preview, idempotencyKey: 'snapshot' });
}

test('three imports retain 126 histories, source identities, unknown fields and associations across restart', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const originals = [workspace('first', 41), workspace('second', 42), workspace(' SECOND ', 43)];
  const first = await importSource(service, originals[0], {}, 'one');
  const groupId = first.preview.importPlan.manifest.groups[0].id;
  const second = await importSource(service, originals[1], { 'same-id': { action: 'replace', existingId: 'same-id' } }, 'two');
  const third = await importSource(service, originals[2], {}, 'three');
  assert.equal(third.preview.importPlan.rows[0].kind, 'duplicate');
  const state = adapter.read();
  const result = await inspectPackage(pkgFor(state));
  assert.equal(result.commits, 3);
  assert.equal(result.manifest.sources.length, 3);
  assert.equal(result.manifest.nodes.filter(node => node.kind === 'version').length, 126);
  assert.equal(result.manifest.groups.length, 1);
  assert.equal(result.manifest.groups[0].id, groupId);
  assert.equal(result.manifest.groups[0].members.length, 3);
  assert.equal(result.manifest.groups[0].selected, second.preview.importPlan.manifest.groups[0].selected);
  for (const [i, source] of result.manifest.sources.entries()) {
    assert.deepEqual(state.objects[source.workspace].data, originals[i]);
    assert.equal(state.objects[source.source].data, [first, second, third][i].text);
  }
  for (const reference of result.manifest.references) {
    assert.ok(reference.target, 'Every synthetic reference has its own source record');
    assert.equal(reference.groupId, groupId);
    assert.equal(JSON.parse(reference.from)[0], JSON.parse(reference.target)[0]);
  }
  const reopened = createCommandService(createMemoryAdapter(state));
  assert.deepEqual(await reopened.apply({ ...third.preview, idempotencyKey: 'three' }), third.receipt);
  assert.equal((await reopened.read()).revision, third.receipt.revision);
  assert.deepEqual(state.checkpoints, [first.receipt.revision, second.receipt.revision]);
});

test('Keep creates independent groups with the same raw ID; later ambiguous target IDs require explicit scope', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  await importSource(service, workspace('first', 1), {}, 'one');
  const second = await importSource(service, workspace('second', 1), { 'same-id': { action: 'keep' } }, 'two');
  const before = adapter.read();
  const input = { libraryId, expectedRevision: before.revision, mode: 'import', sourceText: JSON.stringify(workspace('third', 1)) };
  await assert.rejects(service.preview({ ...input, resolutions: { 'same-id': { action: 'replace', existingId: 'same-id' } } }), { code: 'INVALID_RESOLUTIONS' });
  assert.deepEqual(adapter.read(), before);
  const target = second.preview.importPlan.manifest.groups[1].selected;
  const third = await importSource(service, workspace('third', 1), { 'same-id': { action: 'replace', target } }, 'three');
  assert.equal(third.preview.importPlan.manifest.groups.length, 2);
  assert.deepEqual(third.preview.importPlan.manifest.groups[0], second.preview.importPlan.manifest.groups[0]);
  assert.equal(third.preview.importPlan.manifest.groups[1].members.length, 2);
});

test('one export with divergent duplicate IDs commits both records using path-scoped choices', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const value = workspace('first', 2);
  value.library.push({ ...workspace('second', 3).library[0] });
  const input = { libraryId, expectedRevision: null, mode: 'import', sourceText: JSON.stringify(value) };
  const pending = await service.preview(input);
  assert.equal(pending.importPlan.unresolved, 1);
  const member = pending.importPlan.rows.find(row => !row.choice).member;
  const preview = await service.preview({ ...input, resolutions: { [member]: { action: 'keep' } } });
  await service.apply({ ...preview, idempotencyKey: 'duplicate-ids' });
  const inspected = await inspectPackage(pkgFor(adapter.read()));
  assert.equal(inspected.manifest.groups.length, 2);
  assert.equal(inspected.manifest.nodes.filter(node => node.kind === 'version').length, 5);
  assert.ok(inspected.manifest.references.some(link => link.reason === 'ambiguous-source-reference'));
  assert.deepEqual(adapter.read().objects[inspected.manifest.sources[0].workspace].data, value);
});

test('reimport retains alternate source bytes without duplicating or reactivating a skipped record', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  await importSource(service, workspace('first', 1), {}, 'one');
  const value = workspace('second', 2);
  const skipped = await importSource(service, value, { 'same-id': { action: 'skip' } }, 'skip');
  const again = await importSource(service, value, {}, 'repeat', JSON.stringify(value));
  const a = skipped.preview.importPlan.manifest, b = again.preview.importPlan.manifest;
  assert.equal(b.sources.length, 3);
  assert.deepEqual(b.groups, a.groups);
  assert.deepEqual(b.nodes, a.nodes);
  assert.deepEqual(b.references, a.references);
  assert.equal(b.groups[0].members.length, 1);
  assert.ok(b.references.some(link => link.reason === 'prompt-not-selected'));
  assert.notEqual(b.sources[1].source, b.sources[2].source);
  assert.equal(b.sources[1].workspace, b.sources[2].workspace);
  const same = await importSource(service, value, {}, 'same-bytes', JSON.stringify(value));
  assert.deepEqual(same.preview.importPlan.manifest, b);
});

test('a snapshot base upgrades to a graph without an identical import pruning its pre-existing records', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const value = workspace('snapshot', 41);
  value.library.push({ id: 'other', original: 'snapshot', title: 'Other duplicate body' });
  await snapshot(service, value);
  const imported = await importSource(service, value, {}, 'upgrade');
  assert.equal(imported.preview.importPlan.manifest.groups.length, 2);
  assert.equal(imported.receipt.counts.historyRecords, 41);
  assert.equal((await inspectPackage(pkgFor(adapter.read()))).commits, 2);
  const before = adapter.read();
  await assert.rejects(service.preview({ libraryId, expectedRevision: before.revision, sourceText: JSON.stringify({ library: [] }) }), { code: 'UNSUPPORTED_OPERATION' });
  const unsafe = await createPackage(JSON.stringify({ library: [] }), { libraryId, operationId: 'unsafe', parents: [before.revision] });
  await assert.rejects(inspectPackage({ ...unsafe, objects: { ...before.objects, ...unsafe.objects } }), { code: 'UNSUPPORTED_OPERATION' });
  assert.deepEqual(adapter.read(), before);
});

test('content hashes alone cannot legitimize a tampered selection or missing historical source', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  await importSource(service, workspace('first', 2), {}, 'one');
  await importSource(service, workspace('second', 3), { 'same-id': { action: 'replace', existingId: 'same-id' } }, 'two');
  const pkg = pkgFor(adapter.read());
  const current = pkg.objects[pkg.head].data;
  const changed = structuredClone(pkg.objects[current.state].data);
  changed.groups[0].members.shift();
  const stateObject = await makeObject('library-state', changed);
  const commitObject = await makeObject('commit', { ...current, state: stateObject.hash });
  const forged = { ...pkg, head: commitObject.hash, objects: { ...pkg.objects, [stateObject.hash]: stateObject.object, [commitObject.hash]: commitObject.object } };
  await assert.rejects(inspectPackage(forged), { code: 'IMPORT_PLAN_MISMATCH' });
  const plan = structuredClone(pkg.objects[current.importPlan].data);
  plan.resolutions['same-id'] = { action: 'keep' };
  const planObject = await makeObject('import-plan', plan);
  const alteredCommit = await makeObject('commit', { ...current, importPlan: planObject.hash });
  await assert.rejects(inspectPackage({ ...pkg, head: alteredCommit.hash, objects: { ...pkg.objects, [planObject.hash]: planObject.object, [alteredCommit.hash]: alteredCommit.object } }), { code: 'IMPORT_PLAN_MISMATCH' });
  const missing = structuredClone(pkg);
  delete missing.objects[changed.sources[0].source];
  await assert.rejects(inspectPackage(missing), { code: 'MISSING_OBJECT' });
});

test('separate command writers cannot lose an imported source or reuse an operation key for different choices', async () => {
  const adapter = createMemoryAdapter(), first = createCommandService(adapter), second = createCommandService(adapter);
  const one = await importSource(first, workspace('first', 1), {}, 'one');
  const input = { libraryId, expectedRevision: one.receipt.revision, mode: 'import', sourceText: JSON.stringify(workspace('second', 1)) };
  const a = await first.preview({ ...input, resolutions: { 'same-id': { action: 'keep' } } });
  const b = await second.preview({ ...input, resolutions: { 'same-id': { action: 'replace', existingId: 'same-id' } } });
  const outcomes = await Promise.allSettled([first.apply({ ...a, idempotencyKey: 'a' }), second.apply({ ...b, idempotencyKey: 'b' })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const successful = outcomes[0].status === 'fulfilled' ? 'a' : 'b';
  const changed = successful === 'a' ? b : a;
  await assert.rejects(first.apply({ ...changed, idempotencyKey: successful }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await inspectPackage(pkgFor(adapter.read()))).manifest.sources.length, 2);
  assert.equal(Object.keys(adapter.read().operations).length, 2);
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`folder import interruption at ${point} keeps all histories through reopen and receipt recovery`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'promptlab-import-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const service = createCommandService(await createFolderAdapter(directory));
    const first = await importSource(service, workspace('first', 41), {}, 'one');
    let crash = true;
    const faulty = createCommandService(await createFolderAdapter(directory, { fault: async phase => { if (crash && phase === point) throw new Error('import interruption'); } }));
    const input = { libraryId, expectedRevision: first.receipt.revision, mode: 'import', sourceText: JSON.stringify(workspace('second', 42)), resolutions: { 'same-id': { action: 'replace', existingId: 'same-id' } } };
    const preview = await faulty.preview(input);
    await assert.rejects(faulty.apply({ ...preview, idempotencyKey: 'two' }), /import interruption/);
    crash = false;
    const reopened = createCommandService(await createFolderAdapter(directory));
    if (point === 'after-publication') {
      assert.equal((await reopened.operation('two')).counts.historyRecords, 83);
      await reopened.apply({ ...preview, idempotencyKey: 'two' });
    } else {
      assert.equal((await reopened.read()).revision, first.receipt.revision);
      assert.equal(await reopened.operation('two'), null);
      await reopened.apply({ ...await reopened.preview(input), idempotencyKey: 'two' });
    }
    const state = await reopened.read();
    const result = await inspectPackage(pkgFor(state));
    assert.equal(result.manifest.nodes.filter(node => node.kind === 'version').length, 83);
    assert.equal(result.manifest.sources.length, 2);
    assert.equal(Object.keys(state.operations).length, 2);
  });
}
