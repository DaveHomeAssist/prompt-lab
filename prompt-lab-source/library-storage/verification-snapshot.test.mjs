import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, hash, makeObject, readObject, ownObjectTable, createPackage, inspectPackage } from './contract.mjs';

test('owned verification reads preserve hashes, isolate output and reject later mutable input changes', async () => {
  const made = await makeObject('workspace', { library: [{ id: 'p', original: 'Keep', future: { value: 7 } }] });
  const input = { [made.hash]: made.object }, owned = ownObjectTable(input);
  const expected = canonical(made.object);
  assert.equal(canonical(owned[made.hash]), expected);
  assert.equal(await hash(owned[made.hash]), made.hash);
  assert.ok(Object.isFrozen(owned));
  assert.ok(Object.isFrozen(owned[made.hash].data.library[0].future));
  const result = await readObject(owned, made.hash, 'workspace');
  result.library[0].future.value = 99;
  assert.equal((await readObject(owned, made.hash, 'workspace')).library[0].future.value, 7);
  input[made.hash].data.library[0].original = 'Changed after snapshot';
  assert.equal((await readObject(owned, made.hash, 'workspace')).library[0].original, 'Keep');
  await assert.rejects(readObject(input, made.hash, 'workspace'), { code: 'HASH_MISMATCH' });
  await assert.rejects(readObject(owned, made.hash, 'source'), { code: 'UNSUPPORTED_OBJECT' });
  const wrongAddress = 'sha256:' + '0'.repeat(64);
  await assert.rejects(readObject({ [wrongAddress]: owned[made.hash] }, wrongAddress, 'workspace'), { code: 'HASH_MISMATCH' });
});

test('owned objects reuse only their immutable digest while caller-frozen shallow objects remain untrusted', async () => {
  const made = await makeObject('workspace', { library: [{ id: 'p', original: 'Keep' }] });
  Object.freeze(made.object);
  const owned = ownObjectTable({ [made.hash]: made.object });
  const original = globalThis.crypto.subtle.digest;
  let digests = 0;
  globalThis.crypto.subtle.digest = function (...args) { digests++; return original.apply(this, args); };
  try {
    await readObject(owned, made.hash, 'workspace');
    await readObject(ownObjectTable(owned), made.hash, 'workspace');
    assert.equal(digests, 1);
    made.object.data.library[0].original = 'Caller can still change this child';
    await assert.rejects(readObject({ [made.hash]: made.object }, made.hash, 'workspace'), { code: 'HASH_MISMATCH' });
    assert.equal(digests, 2);
  } finally { globalThis.crypto.subtle.digest = original; }
});

test('input is owned before asynchronous verification and changing getters cannot certify different bytes', async () => {
  const made = await makeObject('workspace', { library: [{ id: 'p', original: 'Before' }] });
  const pending = readObject({ [made.hash]: made.object }, made.hash, 'workspace');
  made.object.data.library[0].original = 'After';
  assert.equal((await pending).library[0].original, 'Before');
  let reads = 0;
  const changing = { schemaVersion: 1, kind: 'workspace', data: {
    get library() { return [{ id: 'p', original: ++reads === 1 ? 'Before' : 'Other bytes' }]; },
  } };
  await assert.rejects(readObject({ [made.hash]: changing }, made.hash, 'workspace'), { code: 'HASH_MISMATCH' });
});

test('fresh package verification detects retained corruption and does not trust a previous inspection', async () => {
  const pkg = await createPackage(JSON.stringify({ library: [{ id: 'p', original: 'Keep' }] }), { libraryId: 'lib', operationId: 'initial' });
  const retained = await makeObject('future', { nested: { value: 'Retain' } });
  pkg.objects[retained.hash] = retained.object;
  const first = inspectPackage(pkg);
  retained.object.data.nested.value = 'Changed during inspection';
  assert.equal((await first).commits, 1);
  await assert.rejects(inspectPackage(pkg), { code: 'HASH_MISMATCH' });
});

test('cached root serialization preserves depth limits and unsupported prototype rejection', async () => {
  class Unsupported { constructor() { this.value = 1; } }
  assert.throws(() => ownObjectTable({ bad: { nested: new Unsupported() } }), { code: 'INVALID_JSON' });
  let deep = null;
  for (let i = 0; i < 128; i++) deep = { next: deep };
  const owned = ownObjectTable({ deep }).deep;
  assert.equal(canonical(owned), canonical(deep));
  assert.throws(() => canonical({ nested: owned }), { code: 'INVALID_JSON' });
  assert.equal(canonical({ '2': true, '10': false }), '{"10":false,"2":true}');
});

test('warm inspection returns independent results and validates every incoming object', async () => {
  const pkg = await createPackage(JSON.stringify({ library: [{ id: 'p', original: 'Keep', future: { value: 7 } }] }), { libraryId: 'warm', operationId: 'initial' });
  const retained = await makeObject('future', { value: 'Retain' });
  pkg.objects[retained.hash] = retained.object;
  const first = await inspectPackage(pkg);
  first.workspace.library[0].future.value = 99;
  first.sourceBindings.push('poison');
  const second = await inspectPackage(structuredClone(pkg));
  assert.equal(second.workspace.library[0].future.value, 7);
  assert.deepEqual(second.sourceBindings, []);
  second.workspace.library.length = 0;
  assert.equal((await inspectPackage(pkg)).workspace.library.length, 1);
  const sourceId = pkg.objects[pkg.head].data.state;
  const changed = structuredClone(pkg);
  changed.objects[sourceId].data.library[0].original = 'Changed';
  await assert.rejects(inspectPackage(changed), { code: 'HASH_MISMATCH' });
  retained.object.data.value = 'Corrupt';
  await assert.rejects(inspectPackage(pkg), { code: 'HASH_MISMATCH' });
});

test('inspection proof is bound to the complete object set and library identity', async () => {
  const pkg = await createPackage(JSON.stringify({ library: [] }), { libraryId: 'set-bound', operationId: 'initial' });
  const first = await inspectPackage(pkg);
  const retained = await makeObject('future', { value: 'Extra' });
  const extra = { ...pkg, objects: { ...pkg.objects, [retained.hash]: retained.object } };
  assert.equal((await inspectPackage(extra)).objectCount, first.objectCount + 1);
  assert.equal((await inspectPackage(pkg)).objectCount, first.objectCount);
  const missing = structuredClone(pkg);
  delete missing.objects[pkg.objects[pkg.head].data.state];
  await assert.rejects(inspectPackage(missing), { code: 'MISSING_OBJECT' });
  await assert.rejects(inspectPackage({ ...pkg, libraryId: 'foreign' }), { code: 'INVALID_ANCESTRY' });
  // Correct hashes do not make a semantically invalid revision valid.
  const forged = await makeObject('commit', { ...pkg.objects[pkg.head].data, operation: 'unknown' });
  await assert.rejects(inspectPackage({ ...pkg, head: forged.hash,
    objects: { ...pkg.objects, [forged.hash]: forged.object } }), { code: 'UNSUPPORTED_OPERATION' });
});

test('warm inspection owns envelope metadata and object bytes before awaiting hashes', async () => {
  const pkg = await createPackage(JSON.stringify({ library: [{ id: 'p', original: 'Before' }] }), { libraryId: 'metadata', operationId: 'initial' });
  await inspectPackage(pkg);
  let libraryReads = 0, headReads = 0;
  const input = { ...pkg,
    get libraryId() { return ++libraryReads === 1 ? pkg.libraryId : 'foreign'; },
    get head() { return ++headReads === 1 ? pkg.head : 'sha256:' + '0'.repeat(64); },
  };
  const pending = inspectPackage(input);
  pkg.objects[pkg.objects[pkg.head].data.state].data.library[0].original = 'After';
  const result = await pending;
  assert.equal(result.libraryId, 'metadata');
  assert.equal(result.workspace.library[0].original, 'Before');
  assert.equal(libraryReads, 1);
  assert.equal(headReads, 1);
  await assert.rejects(inspectPackage(pkg), { code: 'HASH_MISMATCH' });
});
