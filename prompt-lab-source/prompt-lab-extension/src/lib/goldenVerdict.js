import { DEFAULT_GOLDEN_THRESHOLD } from '../constants.js';

/**
 * The Golden Response regression verdict, in one place.
 *
 * This logic used to be inlined at its single call site, which meant the
 * threshold tests could only assert against their own copy of the comparison:
 * they would still pass if the product switched to `<=`, changed its fallback,
 * or stopped computing the verdict at all. Both the product and the tests now
 * call these functions, so the boundary cases are pinned against what ships.
 *
 * See `GOLDEN_RESPONSE_THRESHOLD.md` for why the default is the value it is.
 */

/**
 * Resolve the threshold for an entry: its own override when it carries a usable
 * one, otherwise the documented default.
 */
export function resolveGoldenThreshold(entry) {
  return Number.isFinite(entry?.goldenThreshold)
    ? entry.goldenThreshold
    : DEFAULT_GOLDEN_THRESHOLD;
}

/**
 * Whether a run counts as a regression.
 *
 * Two boundaries matter and are deliberate:
 * - a run with no pinned golden (`score === null`) is never a regression
 * - a score exactly at the threshold is acceptable — the comparison is `<`
 */
export function isGoldenRegression(score, threshold = DEFAULT_GOLDEN_THRESHOLD) {
  return score !== null && Number.isFinite(score) && score < threshold;
}
