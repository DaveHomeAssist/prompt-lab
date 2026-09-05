import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteTestCase,
  getEvalRunById,
  listExperiments,
  listEvalRuns,
  listRunsByTrace,
  listTestCases,
  saveEvalRun,
  saveExperiment,
  saveRunRecord,
  saveTestCase,
} from '../experimentStore.js';
import { getPendingWriteCount, retryPendingWrites } from '../lib/writeRecovery.js';

beforeEach(() => localStorage.clear());
afterEach(async () => {
  vi.restoreAllMocks();
  await retryPendingWrites();
});

describe('fallback write acknowledgment', () => {
  it.each([
    ['run', () => saveRunRecord({ run_id: 'trace-run', trace_id: 'trace' })],
    ['experiment', () => saveExperiment({ id: 'experiment', label: 'Comparison' })],
    ['eval run', () => saveEvalRun({ id: 'eval', input: 'input', output: 'output' })],
    ['test case', () => saveTestCase({ id: 'case', promptId: 'prompt', input: 'input' })],
    ['test case deletion', () => deleteTestCase('case')],
  ])('rejects a failed %s write', async (_label, write) => {
    const stored = JSON.stringify([{ id: 'case', promptId: 'prompt', input: 'keep me' }]);
    localStorage.setItem('pl2-test-case-fallback', stored);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await expect(write()).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(localStorage.getItem('pl2-test-case-fallback')).toBe(stored);
    expect(localStorage.getItem('pl2-eval-run-signal')).toBeNull();
  });

  it('acknowledges successful writes and upserts stable record IDs', async () => {
    for (let i = 0; i < 2; i += 1) {
      await saveRunRecord({ run_id: 'trace-run', trace_id: 'trace' });
      await saveExperiment({ id: 'experiment', label: 'Comparison' });
      await saveEvalRun({ id: 'eval', input: 'input', output: 'output' });
      await saveTestCase({ id: 'case', promptId: 'prompt', input: 'input' });
    }
    expect(await listRunsByTrace('trace')).toHaveLength(1);
    expect(await listExperiments()).toHaveLength(1);
    expect(await getEvalRunById('eval')).toMatchObject({ id: 'eval', output: 'output' });
    expect(await listTestCases()).toHaveLength(1);
    await deleteTestCase('case');
    expect(await listTestCases()).toEqual([]);
  });

  it('retains a generated run identity and retries only one local write', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await expect(saveEvalRun({ input: 'source', output: 'completed response' })).rejects.toThrow();
    expect(getPendingWriteCount()).toBe(1);
    spy.mockRestore();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    await Promise.all([retryPendingWrites(), retryPendingWrites()]);
    expect(getPendingWriteCount()).toBe(0);
    const saved = await listEvalRuns();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ output: 'completed response' });
    expect(writes.mock.calls.filter(([key]) => key === 'pl2-eval-run-fallback')).toHaveLength(1);
    await retryPendingWrites();
    expect((await listEvalRuns())[0].id).toBe(saved[0].id);
  });

  it('does not replay a failed update after a newer successful write or deletion', async () => {
    await saveTestCase({ id: 'case', promptId: 'prompt', input: 'original' });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(saveTestCase({ id: 'case', promptId: 'prompt', input: 'stale update' })).rejects.toThrow();
    spy.mockRestore();
    await deleteTestCase('case');
    await retryPendingWrites();
    expect(getPendingWriteCount()).toBe(0);
    expect(await listTestCases()).toEqual([]);
  });
});
