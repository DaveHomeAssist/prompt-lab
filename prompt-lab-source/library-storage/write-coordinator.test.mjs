import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLibraryWriteCoordinator } from '../prompt-lab-extension/src/lib/libraryWriteCoordinator.js';

const gate = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('drain waits for registered work and its nested asynchronous completion', async () => {
  const c = createLibraryWriteCoordinator(), first = gate(), second = gate();
  const events = [];
  const write = c.run(async permit => {
    await first.promise;
    await c.run(async () => { await second.promise; events.push('committed'); }, { parent: permit });
  });
  const capture = c.withPausedWrites(() => { events.push('read'); return 'snapshot'; });
  first.resolve(); await delay(0);
  assert.deepEqual(events, []);
  second.resolve(); await write;
  const result = await capture;
  assert.deepEqual(events, ['committed', 'read']);
  assert.equal(result.value, 'snapshot');
  assert.equal(result.coordination.writesDrained, 2);
  assert.equal(result.coordination.scope, 'current-context');
  assert.equal(result.coordination.activationReady, false);
  assert.deepEqual(c.status(), { paused: false, active: 0, unresolved: 0 });
});

test('a refused concurrent write invalidates capture even when its caller catches the error', async () => {
  const c = createLibraryWriteCoordinator(), reader = gate();
  const capture = c.withPausedWrites(async () => { await reader.promise; return 'mixed'; });
  assert.throws(() => c.assertWritable(), { code: 'LIBRARY_WRITES_PAUSED' });
  reader.resolve();
  await assert.rejects(capture, { code: 'LIBRARY_CAPTURE_CHANGED' });
  c.assertWritable();
});

test('failed writes block later capture until their successful retry', async () => {
  const c = createLibraryWriteCoordinator();
  await assert.rejects(c.run(() => { throw new Error('quota'); }, { key: 'record:one' }));
  let reads = 0;
  await assert.rejects(c.withPausedWrites(() => ++reads), { code: 'LIBRARY_WRITES_PENDING' });
  assert.equal(reads, 0);
  await c.run(() => 'saved', { key: 'record:one' });
  assert.equal((await c.withPausedWrites(() => ++reads)).value, 1);
});

test('a failed drain is not repaired into a successful same-attempt capture', async () => {
  const c = createLibraryWriteCoordinator(), pending = gate();
  const first = c.run(() => pending.promise, { key: 'same' });
  const second = c.run(async () => { await first.catch(() => {}); }, { key: 'same' });
  const failed = assert.rejects(first);
  const capture = c.withPausedWrites(() => assert.fail('must not read'));
  pending.reject(new Error('failed')); await failed; await second;
  await assert.rejects(capture, { code: 'LIBRARY_WRITES_PENDING' });
  assert.equal((await c.withPausedWrites(() => 'retry')).value, 'retry');
});

test('reader timeout holds the pause until the reader settles', async () => {
  const c = createLibraryWriteCoordinator(), pending = gate();
  let signal;
  const capture = c.withPausedWrites(async options => { signal = options.signal; await pending.promise; }, { timeoutMs: 10 });
  await delay(25);
  assert.equal(signal.aborted, true);
  assert.equal(c.status().paused, true);
  pending.resolve();
  await assert.rejects(capture, { code: 'LIBRARY_CAPTURE_TIMEOUT' });
  assert.equal(c.status().paused, false);
});

test('drain timeout does not invoke the reader or cancel an existing write', async () => {
  const c = createLibraryWriteCoordinator(), pending = gate();
  const write = c.run(() => pending.promise);
  await assert.rejects(c.withPausedWrites(() => assert.fail('must not read'), { timeoutMs: 10 }), { code: 'LIBRARY_CAPTURE_TIMEOUT' });
  assert.deepEqual(c.status(), { paused: false, active: 1, unresolved: 0 });
  pending.resolve('saved');
  assert.equal(await write, 'saved');
});

test('synchronous nesting permits do not leak across await or survive completion', async () => {
  const c = createLibraryWriteCoordinator(), pending = gate();
  let savedPermit;
  const work = c.run(async permit => { savedPermit = permit; await pending.promise; c.withPermit(permit, () => c.assertWritable()); });
  const capture = c.withPausedWrites(() => 'read');
  assert.throws(() => c.assertWritable(), { code: 'LIBRARY_WRITES_PAUSED' });
  pending.resolve(); await work;
  await assert.rejects(capture, { code: 'LIBRARY_CAPTURE_CHANGED' });
  assert.throws(() => c.withPermit(savedPermit, () => assert.fail('expired')));
});

test('overlapping capture, false acknowledgements and reader failure fail honestly', async () => {
  const c = createLibraryWriteCoordinator(), pending = gate();
  const first = c.withPausedWrites(() => pending.promise);
  await assert.rejects(c.withPausedWrites(() => null), { code: 'LIBRARY_CAPTURE_BUSY' });
  pending.reject(new Error('reader failed')); await assert.rejects(first, /reader failed/);
  await assert.rejects(c.run(() => false, { key: 'session' }), { code: 'LIBRARY_WRITE_FAILED' });
  await assert.rejects(c.withPausedWrites(() => null), { code: 'LIBRARY_WRITES_PENDING' });
  await c.run(() => true, { key: 'session' });
  assert.equal((await c.withPausedWrites(() => 'okay')).value, 'okay');
});
