import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteTestCase,
  getEvalRunById,
  listExperiments,
  listRunsByTrace,
  listTestCases,
  saveEvalRun,
  saveExperiment,
  saveRunRecord,
  saveTestCase,
} from '../experimentStore.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

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
});
