# PromptLab — Forensic Audit, Bug Discovery & Branch Disposition

**Audit date:** 2026-08-10
**Repository:** DaveHomeAssist/prompt-lab
**Audited commit:** `1366e2fb43400f4e572760639e8ee5155ac476f0` (identical to `origin/main`)
**Mode:** Read-only. No source file, branch, worktree, remote, PR, deployment, Vercel setting, secret, environment variable, or Notion record was modified.

---

## 0. Headline verdict

The project is in materially better shape than the audit brief's historical leads suggest. **Six of the eight named historical issues are resolved and verifiably so.** CI is green across every workflow on `main`, all nine release gates pass, `npm audit` is clean across all three installable roots, and the accessibility gates the brief listed as "unexercised" are in fact automated and passing.

The real problems are elsewhere, and there are four that matter:

| # | Finding | Class | Severity |
|---|---|---|---|
| F1 | `/api/telemetry` accepts cross-origin POSTs from any website | Confirmed | **High** |
| F3 | Live production `504`s on `/api/proxy` — self-imposed timeout below the platform budget | Confirmed | **High** |
| F6 | Extension host-permission change is stranded at an already-published version number | Confirmed | **High (release blocker)** |
| F7 | Four Vercel projects for one product; three orphaned and on the wrong Node major | Confirmed | Medium |

Everything else is medium or below. Details, evidence, and the smallest safe fix for each are in §3.

### A note on the audit brief's own premises

Three premises in the brief are stale, and they matter because they would misdirect the work:

- **The named "known active branch" `agent/promptlab-landing-redesign` and "known PR #28" are closed and merged.** PR #28 merged 2026-08-09 (merge commit `fe4b4b2`); the branch no longer exists on the remote. The same is true of `prototype/ipad-m0-m1` (#22), `docs/ipad-swift-plan-universal-adr` (#21), and `fix/production-api-safety` (#29).
- **The "known verified SHA" `ca5af17e…` is a real commit** in this repository's history, but it is not `main`, not a branch tip, and not PR #28's head (`e6695616…`). It is not a meaningful anchor for current state.
- **Every documented release command in the brief is rooted at the repository root, where none of them work.** There is no root `package.json`; running `npm run test:landing` from `/home/user/prompt-lab` exits `ENOENT`. All commands must run from `prompt-lab-source/`, and `npm --prefix prompt-lab-web …` must be `npm --prefix prompt-lab-source/prompt-lab-web …`. This is documented nowhere — `AGENTS.md` and `README.md` contain no command guidance at all. See F10.

---

## 1. Phase 1 — Repository and worktree snapshot

| Item | Value |
|---|---|
| Repository root | `/home/user/prompt-lab` |
| Current branch | `claude/promptlab-forensic-audit-odz68u` |
| Current commit | `1366e2fb43400f4e572760639e8ee5155ac476f0` |
| Remote | `origin` → `https://github.com/DaveHomeAssist/prompt-lab` (no credentials in URL) |
| Working tree | **Clean** — no modified, staged, deleted, or untracked files |
| Worktrees | Exactly one: `/home/user/prompt-lab` on the audit branch. Clean. |
| Node | v22.22.2 |
| npm | 10.9.7 |
| OS | Linux 6.18.5-fc-v20 x86_64 |
| Declared engine | `prompt-lab-source/package.json` → `"node": "22.x"` |

### Node version consistency — clean

The brief's "Node 20 versus Node 22 inconsistencies" lead is **disproven inside the repository**. Every one of the nine workflows resolves Node via `node-version-file: prompt-lab-source/.nvmrc`; no workflow hardcodes a version. All three `.nvmrc` files (`./`, `prompt-lab-source/`, `prompt-lab-source/prompt-lab-extension/`) read `22`. `scripts/require-node.mjs:20` enforces `major !== 22 → throw`, fail-closed, and is chained into every script via `check:node`.

The only Node drift is **outside** the repository, in stale Vercel projects — see F7.

### What could not be inspected, and why

This audit ran in a **fresh ephemeral container clone**, not on the user's machine. Consequently:

- **The local path `/Users/daverobertson/Code/prompt-lab` does not exist here.** Any dirty worktrees, stashes, untracked local files, uncommitted work, or extra worktrees on Dave's Mac are **Unverified**. `git worktree list` here reports one clean worktree, which says nothing about the local machine. If local-worktree hygiene matters, that check must be run locally.
- **Vercel environment variable values and usage/spending limits were not inspected.** The Vercel MCP surface exposes project metadata and deployments but not env-var inventories or billing caps. Presence/absence of specific env vars in production is **Unverified**.
- **Real Stripe checkout and signed-in Clerk flows were not exercised.** All billing tests are unit-level with stubbed `fetch`. This remains a genuine coverage gap — see F9.
- **Screen-reader (VoiceOver) behavior was not exercised.** `axe-core` covers static violations only; it cannot verify announced state. Still manual-only.

---

## 2. Phase 2 — Complete branch inventory

Authoritative source: `git ls-remote --heads origin` plus the GitHub PR API. Note that the local remote-tracking refs were **stale on arrival** — `git branch -r` initially showed a branch that no longer exists on the remote. A full `git fetch --prune` was required to get a true picture; anyone auditing from a warm clone should do the same before trusting `git branch -r`.

### Live remote branches — this is the complete list

| Branch | SHA | Ahead/behind `main` | PR | PR state | Disposition |
|---|---|---|---|---|---|
| `main` | `1366e2f` | — | — | — | **KEEP** |
| `release/1.7.1-host-permission` | `22de002` | 1 ahead / 13 behind | #33 | **Open (draft)** | **MERGE** |
| `work/prompt-lab-product-improvements-2026-08-05` | `529019f` | 1 ahead / 66 behind | #27 | Closed, **not merged** | **ARCHIVE** |

That is all of them. Only three branches exist on the remote.

### Revalidation of every branch hypothesis in the brief

| Hypothesis | Reality | Verdict |
|---|---|---|
| `main` — expected KEEP | Baseline, CI green, deploying to production | ✅ **KEEP** — confirmed |
| `feature/project-prompt-instruments` — "contained in main" | **Does not exist.** No local ref, no remote ref, no PR in the repository's entire 33-PR history | ⚠️ Hypothesis **obsolete** — nothing to action |
| `agent/promptlab-landing-redesign` (PR #28) — "needs Node 22 / auth-gate refresh" | **Merged 2026-08-09** (merge commit `fe4b4b2`, deploy `dpl_29CTHmVV…`). Merge message records the Node 22 reconciliation was completed. Branch deleted from remote | ✅ **Already done** |
| `prototype/ipad-m0-m1` (PR #22) — "conditional on live-Anthropic gate" | **Merged 2026-08-09** (`db5ac29`). Branch deleted. Result is `prompt-lab-ios/` in `main` | ✅ **Already done** |
| `work/prompt-lab-product-improvements-2026-08-05` (PR #27) — "decompose, don't merge wholesale" | PR **closed unmerged**. Branch still exists. Recommendation was followed *in spirit* — see analysis below | ⚠️ **ARCHIVE**, with a caveat |
| `docs/ipad-swift-plan-universal-adr` — "archive/delete" | **Merged 2026-07-29** via PR #21. Branch deleted | ✅ **Already done** |
| `fix/production-api-safety` (PR #29) — "believed merged into main" | **Merged 2026-08-07** (`4c403fc`). Branch deleted | ✅ Confirmed |

### `work/prompt-lab-product-improvements-2026-08-05` — the one that needs a decision

This is the only branch requiring judgment, and the brief's historical note is half-right in a way worth spelling out.

**Deletion-safety proof:**
- ✅ **No unique work would be lost.** The tag `archive/pr27-product-improvements-monolith-20260809` resolves to `529019f9a06c622312454962bb200bfe48940ef4` — byte-identical to the branch tip. The tag preserves 100% of the branch.
- ✅ **No active PR depends on it.** PR #27 is closed.
- ✅ **No worktree depends on it** (in this clone; unverified locally).
- ✅ **No deployment depends on it.** Its last Vercel preview predates the archive tag; the canonical project deploys only from `main`.

**But the roadmap caveat matters:** the brief implies PR #27 was "decomposed rather than merged wholesale." It was **not decomposed** — it was closed and tagged. The feature files are verifiably absent from `main`:

```
PadEditor.jsx           → ABSENT from origin/main
padSchema.js            → ABSENT from origin/main
libraryRepository.js    → ABSENT from origin/main
ollama-smoke.mjs        → ABSENT from origin/main
vitest.desktop.config.js → ABSENT from origin/main
```

The five features that *did* land in `main` (`Pack Studio`, `prompt chains`, `model arena`, `test-case verdicts`, `page context capture`) are different work. So roughly 4,978 insertions of Pads/library-repository/Ollama-smoke work — **with its own tests** — sits parked in a tag and nowhere else.

**Recommendation:** `ARCHIVE`. Deleting the branch ref is safe *today* because the tag is an exact preservation. But do not treat that as closure — decide explicitly whether the Pads feature is wanted. If it is, it needs to be re-landed from the tag; if it is not, say so in `ROADMAP.md` so the next audit does not rediscover it.

### `release/1.7.1-host-permission` (PR #33) — MERGE, and it is blocking a fix

1 commit ahead, **13 behind** `main`. It is a pure version bump (1.7.0 → 1.7.1) across all seven manifests plus `constants.js`. Its preview deployment `dpl_Djz8d6HKww9Rdz2SLc5taSmXonNQ` is `READY`. It is still a **draft**. This branch is the fix for F6 — see below.

---

## 3. Phase 3 — Bug and blocker discovery

### F1 · `/api/telemetry` accepts cross-origin POSTs from any website — **Confirmed · High**

`api/_lib/telemetryStore.js:43` sets `'Access-Control-Allow-Origin': '*'`, and `api/telemetry.js` **never calls an origin check** — the handler has no `corsRejectionResponse` call and no `Origin` reference anywhere in its 86 lines.

This is inconsistent with every other endpoint in the codebase, which is what makes it look like an oversight rather than a decision:

- `api/proxy.js:103-112` — strict allowlist, `403` on unlisted origin.
- `api/_lib/stripeBilling.js:60-70` — strict allowlist, `403` on unlisted origin, with `Access-Control-Allow-Origin: 'null'` on rejection.
- `api/_lib/telemetryStore.js:43` — `*`, no check.

**Concrete failure scenario.** Any third-party page can `fetch('https://promptlab.tools/api/telemetry', {method:'POST', body: JSON.stringify({telemetryEnabled:true, event:'<any schema-valid event>', …})})` from a visitor's browser and have it accepted. Consequences, in order of seriousness:

1. **Analytics eviction.** `DEFAULT_EVENT_LIST_LIMIT = 2000` (`telemetryStore.js:13`) caps the durable event list. The rate limit is 60/min keyed on a SHA-256 of the client IP (`telemetryStore.js:89-107`) — per-IP, so a single origin driving many visitors, or any distributed source, trivially exceeds it. Roughly 34 minutes of one IP at the cap is enough to evict the entire genuine event history.
2. **PII injection.** For non-landing events, `normalizeTelemetryEvent` accepts and stores an attacker-supplied `contactEmail` (`telemetryStore.js:187-189`), writing arbitrary third-party email addresses into the telemetry store.
3. **Metric poisoning.** `plan`, `surface`, `deviceId`, and `sessionId` are all attacker-controlled.

The consent gate (`assertTelemetryConsent`, `telemetryStore.js:142-146`) does not help — it checks a field in the attacker's own request body.

**Not covered by tests.** `tests/telemetry-safety.test.mjs` contains no `origin` or `cors` assertions. `tests/billing-cors.test.mjs:31` *does* assert rejection of `https://evil.example` for billing — telemetry simply never got the equivalent.

**Smallest safe fix:** reuse the existing, already-tested billing helper. Import `corsRejectionResponse`/`corsHeadersForRequest` from `stripeBilling.js` (or lift them into a shared module) and add the two-line guard at the top of `api/telemetry.js`, mirroring `api/billing/license.js:32-34`. Then port the `billing-cors` origin test to `telemetry-safety`.
**Verification:** a `POST` with `Origin: https://evil.example` must return `403`; `https://promptlab.tools` must still succeed.

### F2 · `X-Signature` is advertised but never verified — **Confirmed · Low (lazy code)**

`telemetryStore.js:45` advertises `X-Signature` in `Access-Control-Allow-Headers`. A repository-wide search finds that string in exactly one place — that line. No handler, helper, or test ever reads or verifies it.

This is an unfinished fallback path: the header implies a request-authentication scheme that does not exist. It is low severity on its own, but it is the likely intended mitigation for F1 and should be resolved in the same change — either implement it or drop the advertisement so it stops implying a guarantee.

### F3 · Live production `504`s on `/api/proxy` — **Confirmed · High**

Vercel runtime errors for project `prj_kynCeAMcASaNBIBMRHVJb7sozDfN`, 7-day window:

```
ExternalFetchTimeoutError: Anthropic request timed out after 20000ms.
  count=6  users=1  routes=/api/proxy
  first=2026-08-10T07:49:27Z  last=2026-08-10T07:50:48Z
  lastDeployment=dpl_F6Ka1QEkimyJFJ5XcBux8QaPQpt8
  at prompt-lab-source/api/_lib/runtimeSafety.js:125
```
(plus a second cluster of 3, same route, same signature — 9 events total)

These occurred **today**, on the current production deployment. Every one aborted at exactly 20 000 ms, which is the ceiling the code imposes on itself:

- `api/proxy.js:33` — `ANTHROPIC_TIMEOUT_MS = 20_000`
- `api/proxy.js:554` — `readBoundedIntEnv('PROMPTLAB_ANTHROPIC_TIMEOUT_MS', ANTHROPIC_TIMEOUT_MS, { max: 20_000 })`

The `max: 20_000` clamp means **the env var cannot raise this** — setting `PROMPTLAB_ANTHROPIC_TIMEOUT_MS=25000` is silently clamped back to 20 000. Meanwhile `vercel.json` grants `api/proxy.js` a `maxDuration` of **25** seconds. The function is throwing away 5 seconds of its own budget, then returning `504` to the user.

**User-visible effect:** hosted Enhance fails outright for slower Anthropic completions. With `max_tokens` defaulting to 2048 (`proxy.js:31`) and no streaming on this path, 20 s is not a generous ceiling.

**Smallest safe fix:** raise the `max` clamp to sit just under the platform budget (≈ 23 000 ms, leaving headroom for response handling), keeping the 20 s default. Two-character-class change at `proxy.js:554`.
**Verification:** add a `proxy.test.mjs` case asserting `PROMPTLAB_ANTHROPIC_TIMEOUT_MS=23000` is honoured rather than clamped; then confirm the error cluster stops recurring in Vercel runtime errors.

### F4 · Burst rate limiting fails open in production — **Confirmed · Medium**

`api/proxy.js:263` increments the burst window with **no** `requirePersistent` flag:

```js
const state = await incrementWindow('burst', ip, BURST_WINDOW_MS, burstHits);
```

Compare the other two limiters, which both require durability in production:

- `proxy.js:278-280` — demo: `{ requirePersistent: process.env.NODE_ENV === 'production' }`
- `proxy.js:295-297` — global: `{ requirePersistent: process.env.NODE_ENV === 'production' }`

Per `incrementWindow` (`proxy.js:240-255`), without that flag a Redis failure logs a warning and silently falls back to `incrementMemoryWindow`. On Vercel Edge, in-memory maps are **per-isolate**, so the burst limit degrades to near-zero effectiveness precisely when the durable store is unavailable.

Given that commit `7c163e2` ("fix(web): require durable hosted usage limits") deliberately added `requirePersistent` to the demo and global limiters, burst looks like a missed case rather than an intentional exemption. Nothing in the code documents a rationale for the asymmetry.

**Not covered by tests.** `tests/proxy.test.mjs` mentions `HOSTED_BURST_LIMIT` once (line 28) and makes no assertion about `store` or persistence for the burst path.

**Smallest safe fix:** add the same `requirePersistent` option at `proxy.js:263`, or add a comment stating why burst is deliberately allowed to fail open. Either way, pin the chosen behaviour with a test.

### F5 · Demo quota is consumed before the request is validated — **Confirmed · Medium**

Ordering in `api/proxy.js`:

| Line | Step | Can reject? |
|---|---|---|
| 478 | `getDemoState(clientIp)` — **increments the per-IP daily counter** | — |
| 504 | `sanitizeAnthropicBody(body)` | yes → `400` |
| 518 | `getGlobalDemoState()` | yes → `429` |

A shared-key user gets `DEFAULT_DEMO_DAILY_LIMIT = 3` runs per day (`proxy.js:28`). A malformed body, an oversized prompt, or the *global* budget being exhausted all burn one of those three credits on a request that never reached Anthropic and cost nothing to serve. With a quota of 3, losing one to a client-side validation error is a materially bad experience.

**Smallest safe fix:** move the `sanitizeAnthropicBody` call and the global-budget check above the per-IP demo increment, so the per-user counter is only charged once the request is known to be servable.
**Verification:** a test asserting that a `400`-rejected body leaves `X-Demo-Remaining` unchanged across two consecutive requests.

### F6 · Extension host permission is stranded at an already-published version — **Confirmed · High · Release blocker**

`main` ships a new `host_permissions` entry, `https://promptlab.tools/*`, in **both** manifests (`prompt-lab-extension/extension/manifest.json:16` and `prompt-lab-extension/public/manifest.json:16`), landed via PR #32.

But every version marker in `main` still reads **1.7.0**:

```
package.json                        1.7.0
prompt-lab-web/package.json         1.7.0
prompt-lab-extension/package.json   1.7.0
prompt-lab-desktop/package.json     1.7.0
extension/manifest.json             1.7.0
public/manifest.json                1.7.0
src-tauri/tauri.conf.json           1.7.0
src/constants.js:3  APP_VERSION =  '1.7.0'
```

Chrome will not push an update to installed extensions at an unchanged version. **The host permission therefore cannot reach any existing user**, and the `promptlab.tools` integration it enables is dead in the field despite being merged and deployed.

PR #33 (`release/1.7.1-host-permission`) is exactly the fix — it bumps all eight markers in lockstep — and its own commit message diagnoses this correctly. It has been sitting as an **open draft, 13 commits behind `main`**, since 2026-08-09.

**Smallest safe fix:** rebase/merge `main` into `release/1.7.1-host-permission`, re-run `npm run preflight` (its "Version consistency" check covers exactly this invariant), mark PR #33 ready, and merge.
**Dependency:** none. **Verification:** `preflight` version-consistency check passes at 1.7.1; the loaded extension reports 1.7.1.

### F7 · Four Vercel projects for one product; three orphaned on the wrong Node major — **Confirmed · Medium**

| Project | ID | Node | Last deployment | Domains |
|---|---|---|---|---|
| **`prompt-lab`** *(canonical)* | `prj_kynC…` | **22.x** ✅ | 2026-08-10 (today) | `promptlab.tools`, `www.promptlab.tools`, **`mobile.promptlab.tools`**, 3× `*.vercel.app` |
| `prompt-lab-source` | `prj_cFEP…` | **24.x** ⚠️ | 2026-04-22 (~3.5 mo) | 3× `*.vercel.app` |
| `prompt-lab-web` | `prj_gfq7…` | **24.x** ⚠️ | 2026-03-23 (~4.5 mo) | 3× `*.vercel.app` |
| `promptlab-landing-redesign` | `prj_RKXT…` | **24.x** ⚠️ | **never deployed** | none |

Two distinct problems:

1. **Node major mismatch.** All three non-canonical projects are pinned to Node **24.x**, against a declared engine of `22.x` and a *fail-closed* `require-node.mjs` that throws on any major other than 22. Any attempt to redeploy one of them fails at the first `check:node`. This is the only surviving trace of the "Node inconsistency" lead — and it lives in Vercel settings, not in the repo, which is why repo-side checks never caught it.
2. **Live stale surfaces.** `prompt-lab-source.vercel.app` and `prompt-lab-web.vercel.app` still serve builds that are three to four-and-a-half months old, on publicly reachable URLs. They are not behind the canonical domains, but they are not private either.

`promptlab-landing-redesign` (created 2026-08-06, never deployed, no domains) is an empty orphan left over from the PR #28 work.

**Good news within this finding:** `mobile.promptlab.tools` **is** correctly configured on the canonical project and is correctly served by the `vercel.json:22-24` host-based rewrite to `/mobile/index.html`. The brief's "misconfigured domains" concern does not hold.

**Recommendation:** delete `promptlab-landing-redesign` (nothing to lose — never deployed, no domains). For `prompt-lab-source` and `prompt-lab-web`, either delete them or, if the `*.vercel.app` URLs are still referenced anywhere, set them to Node 22 and redeploy from `main` so they stop serving stale builds. **Do not delete before confirming no external link depends on those URLs** — that check was outside this audit's read-only scope.

### F8 · Documentation drift — **Confirmed · Medium**

`ARCHITECTURE.md` and `ROADMAP.md` are the two documents highest in the stated source-of-truth order, and both materially misdescribe the current product.

**`ARCHITECTURE.md` contains zero occurrences** of: `ios`, `swift`, `billing`, `telemetry`, `stripe`, `clerk`, or `mobile`. Yet `main` contains all of them:

| Reality in `main` | What `ARCHITECTURE.md` says |
|---|---|
| `prompt-lab-ios/` — native SwiftUI app (merged PR #22), with `PromptLabTests/` and `QA/` | "three runtime shells" — iOS not mentioned at all |
| `api/` has **13 files**: `billing/{checkout,license,portal,webhook}.js`, `telemetry.js`, `_lib/{stripeBilling,verifyClerkToken,telemetryStore,ownerEntitlements,assertProductionConfig,runtimeSafety,nodeHandler}.js` | "`api/` — Vercel Edge Function CORS proxy at `api/proxy.js`" |
| Stripe billing + Clerk auth + durable telemetry, all in production | Not mentioned |
| `mobile.promptlab.tools` + `prompt-lab-web/public/mobile/` | Not mentioned |
| Playwright landing gates, app gates, API-safety suite | "Testing" lists only Vitest, one extension smoke test, and two CI workflows |

**`ROADMAP.md:37`** lists v1.7 as *"Prompt Lab Server experiment (self-hosted browser access)"*. What actually shipped in 1.7.0 was billing, telemetry, the landing redesign, and a native iOS app. The Server experiment did not happen.

There is also a **governance conflict worth surfacing rather than quietly ignoring**: `ROADMAP.md` states the *v1.x rule* — *"avoid introducing a public backend unless it unlocks a core feature that cannot be delivered client-side"* — and ranks "Public web app / PWA" as *deferred until a backend is architecturally justified*. Production now runs a public backend for billing, telemetry, and a provider proxy. That may well be the right call, but the rule as written no longer describes the system, and no ADR in these two files records the change.

**Smallest safe fix:** update `ARCHITECTURE.md`'s repo-layout, runtime-model, and testing sections to cover `api/billing/*`, `api/telemetry.js`, `prompt-lab-ios/`, and the mobile surface; correct the `ROADMAP.md` version table; and either restate or explicitly supersede the v1.x backend guardrail. These are docs-only edits — `npm run docs:check` (markdownlint over 21 files) is the gate.

### F9 · Coverage gaps in genuinely critical paths — **Confirmed · Medium**

Not "no tests" — the suites are strong (757 extension tests, 65 API tests, 24 browser gates, all passing). These are the specific paths where nothing meaningful is asserted:

| Path | Gap | Why it matters |
|---|---|---|
| Real Stripe checkout | All billing tests stub `fetch`. No end-to-end checkout has been exercised. | Revenue path. A live Stripe misconfiguration would not be caught by any gate. |
| Signed-in Clerk session | `verifyClerkToken.js` (293 lines) is unit-tested only. The app e2e logs `Clerk key missing - running unauthenticated in dev mode`. | Auth path; entitlement resolution depends on it. |
| Extension Playwright e2e | `prompt-lab-extension/playwright.config.js` and the `test:e2e` script **exist but are wired into no workflow.** `extension-ci.yml` runs `npm test` and `npm run build` only; the only `test:e2e` references in `.github/workflows/` are `landing-ci.yml:151,154` for the *web* gates. | A written, maintained browser suite never runs in CI. |
| Screen-reader announcement | axe covers static violations; announced state is not verifiable automatically. | Remains a legitimate manual gate. |
| Telemetry origin enforcement | No origin/CORS assertion in `telemetry-safety.test.mjs` (billing has one at `billing-cors.test.mjs:31`). | Directly enabled F1 going unnoticed. |

**Note on `tests/lemonBilling.test.mjs:17`:** `const lemonTest = lemonSupportEnabled ? test : test.skip;` is a *conditional* skip gated on optional Lemon Squeezy support, not an abandoned test. Classified **intentionally deferred**, not a defect.

### F10 · Documented release commands do not run from the repository root — **Confirmed · Low**

Verified by execution: `npm run test:landing` from `/home/user/prompt-lab` exits `ENOENT` (no root `package.json`). All nine release commands require `cd prompt-lab-source` first, and `npm --prefix prompt-lab-web …` must be `npm --prefix prompt-lab-source/prompt-lab-web …`.

Neither `AGENTS.md` nor `README.md` documents the working directory — a grep for `cd prompt-lab-source`, `working directory`, `run from`, or `npm run` in `AGENTS.md` returns nothing. Every agent and contributor hits this on first contact.

**Smallest safe fix:** one "Commands" section in `AGENTS.md` stating that all release commands run from `prompt-lab-source/`, with the nine commands listed verbatim.

### F11 · Minor code-quality items — **Confirmed · Low**

Held to the brief's rule 5 (demonstrable shortcuts only, not style):

- **Error-message passthrough to clients.** `api/billing/license.js:95-99` and `api/proxy.js:596` return raw upstream `error.message` in the response body. Upstream Stripe/Anthropic errors can carry internal detail. Low severity — worth a generic client message with the detail logged server-side.
- **Empty catch blocks — 4 total, all defensible.** `scripts/notion-docs-agent.mjs:347,354` (tooling), `prompt-lab-extension/src/promptUtils.js:278`, `prompt-lab-web/public/prompt-embed.html:381` (`document.execCommand("copy")` fallback). None sit on a production request path. Classified **false positive** for the purposes of this audit; noted for completeness.
- **One `eslint-disable`** in the entire source tree: `PackStudioPanel.jsx:25` (`react-hooks/exhaustive-deps`). Ordinary and scoped.
- **Bundle size warning.** `preflight` reports the extension JS bundle at **642 KB**, over its own 500 KB threshold. This is a warning, not a failure, and has been tolerated; flagged as a deferrable performance item.

**Zero** `TODO`, `FIXME`, `HACK`, or `XXX` comments exist across `api/`, `scripts/`, `tests/`, `prompt-lab-extension/src/`, `prompt-lab-web/`, or `prompt-lab-extension/extension/`. Zero `@ts-ignore`/`@ts-nocheck`. Zero `.only`/`.skip` tests outside the conditional Lemon gate. **Phase 4 is, for practical purposes, clean** — this codebase does not carry a backlog of unfinished markers.

---

## 4. Historical leads — resolved, with evidence

Each of these was in the brief as a lead to verify rather than assume. Six are resolved:

| Historical lead | Current state | Evidence |
|---|---|---|
| `/api/billing/license` produced severe 5xx spikes | ✅ **Resolved** | Zero `/api/billing/license` entries in 7-day Vercel runtime errors. PR #30 introduced the terminal `200 billingDisabled, retryable:false` contract (`license.js:19-29`); PR #32 extended it to portal/checkout/telemetry. The only live errors are `/api/proxy` (F3). |
| Preview deployments failed twice | ✅ **Resolved** | All 20 most recent deployments on `prj_kynC…` are `state: READY`, including PR #33's preview `dpl_Djz8d6HKww9Rdz2SLc5taSmXonNQ`. |
| Four high-severity entries in the committed web lockfile | ✅ **Resolved** | `npm audit --json` → `{"info":0,"low":0,"moderate":0,"high":0,"critical":0,"total":0}` for **all three** installable roots (root, `prompt-lab-web`, `prompt-lab-extension`). |
| Node 20 vs 22 inconsistencies | ✅ **Resolved in-repo** | All 9 workflows use `.nvmrc`; all 3 `.nvmrc` = 22; canonical Vercel project = 22.x; `require-node.mjs` fail-closed. ⚠️ Survives only in stale Vercel projects — F7. |
| 200% zoom, reduced motion, JS-disabled, touch targets unexercised | ✅ **Resolved** | Automated and passing: `landing.spec.js:567` (200% reflow at 640×400), `:433` (reduced motion), `:480`/`:517` (JS disabled), `:625` (44×44 touch targets), `:50` (axe, no serious/critical). |
| Billing/proxy/telemetry intentionally fail-closed with 503 | ✅ **By design, and now refined** | Deliberate. Billing/telemetry moved to terminal `200` + `retryable:false` so clients stop looping; `webhook.js:22` **deliberately retains 503** because Stripe's 5xx retry is what preserves events while billing is off — and a test pins that behaviour so it is not "fixed" later. Good engineering; not a defect. |
| PR #28 preview-verified but production-gated | ✅ **Shipped** | Merged 2026-08-09, production deploy `dpl_29CTHmVV…`. |
| VoiceOver, signed-in Clerk, real Stripe checkout unexercised | ⚠️ **Still true** | See F9. |

**Webhook verification is present and correct** (`api/billing/webhook.js:35-39`): raw body read before parse, `stripe-signature` header checked via `verifyStripeSignature`, `401` on mismatch. No missing-webhook-verification issue.

---

## 5. Phase 5 — Release gate results

All commands run from `prompt-lab-source/` at `1366e2f`.

| Command | Result | Detail |
|---|---|---|
| `npm run test:landing` | ✅ **PASS** | 21/21 |
| `npm run test:api` | ✅ **PASS** | 65/65 |
| `npm test --prefix prompt-lab-extension` | ✅ **PASS** | 550 vitest (57 files) + 207 node `--test` = **757** |
| `npm --prefix prompt-lab-web run build` | ✅ **PASS** | vite 8.2.1, built in 1.41 s |
| `npm run build:landing` | ✅ **PASS** | `docs/` regenerated |
| **Generated-docs parity** | ✅ **PASS** | `git status` clean after `build:landing` — no source/generated drift |
| `npm run docs:check` | ✅ **PASS** | markdownlint-cli2, 21 files, 0 issues |
| `npm run preflight` | ⚠️ **PASS with 1 warning** | 24 passed · 0 failed · 1 warning (extension bundle 642 KB > 500 KB) |
| `npm run test:e2e:landing` | ✅ **PASS** | 21/21 — see environment note |
| `npm run test:e2e:app --prefix prompt-lab-web` | ✅ **PASS** | 3/3 |

**Environment note on the browser gates.** With the stock config these initially reported **21/21 failed** in this container. That was **not** a product regression: Playwright 1.61.1 expects `chromium_headless_shell-1228`, while the image provides build 1194, and the CDN required to fetch the matching build is blocked by network policy (`403 request rejected: host not permitted`). Re-running against the pre-installed Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) via a temporary config **outside** the repository produced 21/21 and 3/3 passes. The temporary config was deleted and the working tree verified clean. GitHub Actions installs the correct browser via `npx playwright install --with-deps chromium` (`landing-ci.yml:148-150`), which is why CI is unaffected.

### CI health on `main` — green

The 30 most recent workflow runs are **all `completed/success`**. At `1366e2f`: API Safety ✅, Landing CI ✅, Docs CI ✅, Pages build & deploy ✅. Recent commits also show Extension CI ✅, Desktop Build ✅, Dependency Health ✅, iOS Prototype ✅.

**One structural note:** `landing-ci.yml` uses a hand-maintained allowlist of ~40 explicit path filters (lines 6-45, duplicated for `pull_request` at 47-86). Commit `1366e2f` triggered API Safety, Landing CI, Docs CI, and Pages — but not Extension CI, Desktop Build, or Dependency Health. That is correct here (the commit touched only `api/`), but a 40-entry duplicated allowlist is fragile: a new source directory silently escapes coverage until someone notices. Not currently broken; worth simplifying to directory-level globs.

---

## 6. Recommended order of work

**Before the next release:**
1. **F6** — rebase and merge PR #33. The shipped host permission is unreachable until this lands. Highest ratio of impact to effort in the entire audit.
2. **F1** — add the origin guard to `api/telemetry.js` by reusing the tested billing helper, plus the ported origin test. Resolve **F2** in the same change.
3. **F3** — raise the `max` clamp at `proxy.js:554` above 20 s. Users are getting `504`s today.

**Next:**
4. **F4** and **F5** — proxy rate-limit durability and quota-charge ordering, with tests.
5. **F7** — delete `promptlab-landing-redesign`; decide delete-or-fix for the two stale projects *after* confirming nothing links to their `*.vercel.app` URLs.
6. **F8** — bring `ARCHITECTURE.md` and `ROADMAP.md` back in line with what actually shipped, and resolve the v1.x backend guardrail explicitly.

**Then:**
7. **F9** — wire the existing extension Playwright suite into `extension-ci.yml`; plan a real Stripe test-mode checkout gate.
8. Decide the fate of the PR #27 Pads work — re-land from the archive tag or record the decision to drop it.
9. **F10** — document the `prompt-lab-source/` working directory in `AGENTS.md`.
10. **F11** — investigate the 642 KB extension bundle.

---

## 7. Evidence classification summary

- **Confirmed findings (11):** F1–F11. Each cites file and line, a live deployment/runtime record, or an executed command result.
- **Strong inference (2):** F4's burst limiter being a missed case rather than a deliberate exemption (inferred from commit `7c163e2` adding the flag to the sibling limiters and no documented rationale); F2's `X-Signature` being the intended-but-unbuilt mitigation for F1.
- **Suspected (1):** `landing-ci.yml`'s 40-entry path allowlist as a future coverage-gap source — structurally fragile, not currently failing.
- **Historical, now resolved (6):** billing 5xx spikes, preview failures, lockfile vulnerabilities, in-repo Node drift, unexercised a11y gates, PR #28 gating.
- **Unverified (5):** local worktree state at `/Users/daverobertson/Code/prompt-lab`; Vercel environment-variable inventory; Vercel usage/spending limits; real Stripe checkout; VoiceOver behavior. Reasons given in §1.

No secrets, API keys, tokens, passwords, private keys, or environment values are reproduced anywhere in this report. Where configuration is discussed, only presence, absence, or reference is stated.
