# Release Gates

Last verified: 2026-09-04 against `main` (v1.7.1).

This supersedes and retires the 2026-08-05 release checklist. That checklist
was pinned to commit `07e2964` and to the five-stage monolith branch
(`work/prompt-lab-product-improvements-2026-08-05`), whose PR #27 was archived
as tag `archive/pr27-product-improvements-monolith-20260809` and re-landed on
`main` in smaller pieces. Its grep gates also targeted identifiers the shipped
code never used (`pipelineId`, `nextStage`, `carryOutput`, `REDIS_URL`), so
they passed green regardless of reality. Do not run it again.

## Automated gates

Run before tagging a release, and on any PR that touches versions, telemetry,
dependencies, or the prompt library schema:

```bash
node scripts/release-gates.mjs
```

Exit 0 means every gate passed (warnings allowed); exit 1 means at least one
gate failed. The script asserts verified facts, not guesses:

| Gate | Asserts | Why |
| --- | --- | --- |
| G1 | All 8 version declarations agree (root, extension package + both manifests, desktop package, `tauri.conf.json`, `Cargo.toml`, web) | A partial bump ships artifacts labeled with the wrong release |
| G2 | No `@upstash` dependency in any `package.json` | Redis is reached over REST via `UPSTASH_REDIS_REST_URL` / `KV_REST_API_*` env vars only |
| G3 | `createDefaultTelemetryState()` sets `telemetryEnabled: false` | Telemetry is strictly opt-in; a flipped default contradicts the privacy policy |
| G4 | `PRIVACY_POLICY.md` keeps its Telemetry section | The policy must disclose telemetry for as long as the feature exists |
| G5 | `normalizeLibrary` round-trips `metadata.chain` and `isChainEntry` accepts the result | Chain Lab stores chains on library entries; a schema whitelist change could silently strip them |
| W1 | Warns while `docs/CNAME` still exists | Open decision below |

Maintenance rule: a gate greps or imports the real identifiers in the tree.
When a feature renames something a gate checks, update the gate in the same
PR. Never add a gate for an identifier you have not confirmed exists.

## Manual gates (cannot be scripted)

- Desktop artifacts at the tagged version are signed, or the release notes
  state they are unsigned. Version numbers alone do not prove signing.
- Installer smoke test runs in a separate Windows user account only; never
  the primary profile.
- `docs-links` and `markdown-lint` are green on the release PR. Local lint
  passing does not predict CI lint passing.

## Open decisions carried forward

- **Pages custom domain** — approved 2026-08-05, still unexecuted: delete
  `docs/CNAME` (`promptlab.tools`) from `main` so the Pages mirror stops
  claiming the domain served by Vercel. Do not disable Pages itself. W1
  warns until this lands; if the decision is reversed instead, remove W1
  and this entry together.
- **Desktop version track** — desktop currently shares the repo-wide version
  while its signing status is unverified. Either keep the shared number and
  gate releases on signing, or document an independent desktop version track
  (see the `codex/version-release-contract` branch).
- **Remote provider validation** — deferred permanently per the 2026-08-05
  decision; owner smoke-tests manually post-deploy. Do not add a gate for it.

## Out of scope for this file

Deployment approvals (Vercel, Pages, installers) are human decisions recorded
above, not gates the script can pass or fail on its own.
