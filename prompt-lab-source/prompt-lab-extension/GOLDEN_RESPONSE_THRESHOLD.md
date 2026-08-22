# Golden Response Threshold

What the regression verdict means, and why the default threshold is the value
it is.

- Corpus: `src/corpus/golden-regression-corpus.v1.json`
- Constant: `DEFAULT_GOLDEN_THRESHOLD` in `src/constants.js`
- Tests: `src/tests/goldenThreshold.test.js`

## What the verdict means

When a prompt has a pinned golden response, each enhance run records:

- `goldenScore` — `ngramSimilarity(goldenText, output)`, in `[0, 1]`, or `null`
  when nothing is pinned
- `regression` — `goldenScore !== null && goldenScore < threshold`

Read `regression: true` as **"this output drifted far enough from the pinned
response that it probably lost something"**, not as "this output is wrong". The
score is lexical trigram overlap, not a semantic judgement.

Three properties maintainers can rely on:

- **A run with no pinned golden is never a regression.** `goldenScore` is
  `null`, and the `!== null` guard short-circuits.
- **A score exactly at the threshold is not a regression.** The comparison is
  strictly `<`.
- **The verdict is deterministic.** `ngramSimilarity` is a pure function of the
  two strings, so the same pair always yields the same score and verdict.

## Why 0.7

Not a guess. The corpus takes one golden response and derives candidates whose
relationship to it is known by construction, then measures each:

| Score | Variant | Class |
| --- | --- | --- |
| 1.0000 | identical | acceptable |
| 1.0000 | case shift | acceptable |
| 0.9829 | reordered sentences | acceptable |
| 0.9016 | whitespace reflow | acceptable |
| **0.8750** | synonym swap | **acceptable floor** |
| **0.5948** | dropped constraints | **regression ceiling** |
| 0.4612 | truncated half | regression |
| 0.3060 | dropped role and format | regression |
| 0.1356 | unrelated topic | regression |
| 0.0966 | terse rewrite | regression |
| 0.0000 | empty | regression |

Nothing scores between **0.5948** and **0.8750**. Any threshold inside that
empty band classifies every measured case correctly.

`0.7` sits inside it with 0.105 of margin above the regression ceiling and
0.175 below the acceptable floor. The margin matters: a threshold technically
inside the band but hugging an edge would start misclassifying under small
scoring changes, so a test requires at least 0.05 on each side.

## What the tests protect

`goldenThreshold.test.js` fails if:

- any recorded score stops matching what `ngramSimilarity` actually returns
- the separation band collapses — a regression scoring as high as any
  acceptable variant, which would mean *no* single threshold can be correct
- `DEFAULT_GOLDEN_THRESHOLD` leaves the band, or loses its margin
- a boundary case flips: a score exactly at the threshold, or a run with no
  pinned golden

So the threshold cannot quietly stop being meaningful. If similarity scoring
changes, this suite fails and the value has to be re-justified against fresh
measurements rather than nudged.

## Per-prompt overrides

A library entry may carry its own `goldenThreshold`, which takes precedence
over the default. Overrides are not covered by this corpus — a prompt whose
acceptable outputs legitimately vary more (or less) than the corpus assumes
should carry its own value, justified the same way.

## Re-measuring

Change the corpus when the golden or candidates change, then run the suite: it
reports any recorded score that no longer matches. Bump the corpus `version`
and add a new file when a change would invalidate comparisons already gathered
under the old one.

```bash
cd prompt-lab-source/prompt-lab-extension
npx vitest run src/tests/goldenThreshold.test.js
```

The suite is part of the default `npm test` run and needs no setup or secrets.
