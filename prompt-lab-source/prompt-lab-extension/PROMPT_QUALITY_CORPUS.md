# Prompt Quality Corpus

A small, versioned set of representative raw prompts, each carrying the
objective properties `scorePrompt` and `lintPrompt` should produce for it.

- Corpus: `src/corpus/prompt-quality-corpus.v1.json`
- Loader: `src/lib/promptCorpus.js`
- Tests: `src/tests/promptCorpus.test.js`

## What makes the expectations objective

Each case records computed values, not prose judgements:

- the five `scorePrompt` signals — `role`, `task`, `format`, `constraints`,
  `context` — as booleans, plus the integer `points` they sum to
- the sorted list of lint rule ids `lintPrompt` fires
- the variables `extractVars` finds

Every recorded value was produced by running the real functions. The test suite
asserts them back, so a change to scoring or lint fails the corpus rather than
silently invalidating it.

`validatePromptCorpus()` additionally checks the file's own internal
consistency — including that each case's `points` matches the signals it
claims — so a malformed case reports as a shape problem instead of surfacing
as a confusing scoring failure.

## Selection criteria

The corpus is deliberately small. Each case earns its place against one of
these, and its `rationale` field records which:

1. **Span the score range.** At least one case at every `points` value from 1
   to 5.
2. **Span the lint range.** At least one case firing no rules, and one firing
   every rule the corpus knows about.
3. **Isolate each signal.** For each of the five signals, at least one case
   where it is the *only* signal present. This is what stops `points` from
   being read as a quality verdict on its own — four different cases score 1/5
   for four different reasons.
4. **Exercise templating.** At least one prompt with `{{variables}}`.
5. **Stay safe to run anywhere.** No user data, no credentials, no
   provider-specific text. A test asserts no case contains credential-shaped or
   address-shaped strings.

Criteria 1–4 are enforced by tests, not just documented — the coverage block in
`promptCorpus.test.js` fails if a future edit breaks any of them.

## Cases

| id | Points | Lint rules fired |
| --- | --- | --- |
| `bare-fragment` | 1 | constraints, goal_near_top, output_format |
| `role-only` | 1 | constraints, goal_near_top, output_format |
| `constraints-only` | 1 | goal_near_top, output_format |
| `format-only` | 1 | constraints, goal_near_top |
| `long-prose-no-role` | 1 | constraints, goal_near_top, output_format, role_definition |
| `task-no-structure` | 2 | constraints, output_format |
| `format-json-strict` | 3 | — |
| `templated-vars` | 4 | — |
| `complete-well-formed` | 5 | — |

## Versioning

The corpus carries an explicit integer `version`, and the filename encodes it
(`prompt-quality-corpus.v1.json`). Adding or amending cases within a version is
fine while the recorded expectations stay truthful. Introduce a new file and
bump the version when a change would invalidate comparisons against results
already gathered under the old one — that is what keeps regression thresholds
measured against a known corpus revision.

## Pairing with the provider fixture

Cases can carry a `[[fixture:name]]` marker in their prompt to pin a scenario
from the deterministic provider fixture (see `PROVIDER_FIXTURE.md`), so one
fixture instance can drive the whole corpus through success, failure,
cancellation, and boundary paths without a paid provider call.

## Running

```bash
cd prompt-lab-source/prompt-lab-extension
npx vitest run src/tests/promptCorpus.test.js
```

The corpus suite is part of the default `npm test` run and therefore of the
`extension-tests` CI job. It needs no setup and no secrets.
