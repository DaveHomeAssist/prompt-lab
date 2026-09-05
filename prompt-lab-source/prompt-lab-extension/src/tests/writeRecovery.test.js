import { expect, it } from 'vitest';
import { getPendingWriteCount, retryPendingWrites, writeWithRecovery } from '../lib/writeRecovery.js';

it('orders concurrent writes and does not retain an obsolete failure', async () => {
  let failFirst;
  const gate = new Promise((_resolve, reject) => { failFirst = reject; });
  let persisted = '';
  const first = writeWithRecovery('ordered-record', () => gate);
  const rejected = expect(first).rejects.toThrow('first failed');
  const second = writeWithRecovery('ordered-record', async () => { persisted = 'new value'; });
  failFirst(new Error('first failed'));
  await rejected;
  await second;
  await retryPendingWrites();
  expect(persisted).toBe('new value');
  expect(getPendingWriteCount()).toBe(0);
});

it('keeps a newer failed edit recoverable when an older retry succeeds', async () => {
  let allowOldRetry;
  const gate = new Promise((resolve) => { allowOldRetry = resolve; });
  let firstAttempt = true;
  let persisted = '';
  await expect(writeWithRecovery('retry-record', async () => {
    if (firstAttempt) { firstAttempt = false; throw new Error('original failure'); }
    await gate;
    persisted = 'old value';
  })).rejects.toThrow();
  const retry = retryPendingWrites();
  let failNew = true;
  const newer = writeWithRecovery('retry-record', async () => {
    if (failNew) throw new Error('new failure');
    persisted = 'new value';
  });
  const rejected = expect(newer).rejects.toThrow('new failure');
  allowOldRetry();
  await retry;
  await rejected;
  expect(getPendingWriteCount()).toBe(1);
  failNew = false;
  await retryPendingWrites();
  expect(persisted).toBe('new value');
  expect(getPendingWriteCount()).toBe(0);
});
