# Screenflow repair acceptance

Scope: SF-01 through SF-04 from the October 30, 2026 hosted app audit.
These repairs preserve the current screen organization and local data model.

- SF-01: Load shared content only after restoring the prior session. Preserve
  the displaced draft through the existing recovery action. Clear its editing
  identity, version, collection and provenance before opening a new save.
  A failed recovery write must leave the prior draft untouched.
- SF-02: Preserve recognized workspace routes and shared payload fragments
  through both sign in and sign up. Normalize path links and reject unsupported
  fragments and protocols. Preserve existing upgrade and billing return behavior.
- SF-03: Stop an active test-case batch from any workspace. Abort the current
  request, skip remaining cases, retain completed results, record the canceled
  attempt and display partial completion. Always release the run gate, including
  when results refresh fails. Canceled suites must not claim a passing verdict.
- SF-04: Flush the latest draft on refresh and page exit before the debounce.
  Surface failed storage acknowledgements, retain the draft, warn on unsafe exit
  and allow retry. Do not checkpoint an empty startup state over a restored draft.

Exclusions: navigation redesign, screen taxonomy, provider or billing changes,
new persistence schemas, native installer releases and unrelated issue closure.

Verification uses disposable fixtures and mocked provider responses. It does
not require paid inference. Source, CI, production deployment, runtime behavior
and human acceptance remain separate evidence gates.

## Delivery evidence, November 2, 2026

PR #311 merged as `8a13ce3ee1a8ccf51619f167bdfe34392cb7b0dd` after all 16
checks passed on `df2615f9817954c98c3c34e2c4dfdf974d2850dc`. Remote main was
verified. Vercel production `dpl_HWVRNZVxJPgEw5jRrJiASQw8rRja` is READY on
that merge with the `promptlab.tools` alias.

- Source CI: 1,732 tests across 150 files and 231 legacy tests passed.
- Hosted CI: 118 browser cases passed, one existing case skipped; 25 landing
  browser cases passed.
- All six Desktop Build jobs passed, including MSI, NSIS, DEB and AppImage
  acceptance and macOS universal packaging with native diagnostics.
- [Production smoke](https://github.com/DaveHomeAssist/prompt-lab/actions/runs/41443801045):
  2/2 cases passed at 375x812 and 1440x900 on GitHub Ubuntu runners. Both
  disposable authentication sessions were revoked.

| Requirement | Acceptance evidence | Limits |
| --- | --- | --- |
| SF-01 | Unit tests cover failed preservation and distinct identity. Hosted browser cases cover cold, live and repeated links. Production verifies separate save, original unchanged and restored displaced draft. | Synthetic records only. |
| SF-02 | Redirect tests cover workspace, path and encoded shared links for sign in and sign up, rejected destinations, and preserved upgrade/billing returns. | No manual social OAuth enrollment. |
| SF-03 | Unit tests cover abort, late success, reset, unrelated editor history and failed history refresh. Hosted browser cases verify Stop after navigation, retained completed/canceled history and partial summary after reload. | Mocked provider responses; no paid cancellation run. |
| SF-04 | Unit tests cover exit flush, failed and stale asynchronous acknowledgments. Hosted and production cases verify immediate refresh, visible quota failure, retained buffer and retry/reload. | Browser lifecycle coverage, not native power-loss acceptance. |

Post-merge CI remains separately tracked. The source repairs and scoped
production smoke do not establish global product readiness, installed upgrade,
signing or human acceptance. No navigation redesign or new product scope.
