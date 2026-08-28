import { describe, it, expect } from 'vitest';
import { normalizeEvalRunRecord, normalizeTestCaseRecord, filterEvalRuns } from '../lib/evalSchema.js';

describe('normalizeEvalRunRecord', () => {
  it('fills defaults for minimal input', () => {
    const record = normalizeEvalRunRecord({ input: 'hello' });
    expect(record.id).toBeTruthy();
    expect(record.input).toBe('hello');
    expect(record.status).toBe('success');
    expect(record.provider).toBe('unknown');
  });

  it('preserves error status', () => {
    const record = normalizeEvalRunRecord({ status: 'error', input: 'x' });
    expect(record.status).toBe('error');
  });

  it('clamps latencyMs to non-negative integer', () => {
    expect(normalizeEvalRunRecord({ latencyMs: -5 }).latencyMs).toBe(0);
    expect(normalizeEvalRunRecord({ latencyMs: 123.7 }).latencyMs).toBe(124);
  });
});

describe('normalizeTestCaseRecord', () => {
  it('normalizes traits and exclusions', () => {
    const record = normalizeTestCaseRecord({
      input: 'test',
      expectedTraits: ['concise', '', null, 'clear'],
      expectedExclusions: ['verbose'],
    });
    expect(record.expectedTraits).toEqual(['concise', 'clear']);
    expect(record.expectedExclusions).toEqual(['verbose']);
  });
});

describe('filterEvalRuns', () => {
  const runs = [
    { id: '1', createdAt: '2024-01-01T00:00:00Z', mode: 'enhance', provider: 'anthropic', model: 'claude-1', status: 'success', promptTitle: 'Test', input: 'hi', output: 'hey' },
    { id: '2', createdAt: '2024-01-02T00:00:00Z', mode: 'ab', provider: 'openai', model: 'gpt-4o', status: 'error', promptTitle: 'AB', input: 'a', output: 'b' },
  ];

  it('filters by mode', () => {
    expect(filterEvalRuns(runs, { mode: 'ab' })).toHaveLength(1);
  });

  it('filters by search', () => {
    expect(filterEvalRuns(runs, { search: 'AB' })).toHaveLength(1);
  });

  it('filters by model', () => {
    expect(filterEvalRuns(runs, { model: 'gpt-4o' })).toHaveLength(1);
    expect(filterEvalRuns(runs, { model: 'claude-1' })[0].id).toBe('1');
  });

  it('filters by status', () => {
    expect(filterEvalRuns(runs, { status: 'error' })).toHaveLength(1);
    expect(filterEvalRuns(runs, { status: 'success' })[0].id).toBe('1');
  });

  it('sorts by createdAt descending', () => {
    const result = filterEvalRuns(runs);
    expect(result[0].id).toBe('2');
  });

  // M-2: Evaluate offers a verdict select and a regression toggle. Both are
  // honoured here, but nothing covered them, so the panel could quietly drop
  // them on the way to this function without a single test going red.
  describe('verdict and regression filters', () => {
    const verdictRuns = [
      { id: 'manual-pass', createdAt: '2024-01-01T00:00:00Z', verdict: 'pass', input: 'a', output: 'b' },
      { id: 'manual-fail', createdAt: '2024-01-02T00:00:00Z', verdict: 'fail', input: 'a', output: 'b' },
      { id: 'unrated', createdAt: '2024-01-03T00:00:00Z', input: 'a', output: 'b' },
      { id: 'regressed', createdAt: '2024-01-04T00:00:00Z', verdict: 'fail', regression: true, input: 'a', output: 'b' },
    ];

    it('filters by manual verdict', () => {
      expect(filterEvalRuns(verdictRuns, { verdict: 'pass' }).map((r) => r.id)).toEqual(['manual-pass']);
      expect(filterEvalRuns(verdictRuns, { verdict: 'fail' }).map((r) => r.id))
        .toEqual(['regressed', 'manual-fail']);
    });

    it('leaves the set untouched when no verdict is selected', () => {
      expect(filterEvalRuns(verdictRuns, { verdict: '' })).toHaveLength(4);
    });

    it('prefers an automated trait verdict over the manual rating', () => {
      const rows = [
        { id: 'trait-overrides', createdAt: '2024-01-01T00:00:00Z', verdict: 'fail', traitResults: { verdict: 'pass' }, input: 'a', output: 'b' },
      ];
      expect(filterEvalRuns(rows, { verdict: 'pass' }).map((r) => r.id)).toEqual(['trait-overrides']);
      expect(filterEvalRuns(rows, { verdict: 'fail' })).toHaveLength(0);
    });

    it('narrows to regressions only when the toggle is on', () => {
      expect(filterEvalRuns(verdictRuns, { regression: true }).map((r) => r.id)).toEqual(['regressed']);
      expect(filterEvalRuns(verdictRuns, { regression: false })).toHaveLength(4);
    });

    it('combines the verdict and regression filters', () => {
      expect(filterEvalRuns(verdictRuns, { verdict: 'fail', regression: true }).map((r) => r.id))
        .toEqual(['regressed']);
      expect(filterEvalRuns(verdictRuns, { verdict: 'pass', regression: true })).toHaveLength(0);
    });
  });

  it('returns every retained run for lossless workspace export', () => {
    const completeHistory = Array.from({ length: 1005 }, (_, index) => ({
      id: `run-${index}`,
      createdAt: new Date(2024, 0, 1, 0, 0, index).toISOString(),
      input: 'input',
      output: 'output',
    }));
    expect(filterEvalRuns(completeHistory, { limit: null })).toHaveLength(1005);
    expect(filterEvalRuns(completeHistory, { limit: 'all' })).toHaveLength(1005);
  });

  it('filters by date range', () => {
    const now = Date.now();
    const recentRuns = [
      { id: 'recent', createdAt: new Date(now - (2 * 24 * 60 * 60 * 1000)).toISOString(), mode: 'enhance', provider: 'openai', model: 'gpt-4o', promptTitle: 'Recent', input: 'x', output: 'y' },
      { id: 'old', createdAt: new Date(now - (45 * 24 * 60 * 60 * 1000)).toISOString(), mode: 'enhance', provider: 'openai', model: 'gpt-4o', promptTitle: 'Old', input: 'x', output: 'y' },
    ];
    expect(filterEvalRuns(recentRuns, { dateRange: '7d' }).map((run) => run.id)).toEqual(['recent']);
    expect(filterEvalRuns(recentRuns, { dateRange: '30d' }).map((run) => run.id)).toEqual(['recent']);
  });
});
