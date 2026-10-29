import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveExperiment, getExperimentById, saveEvalRun, getEvalRunById, patchEvalRun,
  saveTestCase, listTestCases, saveRunRecord, listRunsByTrace } from '../experimentStore.js';
import { normalizeResultMeta } from '../lib/enhancementResult.js';
import { normalizeEntry } from '../lib/promptSchema.js';
import { storageKeys } from '../lib/storage.js';
import { retryPendingWrites, getPendingWriteCount } from '../lib/writeRecovery.js';

vi.mock('../lib/legacyLibraryMigration.js', async () => ({
  ...await vi.importActual('../lib/legacyLibraryMigration.js'), shouldAttemptLegacyWebMigration: () => false,
}));
import usePromptLibrary from '../hooks/usePromptLibrary.js';

const long = 'Complete source text. '.repeat(1200);
const metadata = () => ({ future: { nested: [null, false, 0, 'retained'] },
  candidates: Array.from({ length: 24 }, (_, i) => ({ id: `candidate-${i}`, label: `Candidate ${i}`, content: long, future: i })),
  changes: Array.from({ length: 24 }, (_, i) => ({ id: `change-${i}`, label: `Change ${i}`, type: 'added', future: i })),
  assumptions: Array.from({ length: 24 }, (_, i) => ({ id: `assumption-${i}`, text: `Assumption ${i}`, future: i })),
  reversibleEdits: Array.from({ length: 24 }, (_, i) => ({ id: `edit-${i}`, label: `Edit ${i}`, before: '', after: `After ${i}`, future: i })),
  usage: { input: 1, output: 2, total: 3, future: { cache: 7 } } });

describe('complete app history retention', () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it.each([
    ['experiments', 'pl2-experiment-fallback', 500, saveExperiment, row => ({ id: row, label: row })],
    ['evaluations', 'pl2-eval-run-fallback', 1000, saveEvalRun, row => ({ id: row, input: row })],
    ['cases', 'pl2-test-case-fallback', 1000, saveTestCase, row => ({ id: row, promptId: 'p', input: row })],
    ['traces', 'pl2-run-fallback', 1000, saveRunRecord, row => ({ run_id: row, trace_id: 'trace', outputs: { text: row } })],
  ])('saving %s retains every record beyond the former fallback cap', async (_name, key, count, save, fixture) => {
    const previous = Array.from({ length: count + 1 }, (_, i) => fixture(`old-${i}`));
    localStorage.setItem(key, JSON.stringify(previous));
    await save(fixture('new'));
    const saved = JSON.parse(localStorage.getItem(key));
    expect(saved).toHaveLength(count + 2);
    expect(saved.slice(1)).toEqual(previous);
  });

  it('saves and patches complete evaluation text, candidates and nested metadata', async () => {
    const input = { ...metadata(), id: 'run', promptId: 'p', input: long, output: long, notes: long,
      reasoning: long, changeSummary: long, selectedCandidateId: 'candidate-23',
      traitResults: { verdict: 'pass', future: 7, passedTraits: Array.from({ length: 24 }, (_, i) => `Trait ${i}`) } };
    await saveEvalRun(input);
    await patchEvalRun('run', { verdict: 'pass' });
    const saved = await getEvalRunById('run');
    for (const key of ['input', 'output', 'notes', 'reasoning', 'changeSummary', 'future', 'candidates', 'usage']) expect(saved[key]).toEqual(input[key]);
    for (const key of ['changes', 'assumptions', 'reversibleEdits']) {
      expect(saved[key]).toHaveLength(24); expect(saved[key][23].future).toBe(23);
    }
    expect(saved.traitResults.future).toBe(7); expect(saved.traitResults.passedTraits).toHaveLength(24);
    expect(saved.selectedCandidateId).toBe('candidate-23');
  });

  it('retains complete experiment inputs and cases through the public stores', async () => {
    const experiment = { id: 'experiment', label: 'Complete', keyInputSnapshot: long, notes: long, future: { retained: true } };
    await saveExperiment(experiment);
    expect(await getExperimentById('experiment')).toEqual(expect.objectContaining(experiment));
    const record = { id: 'case', promptId: 'p', input: long, notes: long, future: ['retained'],
      expectedTraits: Array.from({ length: 24 }, (_, i) => `Trait ${i}`), expectedExclusions: Array.from({ length: 24 }, (_, i) => `Exclude ${i}`) };
    await saveTestCase(record);
    expect((await listTestCases({ limit: null }))[0]).toEqual(expect.objectContaining(record));
    await saveRunRecord({ run_id: 'run', trace_id: 'trace', outputs: { text: long }, future: 7 });
    expect((await listRunsByTrace('trace'))[0]).toEqual({ run_id: 'run', trace_id: 'trace', outputs: { text: long }, future: 7 });
  });

  it('preserves complete result metadata through prompt normalization', () => {
    const input = metadata();
    const result = normalizeResultMeta(input);
    const prompt = normalizeEntry({ id: 'p', original: 'Prompt', resultMeta: result });
    for (const key of ['candidates', 'changes', 'assumptions', 'reversibleEdits']) {
      expect(prompt.resultMeta[key]).toHaveLength(24);
      expect(prompt.resultMeta[key][23].future).toBe(23);
    }
    expect(prompt.resultMeta.future).toEqual(input.future);
    expect(prompt.resultMeta.usage).toEqual(input.usage);
  });

  it('rejects quota failure without pruning old records and retries the same save', async () => {
    const previous = Array.from({ length: 1001 }, (_, i) => ({ id: `old-${i}`, input: 'History' }));
    const raw = JSON.stringify(previous); localStorage.setItem('pl2-eval-run-fallback', raw);
    const original = Storage.prototype.setItem;
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function(key, value) {
      if (key === 'pl2-eval-run-fallback') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    await expect(saveEvalRun({ id: 'pending', input: long })).rejects.toThrow();
    expect(localStorage.getItem('pl2-eval-run-fallback')).toBe(raw);
    expect(getPendingWriteCount()).toBeGreaterThan(0);
    failure.mockRestore(); await retryPendingWrites();
    expect(JSON.parse(localStorage.getItem('pl2-eval-run-fallback'))).toHaveLength(1002);
    expect((await getEvalRunById('pending')).input).toBe(long);
  });

  it('retains old Trash at startup and across reopen, then restores its complete history', async () => {
    const row = { id: 'old-trash', original: 'Still recoverable', deletedAt: '2020-01-01T00:00:00Z',
      versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: i })), future: ['retained'] };
    localStorage.setItem(storageKeys.library, '[]'); localStorage.setItem(storageKeys.trash, JSON.stringify([row]));
    const first = renderHook(() => usePromptLibrary(vi.fn()));
    await waitFor(() => expect(first.result.current.libReady).toBe(true));
    expect(first.result.current.trash).toHaveLength(1);
    await waitFor(() => expect(JSON.parse(localStorage.getItem(storageKeys.trash))[0].versions).toHaveLength(41));
    first.unmount();
    const second = renderHook(() => usePromptLibrary(vi.fn()));
    await waitFor(() => expect(second.result.current.libReady).toBe(true));
    act(() => second.result.current.restoreDeleted('old-trash'));
    expect(second.result.current.library[0]).toEqual(expect.objectContaining({ id: row.id, original: row.original, future: row.future }));
    expect(second.result.current.library[0].versions).toHaveLength(41);
    expect(localStorage.getItem('pl2-library-deleted:old-trash')).toBeNull();
  });
});
