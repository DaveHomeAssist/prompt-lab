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
