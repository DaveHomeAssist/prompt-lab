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
