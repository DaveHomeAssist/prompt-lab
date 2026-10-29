import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommandService, createMemoryAdapter, LibraryError } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createCommandOutbox, inspectOutboxEntry } from './command-outbox.mjs';
import { createServiceTransport, createLoopbackTransport } from './command-client.mjs';
import { createLocalApi } from './local-api.mjs';
import { createTransfer } from './transfer.mjs';

// Transactional test double only. Production has no volatile fallback.
function memoryStore(initial = []) {
  const rows = new Map(initial.map(row => [JSON.stringify([row.libraryId, row.operationId]), structuredClone(row)]));
  return {
    rows, failure: null,
    async read(libraryId, operationId) { return structuredClone(rows.get(JSON.stringify([libraryId, operationId])) ?? null); },
    async list(libraryId) { return structuredClone([...rows.values()].filter(row => row.libraryId === libraryId)); },
    async write(row, version) {
      if (this.failure?.(row)) throw new LibraryError('OUTBOX_WRITE_FAILED', 'Synthetic rejected transaction.', 503);
      const key = JSON.stringify([row.libraryId, row.operationId]);
      if ((rows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Concurrent change.', 409);
      rows.set(key, structuredClone(row));
    },
  };
}
const content = () => ({ library: [{ id: 'p', original: 'Original $& {{input}}', future: { kept: true },
  versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}` })) }],
  runs: Array.from({ length: 1002 }, (_, i) => ({ id: `r${i}`, future: i })), backups: [{ name: 'Retained' }] });
async function fixture({ mode = 'snapshot', libraryId = 'lib', operationId = 'op', service, store } = {}) {
  service ??= createCommandService(createMemoryAdapter()); store ??= memoryStore();
  const transport = createServiceTransport(service, { libraryId });
  const request = { libraryId, expectedRevision: (await service.read()).revision, mode, sourceText: JSON.stringify(content()) };
  if (mode === 'import') {
    const entries = { 'pl2-library': JSON.stringify(content().library), 'pl2-library-trash': '[]' };
    request.sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'outbox-test-origin',
      localStorage: { length: 2, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic absent store.' }),
      archives: { reviewed: true, records: [] }, capturedAt: '2026-10-29T00:00:00Z' });
  }
  const review = await transport.preview(request), outbox = createCommandOutbox(store);
  return { service, store, transport, request, review, outbox, operationId };
}
const enqueue = f => f.outbox.enqueue({ request: f.request, review: f.review, operationId: f.operationId });

test('complete queued input survives reconstruction and response loss without another commit', async () => {
  const f = await fixture(); const queued = await enqueue(f);
  assert.equal(queued.state, 'pending'); assert.equal((await f.service.read()).revision, null);
  const clone = memoryStore(await f.store.list('lib')), restarted = createCommandOutbox(clone);
  await assert.rejects(restarted.replay('lib', 'op', { ...f.transport, apply: async input => {
    await f.transport.apply(input); throw new Error('Synthetic response loss');
  } }));
  const committedState = await f.service.read();
  const saved = await createCommandOutbox(clone).replay('lib', 'op', createServiceTransport(createCommandService(createMemoryAdapter(committedState)), { libraryId: 'lib' }));
  assert.equal(saved.state, 'committed'); assert.equal(saved.receipt.revision, committedState.revision);
  assert.deepEqual(JSON.parse(saved.request.sourceText), content());
  assert.deepEqual(await f.service.read(), committedState);
  assert.equal((await restarted.list('lib')).length, 1);
});

test('queue persistence failure never sends or acknowledges a pending command', async () => {
  const f = await fixture(); f.store.failure = () => true;
  await assert.rejects(enqueue(f), { code: 'OUTBOX_WRITE_FAILED' });
  assert.deepEqual(await f.outbox.list('lib'), []); assert.equal((await f.service.read()).revision, null);
  f.store.failure = null; await enqueue(f);
  assert.equal((await f.outbox.replay('lib', 'op', f.transport)).state, 'committed');
});

test('failed durable receipt storage retains the command and retries by operation readback', async () => {
  const f = await fixture(); await enqueue(f);
  f.store.failure = row => row.state === 'committed';
  await assert.rejects(f.outbox.replay('lib', 'op', f.transport), { code: 'OUTBOX_WRITE_FAILED' });
  const before = await f.service.read(); assert.equal((await f.outbox.read('lib', 'op')).state, 'failed');
  f.store.failure = null;
  const saved = await f.outbox.replay('lib', 'op', { ...f.transport, preview() { throw new Error('Must read the receipt'); } });
  assert.equal(saved.receipt.revision, before.revision); assert.deepEqual(await f.service.read(), before);
});

test('expired previews recreate exactly the reviewed decision after service restart', async () => {
  const service = createCommandService(createMemoryAdapter(), { now: () => 0, previewLifetimeMs: 1 });
  const f = await fixture({ service });
  f.outbox = createCommandOutbox(f.store, { now: () => 0 }); await enqueue(f);
  const transport = createServiceTransport(createCommandService(createMemoryAdapter(await service.read())), { libraryId: 'lib' });
  assert.equal((await createCommandOutbox(f.store).replay('lib', 'op', transport)).state, 'committed');
});

test('unreviewed, expired, changed or credential-bearing input never enters the queue', async () => {
  const f = await fixture();
  for (const review of [{ ...f.review, commitAvailable: false }, { ...f.review, expiresAt: 0 }]) {
    await assert.rejects(f.outbox.enqueue({ request: f.request, review, operationId: 'op' }));
  }
  await assert.rejects(f.outbox.enqueue({ request: { ...f.request, sourceText: '{"library":[]}' }, review: f.review, operationId: 'op' }), { code: 'REVIEW_CHANGED' });
  await assert.rejects(f.outbox.enqueue({ request: { ...f.request, token: 'synthetic credential' }, review: f.review, operationId: 'op' }), { code: 'INVALID_COMMAND' });
  assert.deepEqual(await f.outbox.list('lib'), []);
});

test('wrong destination and a stale base never silently rebase or send a commit', async () => {
  const f = await fixture(); await enqueue(f); let sent = 0;
  await assert.rejects(f.outbox.replay('lib', 'op', { ...f.transport, identity: async () => ({ libraryId: 'other', revision: null }), apply: async () => sent++ }), { code: 'WRONG_LIBRARY' });
  const foreign = await f.service.preview({ ...f.request, sourceText: '{"library":[]}' });
  await f.service.apply({ ...foreign, idempotencyKey: 'other' }); const before = await f.service.read();
  await assert.rejects(f.outbox.replay('lib', 'op', f.transport), { code: 'REVISION_CONFLICT' });
  assert.equal(sent, 0); assert.deepEqual(await f.service.read(), before);
  assert.equal((await f.outbox.read('lib', 'op')).request.sourceText, f.request.sourceText);
});

test('changed preview results and mismatched receipts preserve the pending command', async () => {
  const f = await fixture(); await enqueue(f);
  await assert.rejects(f.outbox.replay('lib', 'op', { ...f.transport, preview: async input => ({ ...await f.transport.preview(input), futurePolicy: 'changed' }) }), { code: 'REVIEW_CHANGED' });
  await assert.rejects(f.outbox.replay('lib', 'op', { ...f.transport, operation: async () => ({ operationId: 'another' }) }), { code: 'RECEIPT_MISMATCH' });
  assert.equal((await f.service.read()).revision, null);
  assert.equal((await f.outbox.read('lib', 'op')).state, 'failed');
});

test('concurrent outbox instances share one identity and preserve committed receipts', async () => {
  const f = await fixture(); const other = createCommandOutbox(f.store);
  const args = { request: f.request, review: f.review, operationId: 'op' };
  const queued = await Promise.all([f.outbox.enqueue(args), other.enqueue(args)]);
  assert.deepEqual(queued[0], queued[1]);
  const saved = await Promise.all([f.outbox.replay('lib', 'op', f.transport), other.replay('lib', 'op', f.transport)]);
  assert.deepEqual(saved[0].receipt, saved[1].receipt);
  assert.equal(Object.keys((await f.service.read()).operations).length, 1);
});

test('operation identities are library scoped and conflicting reuse is rejected', async () => {
  const f = await fixture(); await enqueue(f);
  const request = { ...f.request, sourceText: '{"library":[]}' }, review = await f.transport.preview(request);
  await assert.rejects(f.outbox.enqueue({ request, review, operationId: 'op' }), { code: 'IDEMPOTENCY_CONFLICT' });
  const other = await fixture({ libraryId: 'other', store: f.store }); await enqueue(other);
  assert.equal((await f.outbox.list('lib')).length, 1); assert.equal((await f.outbox.list('other')).length, 1);
  assert.notDeepEqual((await f.outbox.list('lib'))[0], (await f.outbox.list('other'))[0]);
});

test('corrupt and legacy outbox records are retained without replay', async () => {
  const f = await fixture(); const queued = await enqueue(f);
  await assert.rejects(inspectOutboxEntry({ ...queued, request: { ...queued.request, sourceText: '{"library":[]}' } }), { code: 'OUTBOX_CORRUPT' });
  await assert.rejects(inspectOutboxEntry({ ...queued, schemaVersion: 1 }), { code: 'INVALID_OUTBOX' });
  assert.deepEqual(await f.outbox.read('lib', 'op'), queued);
});

test('import, current selection, restore and reconciliation use the same durable boundary', async () => {
  const f = await fixture({ mode: 'import' }); await enqueue(f); await f.outbox.replay('lib', 'op', f.transport);
  const imported = await f.service.read();
  for (const [mode, extra] of [['select', {}], ['restore', { checkpointId: imported.revision }]]) {
    const request = { mode, libraryId: 'lib', expectedRevision: (await f.service.read()).revision, ...extra };
    const review = await f.transport.preview(request);
    // Restore targets a retained pre-selection checkpoint after the first iteration.
    await f.outbox.enqueue({ request, review, operationId: mode });
    assert.equal((await f.outbox.replay('lib', mode, f.transport)).receipt.operation, mode);
  }
  const branch = createCommandService(createMemoryAdapter(imported));
  const branchPreview = await branch.previewCurrentView({ libraryId: 'lib', expectedRevision: imported.revision });
  await branch.apply({ ...branchPreview, idempotencyKey: 'branch-select' });
  const request = { mode: 'reconcile', libraryId: 'lib', expectedRevision: (await f.service.read()).revision, incoming: await createTransfer(await branch.read()) };
  const review = await f.transport.preview(request);
  await f.outbox.enqueue({ request, review, operationId: 'reconcile' });
  assert.equal((await f.outbox.replay('lib', 'reconcile', f.transport)).receipt.operation, 'reconcile');
  assert.equal((await f.outbox.list('lib')).length, 4);
});

test('real HTTP transport keeps tokens out of the outbox and survives revocation/reconnect', async t => {
  const credential = { token: 'synthetic-secret-'.repeat(4), scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 };
  const adapter = createMemoryAdapter(), api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential] });
  const baseUrl = await api.listen(); t.after(() => api.close());
  const transport = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => credential.token });
  const f = await fixture({ service: api.service }); f.transport = transport; await enqueue(f);
  credential.revoked = true;
  await assert.rejects(f.outbox.replay('lib', 'op', transport), { code: 'UNAUTHORIZED' });
  assert.equal((await adapter.read()).revision, null);
  assert.equal(JSON.stringify(await f.outbox.list('lib')).includes(credential.token), false);
  credential.revoked = false; transport.disconnect();
  await assert.rejects(f.outbox.replay('lib', 'op', transport), { code: 'DISCONNECTED' });
  const connected = createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => credential.token });
  const result = await f.outbox.replay('lib', 'op', connected);
  assert.equal(result.state, 'committed'); assert.deepEqual(await connected.operation('op'), result.receipt);
  assert.equal((await connected.identity()).revision, result.receipt.revision);
});

test('transport rejects other hosts, credentials in URLs and redirects', async () => {
  for (const baseUrl of ['http://localhost:1234', 'http://192.168.1.1:1234', 'https://127.0.0.1:1234', 'http://user:secret@127.0.0.1:1234', 'http://127.0.0.1:1234/?token=secret']) {
    assert.throws(() => createLoopbackTransport({ baseUrl, libraryId: 'lib', getToken: () => 'x'.repeat(40) }));
  }
  let options;
  const transport = createLoopbackTransport({ baseUrl: 'http://127.0.0.1:1234', libraryId: 'lib', getToken: () => 'x'.repeat(40), fetchImpl: async (_url, opts) => {
    options = opts; throw new Error('Transport failure containing sensitive details');
  } });
  await assert.rejects(transport.identity(), { code: 'SERVICE_UNAVAILABLE' });
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
});

test('credential lookup, stalled response and disconnect all have a bounded failure', async () => {
  const options = { baseUrl: 'http://127.0.0.1:1234', libraryId: 'lib', timeoutMs: 20, getToken: () => 'x'.repeat(40) };
  const waitingForToken = createLoopbackTransport({ ...options, getToken: () => new Promise(() => {}) });
  await assert.rejects(waitingForToken.identity(), { code: 'SERVICE_UNAVAILABLE' });
  const stalled = createLoopbackTransport({ ...options, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) });
  await assert.rejects(stalled.identity(), { code: 'SERVICE_UNAVAILABLE' });
  const disconnected = createLoopbackTransport({ ...options, timeoutMs: 1000, getToken: () => new Promise(() => {}) });
  const pending = disconnected.identity(); disconnected.disconnect();
  await assert.rejects(pending, { code: 'DISCONNECTED' });
});

test('a review expiring during validation cannot be acknowledged as pending', async () => {
  const f = await fixture(); let checks = 0;
  const outbox = createCommandOutbox(f.store, { now: () => ++checks < 3 ? f.review.expiresAt - 1 : f.review.expiresAt });
  await assert.rejects(outbox.enqueue({ request: f.request, review: f.review, operationId: 'expired' }), { code: 'REVIEW_REQUIRED' });
  assert.deepEqual(await f.outbox.list('lib'), []);
});

test('direct transport cannot apply to a library other than its bound identity', async () => {
  const f = await fixture();
  assert.throws(() => f.transport.apply({ ...f.review, libraryId: 'other', idempotencyKey: 'other' }), { code: 'WRONG_LIBRARY' });
  assert.equal((await f.service.read()).revision, null);
});
