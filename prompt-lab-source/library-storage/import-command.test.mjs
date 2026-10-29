import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandService, createMemoryAdapter, hash } from './contract.mjs';

const libraryId = 'review-library';
const sourceText = JSON.stringify({ library: [{ id: 'p', title: 'Shared title', original: 'existing', versions: [{ id: 'old', original: 'history' }] }] });
const incoming = JSON.stringify({ library: [{ id: 'p', title: 'Shared title', original: 'incoming', versions: [{ id: 'new-old', original: 'other history' }] }], future: { retained: true } });

async function fixture() {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const p = await service.preview({ libraryId, expectedRevision: null, sourceText });
  const receipt = await service.apply({ ...p, idempotencyKey: 'initial' });
  return { adapter, service, expectedRevision: receipt.revision };
}

test('shared import preview uses the stored revision and keeps both raw histories without publishing', async () => {
  const { adapter, service, expectedRevision } = await fixture();
  const before = adapter.read();
  const p = await service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming });
  assert.equal(p.commitAvailable, false);
  assert.equal(p.importPlan.unresolved, 1);
  assert.equal(p.importPlan.nodes.filter(n => n.kind === 'version').length, 2);
  assert.equal(p.importPlan.sources.existing, await hash(JSON.parse(sourceText)));
  assert.equal(p.importPlan.sources.incoming, await hash(JSON.parse(incoming)));
  await assert.rejects(service.apply({ ...p, idempotencyKey: 'unresolved' }), { code: 'UNRESOLVED_IMPORT' });
  assert.deepEqual(adapter.read(), before);
  assert.equal(await service.operation('unresolved'), null);
});

test('resolved import cannot fall through to snapshot overwrite, even if caller changes response fields', async () => {
  const { adapter, service, expectedRevision } = await fixture();
  const before = adapter.read();
  const p = await service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming, resolutions: { p: { action: 'replace', existingId: 'p' } } });
  const original = structuredClone(p);
  assert.equal(p.importPlan.unresolved, 0);
  assert.equal(p.importPlan.groups[0].members.length, 2);
  p.mode = 'snapshot'; p.commitAvailable = true; p.importPlan.groups.length = 0;
  assert.deepEqual(await service.previewRead(p.previewId), original);
  await assert.rejects(service.apply({ ...p, idempotencyKey: 'unsafe-fallthrough' }), { code: 'IMPORT_APPLY_UNAVAILABLE' });
  assert.deepEqual(adapter.read(), before);
});

test('caller changing choices during async review cannot change the reviewed fingerprint', async () => {
  const { service, expectedRevision } = await fixture();
  const resolutions = { p: { action: 'keep' } };
  const pending = service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming, resolutions });
  resolutions.p.action = 'skip';
  const p = await pending;
  assert.deepEqual(p.importPlan.resolutions, { p: { action: 'keep' } });
  assert.equal(p.fingerprint, await hash({ mode: 'import', libraryId, expectedRevision, sourceText: incoming, resolutions: { p: { action: 'keep' } } }));
  const q = await service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming, resolutions });
  assert.notEqual(p.fingerprint, q.fingerprint);
});

test('review readback and apply reject an intervening commit from another service', async () => {
  const { adapter, service, expectedRevision } = await fixture();
  const p = await service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming });
  const other = createCommandService(adapter);
  const q = await other.preview({ libraryId, expectedRevision, sourceText });
  await other.apply({ ...q, idempotencyKey: 'intervening' });
  const before = adapter.read();
  await assert.rejects(service.previewRead(p.previewId), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.apply({ ...p, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(adapter.read(), before);
});

test('review rechecks its revision after async planning before exposing a token', async () => {
  const { adapter, expectedRevision } = await fixture();
  let reads = 0;
  const service = createCommandService({
    read: async () => {
      const state = adapter.read();
      if (++reads > 1) state.revision = null;
      return state;
    },
    transact: adapter.transact,
  });
  await assert.rejects(service.preview({ mode: 'import', libraryId, expectedRevision, sourceText: incoming }), { code: 'REVISION_CONFLICT' });
  assert.equal(reads, 2);
});

test('review expires without changing storage and cannot be read after service restart', async () => {
  let now = 0;
  const adapter = createMemoryAdapter();
  const service = createCommandService(adapter, { now: () => now, previewLifetimeMs: 10 });
  const p = await service.preview({ mode: 'import', libraryId, expectedRevision: null, sourceText });
  const before = adapter.read();
  now = 10;
  await assert.rejects(service.previewRead(p.previewId), { code: 'PREVIEW_EXPIRED' });
  await assert.rejects(createCommandService(adapter).previewRead(p.previewId), { code: 'PREVIEW_EXPIRED' });
  assert.deepEqual(adapter.read(), before);
});

test('unknown mode cannot silently become a whole-workspace replacement', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  await assert.rejects(service.preview({ mode: 'merge', libraryId, expectedRevision: null, sourceText }), { code: 'INVALID_MODE' });
  assert.equal(adapter.read().revision, null);
});
