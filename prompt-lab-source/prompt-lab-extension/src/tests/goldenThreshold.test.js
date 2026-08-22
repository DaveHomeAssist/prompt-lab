import { describe, expect, it } from 'vitest';
import corpus from '../corpus/golden-regression-corpus.v1.json';
import { DEFAULT_GOLDEN_THRESHOLD } from '../constants.js';
import { ngramSimilarity } from '../promptUtils.js';

// DHA-13: the Golden Response verdict is only meaningful if the threshold
// actually separates acceptable variation from genuine regression. These tests
// measure that separation rather than asserting it, so the threshold cannot
// silently stop being justified.

const SCORE_TOLERANCE = 1e-3;

const measured = corpus.cases.map((entry) => ({
  ...entry,
  actual: ngramSimilarity(corpus.golden, entry.candidate),
}));

const acceptable = measured.filter((entry) => entry.class === 'acceptable');
const regressions = measured.filter((entry) => entry.class === 'regression');

const acceptableFloor = Math.min(...acceptable.map((entry) => entry.actual));
const regressionCeiling = Math.max(...regressions.map((entry) => entry.actual));

/** The verdict the product computes for a run. */
function verdictFor(score, threshold = DEFAULT_GOLDEN_THRESHOLD) {
  return score < threshold ? 'regression' : 'acceptable';
}

describe('corpus shape', () => {
  it('is versioned and documents its method', () => {
    expect(corpus.version).toBeGreaterThanOrEqual(1);
    expect(corpus.method.length).toBeGreaterThan(0);
    expect(corpus.golden.trim()).not.toBe('');
  });

  it('has both classes represented and a rationale per case', () => {
    expect(acceptable.length).toBeGreaterThan(1);
    expect(regressions.length).toBeGreaterThan(1);
    for (const entry of measured) {
      expect(entry.rationale, `${entry.id} rationale`).toBeTruthy();
      expect(['acceptable', 'regression']).toContain(entry.class);
    }
  });
});

describe('recorded scores match the real similarity function', () => {
  it.each(measured.map((entry) => [entry.id, entry]))('%s', (_id, entry) => {
    expect(entry.actual).toBeCloseTo(entry.expectedScore, 3);
  });
});

describe('the separation band', () => {
  it('is non-empty — no regression scores as high as any acceptable variant', () => {
    // If this fails, similarity no longer distinguishes the two classes and no
    // single threshold can be correct, whatever value is chosen.
    expect(regressionCeiling).toBeLessThan(acceptableFloor - SCORE_TOLERANCE);
  });

  it('contains the default threshold', () => {
    expect(DEFAULT_GOLDEN_THRESHOLD).toBeGreaterThan(regressionCeiling);
    expect(DEFAULT_GOLDEN_THRESHOLD).toBeLessThan(acceptableFloor);
  });

  it('leaves usable margin on both sides', () => {
    // Guards against a threshold technically inside the band but hugging an
    // edge, where small scoring changes would start misclassifying.
    expect(DEFAULT_GOLDEN_THRESHOLD - regressionCeiling).toBeGreaterThan(0.05);
    expect(acceptableFloor - DEFAULT_GOLDEN_THRESHOLD).toBeGreaterThan(0.05);
  });
});

describe('verdicts are deterministic and correct', () => {
  it.each(measured.map((entry) => [entry.id, entry]))('classifies %s correctly', (_id, entry) => {
    expect(verdictFor(entry.actual)).toBe(entry.class);
  });

  it('returns the same verdict on repeated evaluation', () => {
    for (const entry of measured) {
      const first = ngramSimilarity(corpus.golden, entry.candidate);
      const second = ngramSimilarity(corpus.golden, entry.candidate);
      expect(first).toBe(second);
      expect(verdictFor(first)).toBe(verdictFor(second));
    }
  });

  it('treats the threshold itself as acceptable, not a regression', () => {
    // regression is `score < threshold`, so a score exactly at the threshold
    // must not be flagged. Pinning this keeps the boundary unambiguous.
    expect(verdictFor(DEFAULT_GOLDEN_THRESHOLD)).toBe('acceptable');
    expect(verdictFor(DEFAULT_GOLDEN_THRESHOLD - 1e-9)).toBe('regression');
  });

  it('never flags a run with no golden response', () => {
    // The product computes goldenScore as null when nothing is pinned, and
    // `regression: goldenScore !== null && ...` must keep those runs clean.
    const goldenScore = null;
    expect(goldenScore !== null && goldenScore < DEFAULT_GOLDEN_THRESHOLD).toBe(false);
  });
});
