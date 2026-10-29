import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash, createPackage, inspectPackage, createMemoryAdapter, createCommandService } from './contract.mjs';

// Deliberately raw: UI normalizers must not construct the input or expected result.
const workspace = () => ({
  schemaVersion: 2, unknownRoot: { future: ['preserve', null, 0] },
  library: [{ id: 'p1', original: '$& {{input}}', future: { nested: true }, versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `version ${i}`, extra: i })) }],
  trash: [{ id: 'p2', deletedAt: '2026-10-01', unknown: 'retained' }],
  collections: ['Work'], folders: [{ id: 'f1', name: 'Work' }], packs: { pack1: { provenance: 'synthetic' } },
  assets: { a1: { base64: 'AAH/', mime: 'application/octet-stream' } },
  scratch: { pads: [{ id: 'pad1', content: 'notes', recovery: 'old notes' }] },
  runs: [{ id: 'run1', promptId: 'p1', promptVersionId: 'v0', missingReference: 'case-missing' }],
  testCases: [{ id: 'case1', promptId: 'p1', input: 'test' }], evaluations: [{ id: 'eval1', runId: 'run1' }],
  markers: { deleted: ['p3'], generation: '7' }, backups: [{ name: 'before-import', hash: 'unavailable-but-recorded' }],
});
const source = () => JSON.stringify(workspace(), null, 2) + '\n';
const initialPackage = () => createPackage(source(), { libraryId: 'library1', operationId: 'initial', createdAt: '2026-10-28T00:00:00Z' });

test('canonical bytes are independent of property insertion order with fixed hash vector', async () => {
  assert.equal(canonical({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(await hash({ b: 2, a: 1 }), 'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});

test('raw workspace round trip preserves all 41 versions, unknown fields, associations and exact source text', async () => {
  const result = await inspectPackage(await initialPackage());
  assert.deepEqual(result.workspace, workspace());
  assert.equal(result.workspace.library[0].versions.length, 41);
  assert.equal(result.sourceText, source());
});

test('tampered and unavailable objects fail closed', async () => {
  const pkg = await initialPackage();
  const commit = pkg.objects[pkg.head].data;
  const corrupt = structuredClone(pkg);
  corrupt.objects[commit.state].data.library = [];
  await assert.rejects(inspectPackage(corrupt), { code: 'HASH_MISMATCH' });
  delete pkg.objects[commit.state];
  await assert.rejects(inspectPackage(pkg), { code: 'MISSING_OBJECT' });
});

test('future package versions and missing ancestry are explicit failures, not partial success', async () => {
  const pkg = await initialPackage();
  await assert.rejects(inspectPackage({ ...pkg, schemaVersion: 99 }), { code: 'UNSUPPORTED_PACKAGE' });
  const child = await createPackage(source(), { libraryId: 'library1', operationId: 'child', parents: [pkg.head] });
  await assert.rejects(inspectPackage(child), { code: 'MISSING_OBJECT' });
  child.objects = { ...pkg.objects, ...child.objects };
  assert.equal((await inspectPackage(child)).commits, 2);
});

test('excluded stores fail before a transfer; unsupported JSON does not get silently coerced', async () => {
  for (const key of ['settings', 'provider_settings', 'API_KEYS', 'pl2-billing', 'pl2-session-pl2-session']) {
    await assert.rejects(createPackage(JSON.stringify({ ...workspace(), [key]: {} }), { libraryId: 'l', operationId: 'o' }), { code: 'EXCLUDED_STORE' });
  }
  for (const input of [undefined, Infinity, new Date(), [, 1], { nested: undefined }]) assert.throws(() => canonical(input), { code: 'INVALID_JSON' });
});

async function apply(service, preview, key = 'op1') {
  return service.apply({ ...preview, idempotencyKey: key });
}

test('committed receipt and checkpoint survive service restart and response loss without a second commit', async () => {
  const adapter = createMemoryAdapter();
  const service = createCommandService(adapter);
  const p = await service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  const receipt = await apply(service, p);
  const restartedAdapter = createMemoryAdapter(adapter.read());
  const restarted = createCommandService(restartedAdapter);
  assert.deepEqual(await apply(restarted, p), receipt);
  assert.deepEqual(await restarted.operation('op1'), receipt);
  assert.equal(Object.keys(restartedAdapter.read().operations).length, 1);
  const next = await restarted.preview({ libraryId: 'library1', expectedRevision: receipt.revision, sourceText: source() });
  await apply(restarted, next, 'op2');
  assert.deepEqual(restartedAdapter.read().checkpoints, [receipt.revision]);
});

test('stale preview and altered retry leave the complete prior state unchanged', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const p = await service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  const q = await service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  await apply(service, p);
  const before = adapter.read();
  await assert.rejects(apply(service, q, 'op2'), { code: 'REVISION_CONFLICT' });
  await assert.rejects(apply(service, { ...p, fingerprint: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(adapter.read(), before);
});

test('expiry, wrong identity and unsupported conflict choices never publish', async () => {
  let now = 0;
  const adapter = createMemoryAdapter(), service = createCommandService(adapter, { now: () => now, previewLifetimeMs: 10 });
  const p = await service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  await assert.rejects(apply(service, { ...p, libraryId: 'other' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source(), resolutions: { p1: 'replace' } }), { code: 'UNSUPPORTED_RESOLUTION' });
  now = 10;
  await assert.rejects(apply(service, p), { code: 'PREVIEW_EXPIRED' });
  assert.equal(adapter.read().revision, null);
});

test('prototype-named operation keys are ordinary data and concurrent identical retries commit once', async () => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const p = await service.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  const [a, b] = await Promise.all([apply(service, p, '__proto__'), apply(service, p, '__proto__')]);
  assert.deepEqual(a, b);
  assert.equal((await service.operation('__proto__')).revision, a.revision);
  assert.equal(await service.operation('toString'), null);
});

test('separate service instances sharing an adapter cannot lose a committed write', async () => {
  const adapter = createMemoryAdapter();
  const first = createCommandService(adapter), second = createCommandService(adapter);
  const p = await first.preview({ libraryId: 'library1', expectedRevision: null, sourceText: source() });
  const q = await second.preview({ libraryId: 'library1', expectedRevision: null, sourceText: JSON.stringify({ ...workspace(), marker: 'other writer' }) });
  const results = await Promise.allSettled([apply(first, p, 'first'), apply(second, q, 'second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const state = adapter.read();
  assert.equal(Object.keys(state.operations).length, 1);
  assert.equal(state.revision, results.find(result => result.status === 'fulfilled').value.revision);
});

test('commit identities reject schema-invalid types and ancestry before archiving', async () => {
  for (const override of [
    { libraryId: 42 }, { operationId: {} }, { operationId: 'x'.repeat(201) },
    { parents: [null] }, { parents: ['not-a-content-hash'] }, { createdAt: 'not-a-date' },
  ]) {
    await assert.rejects(createPackage(source(), { libraryId: 'l', operationId: 'o', ...override }), { code: 'INVALID_IDENTITY' });
  }
});
