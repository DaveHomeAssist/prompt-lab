import { describe, expect, it } from 'vitest';
import { checkTraits } from '../promptUtils.js';
import { filterEvalRuns, normalizeEvalRunRecord, normalizeTraitResults } from '../lib/evalSchema.js';

describe('checkTraits', () => {
  it('passes when all traits are present and no exclusions hit', () => {
    const result = checkTraits('The answer includes a JSON schema and a summary.', ['json schema', 'summary'], ['lorem']);
    expect(result.verdict).toBe('pass');
    expect(result.passedTraits).toEqual(['json schema', 'summary']);
    expect(result.failedTraits).toEqual([]);
    expect(result.excludedHits).toEqual([]);
  });

  it('fails when a trait is missing', () => {
    const result = checkTraits('Only a summary here.', ['json schema', 'summary'], []);
    expect(result.verdict).toBe('fail');
    expect(result.failedTraits).toEqual(['json schema']);
    expect(result.passedTraits).toEqual(['summary']);
  });

  it('fails when an exclusion appears in the output', () => {
    const result = checkTraits('Contains lorem ipsum filler.', ['lorem'], ['ipsum']);
    expect(result.verdict).toBe('fail');
    expect(result.excludedHits).toEqual(['ipsum']);
  });

  it('supports slash-wrapped regex traits case-insensitively', () => {
    expect(checkTraits('Step 3: done', ['/step \\d+/'], []).verdict).toBe('pass');
    expect(checkTraits('no numbered steps', ['/step \\d+/'], []).verdict).toBe('fail');
  });

  it('degrades invalid regex traits to literal matching', () => {
    expect(checkTraits('literal /foo(/ text', ['/foo(/'], []).verdict).toBe('pass');
    expect(checkTraits('nothing to see', ['/foo(/'], []).verdict).toBe('fail');
  });

  it('returns a null verdict when there is nothing to check', () => {
    expect(checkTraits('any output', [], []).verdict).toBeNull();
  });

  it('matches traits case-insensitively', () => {
    expect(checkTraits('RESPONSE FORMAT: markdown', ['response format'], []).verdict).toBe('pass');
  });
});

describe('evalSchema trait results and regression', () => {
  it('normalizes trait results and drops empty ones', () => {
    expect(normalizeTraitResults(null)).toBeNull();
    expect(normalizeTraitResults({})).toBeNull();
    expect(normalizeTraitResults({ verdict: 'nonsense' })).toBeNull();
    const normalized = normalizeTraitResults({ passedTraits: ['a', '', 2], failedTraits: ['b'], excludedHits: [], verdict: 'fail' });
    expect(normalized).toEqual({ passedTraits: ['a', '2'], failedTraits: ['b'], excludedHits: [], verdict: 'fail' });
  });

  it('round-trips traitResults and regression through normalizeEvalRunRecord', () => {
    const record = normalizeEvalRunRecord({
      traitResults: { passedTraits: ['x'], failedTraits: [], excludedHits: [], verdict: 'pass' },
      regression: true,
    });
    expect(record.traitResults.verdict).toBe('pass');
    expect(record.regression).toBe(true);
    expect(normalizeEvalRunRecord({}).traitResults).toBeNull();
    expect(normalizeEvalRunRecord({}).regression).toBe(false);
  });

  it('filters by automated verdict, preferring traitResults over manual verdicts', () => {
    const rows = [
      { id: 'a', traitResults: { passedTraits: ['t'], failedTraits: [], excludedHits: [], verdict: 'pass' } },
      { id: 'b', traitResults: { passedTraits: [], failedTraits: ['t'], excludedHits: [], verdict: 'fail' }, verdict: 'pass' },
      { id: 'c', verdict: 'fail' },
      { id: 'd' },
    ];
    expect(filterEvalRuns(rows, { verdict: 'pass', dateRange: '' }).map((row) => row.id)).toEqual(['a']);
    expect(filterEvalRuns(rows, { verdict: 'fail', dateRange: '' }).map((row) => row.id).sort()).toEqual(['b', 'c']);
    expect(filterEvalRuns(rows, { dateRange: '' })).toHaveLength(4);
  });

  it('filters regressions only when requested', () => {
    const rows = [
      { id: 'a', regression: true },
      { id: 'b' },
    ];
    expect(filterEvalRuns(rows, { regression: true, dateRange: '' }).map((row) => row.id)).toEqual(['a']);
    expect(filterEvalRuns(rows, { regression: false, dateRange: '' })).toHaveLength(2);
  });
});
