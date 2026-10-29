import test from 'node:test';
import assert from 'node:assert/strict';
import { createFolderReadCache } from './folder-read-cache.mjs';
import { canonical, makeObject, MAX_BYTES } from './contract.mjs';

const row = (objects, revision = 'first') => ({ schemaVersion: 2, parents: [], future: { keep: true }, state: {
  libraryId: 'test', revision, objects, operations: { first: { future: [null, false, 0] } }, checkpoints: ['earlier'], future: { keep: 'metadata' },
} });
const remember = (cache, name, value, digest = name) => cache.remember(name, digest, value, Buffer.byteLength(canonical(value)));

test('legacy files share verified content within the unchanged byte budget and retain every other field', async () => {
  const object = await makeObject('future', { text: 'x'.repeat(2000) }), cache = createFolderReadCache({ kind: '', maxBytes: 24000 });
  let originalBytes = 0;
  for (let i = 0; i < 4; i++) {
    const value = row({ [object.hash]: structuredClone(object.object) }, String(i));
    const expected = canonical(value); originalBytes += Buffer.byteLength(expected);
    const saved = await remember(cache, String(i), value);
    assert.equal(canonical(saved), expected);
    assert.ok(Object.isFrozen(saved.state.operations.first.future));
  }
  assert.ok(originalBytes * 3 > 24000, 'The old whole-file estimate cannot retain this fixture');
  assert.equal(cache.usage().entries, 4);
  assert.equal(cache.usage().sharedObjects, 1);
  assert.ok(cache.usage().bytes <= 24000);
  assert.strictEqual(cache.get('0', '0').state.objects[object.hash], cache.get('3', '3').state.objects[object.hash]);
  assert.throws(() => { cache.get('0', '0').state.objects[object.hash].data.text = 'changed'; }, TypeError);
  assert.equal(cache.get('0', 'different actual bytes'), undefined);
});

test('a repeated object address cannot repair or conceal different incoming content', async () => {
  const object = await makeObject('future', { keep: true }), cache = createFolderReadCache({ kind: '' });
  await remember(cache, 'first', row({ [object.hash]: object.object }));
  const before = cache.usage();
  await assert.rejects(remember(cache, 'bad', row({ [object.hash]: { ...object.object, data: { keep: false } } })), { code: 'HASH_MISMATCH' });
  await assert.rejects(remember(cache, 'bad-new', row({ ['sha256:' + '0'.repeat(64)]: object.object })), { code: 'HASH_MISMATCH' });
  assert.deepEqual(cache.usage(), before);
  assert.equal(cache.get('bad', 'bad'), undefined);
  assert.equal(cache.get('first', 'first').state.objects[object.hash].data.keep, true);
});

test('eviction releases shared content only after its last referring entry leaves', async () => {
  const a = await makeObject('future', { text: 'a' }), b = await makeObject('future', { text: 'b' });
  const cache = createFolderReadCache({ kind: '', maxEntries: 2 });
  await remember(cache, '1', row({ [a.hash]: a.object }));
  await remember(cache, '2', row({ [a.hash]: a.object }));
  await remember(cache, '3', row({ [b.hash]: b.object }));
  assert.equal(cache.usage().sharedObjects, 2);
  assert.equal(cache.get('1', '1'), undefined);
  await remember(cache, '4', row({ [b.hash]: b.object }));
  assert.equal(cache.usage().sharedObjects, 1);
  await remember(cache, '5', row({}));
  await remember(cache, '6', row({}));
  assert.equal(cache.usage().sharedObjects, 0);
  assert.ok(cache.usage().bytes > 0 && cache.usage().bytes < MAX_BYTES);
});

test('replacement and simultaneous preparation retain one counted immutable object', async () => {
  const object = await makeObject('future', { text: 'same' }), cache = createFolderReadCache({ kind: '', maxEntries: 2 });
  await Promise.all(['1', '2'].map(name => remember(cache, name, row({ [object.hash]: structuredClone(object.object) }, name))));
  assert.equal(cache.usage().sharedObjects, 1);
  assert.strictEqual(cache.get('1', '1').state.objects[object.hash], cache.get('2', '2').state.objects[object.hash]);
  const value = row({ [object.hash]: object.object }, 'replacement');
  await remember(cache, '1', value, 'new-bytes');
  assert.equal(cache.get('1', '1'), undefined);
  assert.equal(cache.get('1', 'new-bytes').state.revision, 'replacement');
  assert.equal(cache.usage().entries, 2);
  assert.equal(cache.usage().sharedObjects, 1);
});

test('oversized entries remain readable without retaining their shared content or exceeding the cache budget', async () => {
  const object = await makeObject('future', { text: 'large'.repeat(1000) }), cache = createFolderReadCache({ kind: '', maxBytes: 1000 });
  const value = row({ [object.hash]: object.object }), expected = canonical(value);
  assert.equal(canonical(await remember(cache, 'large', value)), expected);
  assert.equal(cache.get('large', 'large'), undefined);
  assert.deepEqual(cache.usage(), { bytes: 0, entries: 0, sharedObjects: 0 });
});

test('byte-budget eviction releases unused content and counts only the retained references', async () => {
  const a = await makeObject('future', { text: 'a'.repeat(2000) }), b = await makeObject('future', { text: 'b'.repeat(2000) });
  const cache = createFolderReadCache({ kind: '', maxBytes: 17000 }), onlyB = createFolderReadCache({ kind: '', maxBytes: 17000 });
  await remember(cache, 'a', row({ [a.hash]: a.object }));
  await remember(cache, 'b', row({ [b.hash]: b.object }));
  await remember(onlyB, 'b', row({ [b.hash]: b.object }));
  assert.equal(cache.get('a', 'a'), undefined);
  assert.deepEqual(cache.usage(), onlyB.usage());
  assert.equal(cache.usage().entries, 1);
  assert.equal(cache.usage().sharedObjects, 1);
  const before = cache.usage();
  await remember(cache, 'too-large-together', row({ [a.hash]: a.object, [b.hash]: b.object }));
  assert.equal(cache.get('too-large-together', 'too-large-together'), undefined);
  assert.deepEqual(cache.usage(), before);
  assert.ok(cache.get('b', 'b'));
});

test('generic files and generation one metadata retain their exact values and bounded accounting', async () => {
  const cache = createFolderReadCache({ kind: 'receipt', maxEntries: 1 });
  const receipt = { future: { values: [1, false, null] } };
  await remember(cache, 'receipt', receipt);
  assert.deepEqual(cache.get('receipt', 'receipt'), receipt);
  assert.ok(Object.isFrozen(cache.get('receipt', 'receipt').future.values));
  await remember(cache, 'next', { retained: true });
  assert.equal(cache.get('receipt', 'receipt'), undefined);
  const object = await makeObject('future', { value: 7 }), legacy = createFolderReadCache({ kind: '' });
  const value = { ...row({ [object.hash]: object.object }), schemaVersion: 1, parent: null }; delete value.parents;
  assert.equal(canonical(await remember(legacy, 'legacy', value)), canonical(value));
  assert.equal(legacy.get('legacy', 'legacy').parent, null);
  for (const options of [{ maxBytes: MAX_BYTES + 1 }, { maxBytes: -1 }, { maxEntries: 129 }, { maxEntries: NaN }]) {
    assert.throws(() => createFolderReadCache(options), { code: 'INVALID_CACHE' });
  }
});
