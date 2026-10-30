import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createCommandService, createMemoryAdapter, createPackage, inspectPackage, hash, makeObject, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { collectDeletionEvidence, inspectSourceBinding } from './source-binding.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createLocalApi } from './local-api.mjs';

const workspace = { library: [{ id: 'same-id', original: 'preserved', versions: Array.from({ length: 41 }, (_, id) => ({ id: `v${id}`, unknown: true })) }], trash: [], future: { preserved: true } };
const pkgFor = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
async function fixture({ content = workspace, sourceIdentity = 'origin-a', markers = {}, journal, surface = 'desktop' } = {}) {
  const values = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []),
    'pl2-pad': 'legacy raw Scratch $& {{input}}', ...markers };
  const inventory = await captureSourceInventory({ surface, sourceIdentity,
    localStorage: { length: Object.keys(values).length, key: i => Object.keys(values)[i], getItem: key => values[key] ?? null },
    readIndexedStore: async ({ store }) => {
      if (store === 'journal' && journal === 'unavailable') throw new Error('private failure');
      return store === 'journal' && journal ? { state: 'present', records: journal }
        : { state: 'absent', reason: 'No synthetic database.' };
    }, archives: { reviewed: true, records: [] }, capturedAt: '2026-10-29T00:00:00Z',
  });
  return { libraryId: 'lib', expectedRevision: null, sourceText: JSON.stringify(content), sourceInventory: inventory };
}
const commit = async (service, input, key) => service.apply({ ...await service.preview(input), idempotencyKey: key });

test('warm binding proof checks every dependency and expected identity, with isolated returned captures', async () => {
  const input = await fixture();
  const pkg = await createPackage(input.sourceText, { libraryId: 'warm-binding', operationId: 'initial', sourceInventory: input.sourceInventory });
  const id = pkg.objects[pkg.head].data.sourceBinding;
  const first = await inspectSourceBinding(pkg.objects, id);
  const expected = structuredClone(first);
  first.inventory.manifest.sourceIdentity = 'poison';
  first.captures['local-content'].entries['pl2-library'] = '[]';
  first.inventory.objects[first.inventory.manifest.sources.find(s => s.id === 'local-content').hash].data.entries['pl2-pad'] = 'changed';
  assert.deepEqual(await inspectSourceBinding(structuredClone(pkg.objects), id), expected);
  const references = [id, expected.binding.source, expected.binding.workspace, expected.binding.inventory, ...Object.keys(expected.inventory.objects)];
  for (const reference of references) {
    const missing = structuredClone(pkg.objects); delete missing[reference];
    await assert.rejects(inspectSourceBinding(missing, id), { code: 'MISSING_OBJECT' });
    const corrupt = structuredClone(pkg.objects); corrupt[reference].kind += '-changed';
    await assert.rejects(inspectSourceBinding(corrupt, id), { code: 'HASH_MISMATCH' });
  }
  await assert.rejects(inspectSourceBinding(pkg.objects, id, { source: 'wrong' }), { code: 'SOURCE_BINDING_MISMATCH' });
  await assert.rejects(inspectSourceBinding(pkg.objects, id, { workspace: 'wrong' }), { code: 'SOURCE_BINDING_MISMATCH' });
  assert.deepEqual(await inspectSourceBinding(pkg.objects, id, { source: expected.binding.source, workspace: expected.binding.workspace }), expected);
});

for (const mode of ['snapshot', 'import']) {
  test(`${mode} binds exact raw captures and survives complete transfer and replay`, async () => {
    const service = createCommandService(createMemoryAdapter());
    const input = { ...await fixture(), mode };
    const preview = await service.preview(input);
    const receipt = await service.apply({ ...preview, idempotencyKey: 'bound' });
    assert.equal(receipt.sourceBinding, preview.sourceBinding);
    const state = await service.read(), inspection = await inspectPackage(pkgFor(state));
    assert.deepEqual(inspection.sourceBindings, [receipt.sourceBinding]);
    const bound = await inspectSourceBinding(state.objects, receipt.sourceBinding);
    assert.deepEqual(bound.inventory, input.sourceInventory);
    assert.equal(bound.captures['local-content'].entries['pl2-pad'], 'legacy raw Scratch $& {{input}}');
    const verified = await inspectTransfer(await createTransfer(state));
    assert.deepEqual(verified.state, state);
    const restarted = createCommandService(createMemoryAdapter(verified.state));
    assert.deepEqual(await restarted.apply({ ...preview, idempotencyKey: 'bound' }), receipt);
    assert.equal(verified.counts.commits, 1);
  });
}

test('bound captures reject raw Library/trash disagreement and malformed Library JSON', async () => {
  for (const key of ['pl2-library', 'pl2-library-trash']) {
    const input = await fixture();
    const source = input.sourceInventory.manifest.sources.find(item => item.id === 'local-content');
    const prior = input.sourceInventory.objects[source.hash];
    for (const value of ['[{"id":"another"}]', '{bad']) {
      const data = structuredClone(prior.data); data.entries[key] = value;
      const altered = await makeObject('source-capture', data);
      const inventory = structuredClone(input.sourceInventory);
      delete inventory.objects[source.hash]; inventory.objects[altered.hash] = altered.object;
      inventory.manifest.sources.find(item => item.id === 'local-content').hash = altered.hash;
      inventory.manifestHash = await hash(inventory.manifest);
      await assert.rejects(createPackage(input.sourceText, { libraryId: 'lib', operationId: 'bad', sourceInventory: inventory }), { code: 'SOURCE_BINDING_MISMATCH' });
    }
  }
});

test('bindings require a stable current capture and reject undeclared objects', async () => {
  const input = await fixture();
  const inventory = input.sourceInventory;
  const source = inventory.manifest.sources.find(item => item.id === 'local-content');
  const data = inventory.objects[source.hash].data;
  const changed = await makeObject('source-capture', { id: 'local-content', state: 'changed', observations: [data, data] });
  delete inventory.objects[source.hash]; inventory.objects[changed.hash] = changed.object;
  source.hash = changed.hash; source.state = 'changed'; inventory.manifest.sourceReadComplete = false;
  inventory.manifestHash = await hash(inventory.manifest);
  await assert.rejects(createPackage(input.sourceText, { libraryId: 'lib', operationId: 'changed', sourceInventory: inventory }), { code: 'SOURCE_BINDING_UNAVAILABLE' });
  const other = await fixture();
  const extra = await makeObject('source-capture', { id: 'unselected', private: 'must not enter' });
  other.sourceInventory.objects[extra.hash] = extra.object;
  await assert.rejects(createCommandService(createMemoryAdapter()).preview(other), { code: 'SOURCE_BINDING_MISMATCH' });
  const future = await fixture(); future.sourceInventory.future = { mustNotBeDiscarded: true };
  await assert.rejects(createCommandService(createMemoryAdapter()).preview(future), { code: 'SOURCE_BINDING_MISMATCH' });
});

test('caller mutation cannot change the capture bound by a pending preview', async () => {
  const input = await fixture({ markers: { 'pl2-library-deleted:erased': '1' } });
  const original = structuredClone(input.sourceInventory);
  const service = createCommandService(createMemoryAdapter());
  const pending = service.preview(input);
  input.sourceInventory.manifest.sourceIdentity = 'changed';
  for (const object of Object.values(input.sourceInventory.objects)) if (object.data.id === 'local-content') object.data.entries['pl2-library'] = '[]';
  const preview = await pending;
  const receipt = await service.apply({ ...preview, idempotencyKey: 'owned' });
  assert.deepEqual((await inspectSourceBinding((await service.read()).objects, receipt.sourceBinding)).inventory, original);
});

test('ancestry retains bindings and unions deletion evidence only within the named origin', async () => {
  const service = createCommandService(createMemoryAdapter());
  const first = await commit(service, await fixture({ markers: { 'pl2-library-deleted:same-id': '1' } }), 'first');
  const second = await commit(service, { ...await fixture({ markers: { 'pl2-library-deleted-batch:batch': '["other","__proto__"]' },
    journal: [{ id: 'library', revision: 7, entries: { 'pl2-library-clear:0000000000000007:abc-123': '1', 'pl2-library-deleted:journal-only': '1' } }] }), expectedRevision: first.revision }, 'second');
  await commit(service, { ...await fixture({ sourceIdentity: 'origin-b' }), expectedRevision: second.revision }, 'third');
  const state = await service.read(), inspected = await inspectPackage(pkgFor(state));
  const evidence = await collectDeletionEvidence(state.objects, inspected.sourceBindings);
  assert.equal(evidence.bindingCount, 3); assert.equal(evidence.activationReady, false);
  assert.deepEqual(evidence.scopes[0].deletedIds, ['__proto__', 'journal-only', 'other', 'same-id']);
  assert.equal(evidence.scopes[0].generation, '0000000000000007:abc-123');
  assert.equal(evidence.scopes[0].complete, true);
  assert.ok(evidence.scopes[0].workspaces.includes(state.objects[first.sourceBinding].data.workspace));
  assert.deepEqual(evidence.scopes[1].deletedIds, []);
  assert.equal(evidence.scopes[1].generation, '0');
  assert.equal(evidence.scopes[1].complete, true);
  assert.equal((await inspectTransfer(await createTransfer(state))).counts.checkpoints, 2);
});

test('malformed and unavailable deletion sources remain unknown without exposing raw error contents', async () => {
  for (const options of [
    { markers: { 'pl2-library-deleted:': '1' } },
    { markers: { 'pl2-library-deleted:valid': 'private invalid marker' } },
    { markers: { 'pl2-library-deleted-batch:batch': '{private malformed' } },
    { markers: { 'pl2-library-clear:invalid': '1' } },
    { journal: 'unavailable' },
    { journal: [{ id: 'library', revision: 1, entries: null }] },
    { journal: [{ id: 'library', revision: 0, entries: {} }] },
    { journal: [{ id: 'future-journal', entries: {} }] },
    { journal: [{ id: 'library', revision: 1, entries: {} }, { id: 'library', revision: 2, entries: {} }] },
  ]) {
    const service = createCommandService(createMemoryAdapter());
    const receipt = await commit(service, await fixture(options), 'unknown');
    const state = await service.read();
    const evidence = await collectDeletionEvidence(state.objects, [receipt.sourceBinding]);
    assert.equal(evidence.scopes[0].complete, false);
    assert.ok(evidence.scopes[0].issues.length);
    assert.equal(JSON.stringify(evidence).includes('private'), false);
    await inspectTransfer(await createTransfer(state));
  }
});

test('a historical unbound snapshot never acquires inferred deletion provenance', async () => {
  const service = createCommandService(createMemoryAdapter());
  const input = await fixture(); delete input.sourceInventory;
  await commit(service, input, 'unbound');
  const inspected = await inspectPackage(pkgFor(await service.read()));
  assert.deepEqual(inspected.sourceBindings, []);
  assert.deepEqual((await collectDeletionEvidence((await service.read()).objects, [])).scopes, []);
  await inspectTransfer(await createTransfer(await service.read()));
});

test('later unbound imports cannot borrow earlier deletion provenance or commit an unsafe selection', async () => {
  const service = createCommandService(createMemoryAdapter());
  const first = await commit(service, await fixture({ markers: { 'pl2-library-deleted:erased': '1' } }), 'first');
  const before = await service.read();
  const preview = await service.preview({ libraryId: 'lib', expectedRevision: first.revision, mode: 'import', sourceText: '{"library":[{"id":"different","original":"new"}]}' });
  assert.equal(preview.commitAvailable, false);
  assert.ok(preview.importPlan.deletionReview.blocked.some(issue => issue.code === 'UNBOUND_SOURCE'));
  await assert.rejects(service.apply({ ...preview, idempotencyKey: 'unbound-import' }), { code: 'DELETION_EVIDENCE_UNKNOWN' });
  assert.deepEqual(await service.read(), before);
  const state = await service.read(), inspection = await inspectPackage(pkgFor(state));
  assert.deepEqual(inspection.sourceBindings, [first.sourceBinding]);
  const evidence = await collectDeletionEvidence(state.objects, inspection.sourceBindings);
  assert.equal(evidence.scopes[0].workspaces.length, 1);
  assert.equal(preview.importPlan.manifest.sources.length, 2);
  assert.deepEqual(evidence.scopes[0].deletedIds, ['erased']);
  await inspectTransfer(await createTransfer(state));
});

test('historical inventory remains readable but cannot claim current binding coverage', async () => {
  const input = await fixture();
  const inventory = input.sourceInventory;
  inventory.manifest.schemaVersion = 2;
  const source = inventory.manifest.sources.find(item => item.id === 'local-content');
  const data = structuredClone(inventory.objects[source.hash].data);
  delete data.entries['pl2-recent-artwork'];
  const changed = await makeObject('source-capture', data);
  delete inventory.objects[source.hash]; inventory.objects[changed.hash] = changed.object; source.hash = changed.hash;
  inventory.manifestHash = await hash(inventory.manifest);
  await assert.rejects(createCommandService(createMemoryAdapter()).preview(input), { code: 'SOURCE_BINDING_UNAVAILABLE' });
});

test('different marker captures require different reviews and cannot reuse an operation key', async () => {
  const service = createCommandService(createMemoryAdapter());
  const a = await service.preview(await fixture());
  const b = await service.preview(await fixture({ markers: { 'pl2-library-deleted:erased': '1' } }));
  assert.notEqual(a.sourceBinding, b.sourceBinding); assert.notEqual(a.fingerprint, b.fingerprint);
  await service.apply({ ...a, idempotencyKey: 'once' });
  await assert.rejects(service.apply({ ...b, idempotencyKey: 'once' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.apply({ ...b, idempotencyKey: 'later' }), { code: 'REVISION_CONFLICT' });
});

test('rehashing a binding to another valid workspace fails semantic inspection', async () => {
  const service = createCommandService(createMemoryAdapter());
  const first = await commit(service, await fixture(), 'first');
  const second = await commit(service, { ...await fixture({ content: { library: [{ id: 'another' }] } }), expectedRevision: first.revision }, 'second');
  const state = await service.read();
  const forged = await makeObject('commit', { ...state.objects[second.revision].data, sourceBinding: first.sourceBinding });
  await assert.rejects(inspectPackage({ ...pkgFor(state), head: forged.hash, objects: { ...state.objects, [forged.hash]: forged.object } }), { code: 'SOURCE_BINDING_MISMATCH' });
  state.operations.second.sourceBinding = first.sourceBinding;
  await assert.rejects(createTransfer(state), { code: 'INVALID_TRANSFER' });
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`captured source objects and receipts publish atomically at ${point}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'promptlab-bound-source-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const adapter = await createFolderAdapter(dir, { fault: async phase => { if (phase === point) throw new Error('injected'); } });
    const service = createCommandService(adapter), input = await fixture();
    const preview = await service.preview(input);
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'atomic' }), /injected/);
    const reopened = createCommandService(await createFolderAdapter(dir));
    if (point === 'after-publication') assert.equal((await reopened.apply({ ...preview, idempotencyKey: 'atomic' })).sourceBinding, preview.sourceBinding);
    else {
      assert.equal((await reopened.read()).revision, null);
      await commit(reopened, input, 'atomic');
    }
    const state = await reopened.read();
    assert.equal(Object.keys(state.operations).length, 1);
    const bound = await inspectSourceBinding(state.objects, state.operations.atomic.sourceBinding);
    assert.deepEqual(bound.inventory, input.sourceInventory);
    await inspectTransfer(await createTransfer(state));
  });
}

test('loopback API accepts a bound source capture and exposes the retained objects', async t => {
  const token = 'test-only-scoped-credential'.repeat(2);
  const api = createLocalApi({ adapter: createMemoryAdapter(), libraryId: 'lib', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }] });
  const base = await api.listen(); t.after(() => api.close());
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const reviewed = await post('/v1/library/previews', await fixture());
  assert.equal(reviewed.status, 201); const preview = await reviewed.json();
  const result = await post('/v1/library/commits', preview, { 'Idempotency-Key': 'http-bound' });
  assert.equal(result.status, 201); const receipt = await result.json();
  const object = await fetch(base + '/v1/library/objects/' + receipt.sourceBinding, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(object.status, 200);
  assert.equal((await object.json()).kind, 'source-binding');
});
