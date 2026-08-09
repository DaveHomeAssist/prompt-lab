# PromptLab Feature Health Dashboard

Audited: 2026-08-09

Code baseline: `9c0661b1f733c4663ac488d066661c4925bed5b4` on `main`

Current product health: **🟡 Amber · 84/100 · B**

This is the canonical, code-grounded feature inventory and health rubric for the
current web, extension, and desktop product. The dashboard commit itself does not
change the audited runtime baseline.

## Next executable prompt

```text
Work in a clean checkout of the PromptLab repository at current origin/main.
Commit and push directly to main; never create a pull request. Preserve unrelated
work and do not invoke Anthropic, OpenAI, Gemini, OpenRouter, Stripe, billing,
telemetry, or any other paid provider request.

Objective: remove PromptLab's cross-surface dependency and Node runtime health
blockers without changing product behavior.

1. Verify origin/main, the four package roots under prompt-lab-source, all
   package engines, .nvmrc, require-node script, and GitHub workflow Node versions.
2. Choose one supported Node LTS contract from repository evidence. Prefer Node 22
   if no dependency or deployment constraint requires Node 20, because extension,
   desktop, and release CI already execute on Node 22. Document the decision.
3. Reconcile .nvmrc, engines, the node guard, local commands, and every workflow to
   that one version. The guard must fail clearly on an unsupported major version.
4. Audit all four lockfiles. Upgrade dependencies deliberately to remove every
   high and critical advisory. Do not use a blind forced audit fix. Inspect major
   migrations, especially Vite, React Router, PostCSS, and markdownlint-cli2.
5. Add or strengthen regression coverage for routing, persistence, provider
   settings, production builds, and the Node contract wherever an upgrade creates
   risk.
6. Run all 472+ unit tests, all 52 API safety tests, docs checks, extension/web/
   desktop builds, and Playwright extension and responsive smoke tests.
7. Run npm audit in all four package roots and report direct versus transitive
   findings. Zero high/critical advisories is the release gate. If one cannot be
   removed safely, document the exact package, reachable surface, mitigation, and
   executable follow-up instead of claiming success.
8. Update this feature health dashboard with the new evidence and scores.
9. Review the diff, commit only the intended files, push directly to main, verify
   the remote ref and applicable GitHub workflows, observe the production deploy,
   and smoke-test the live app without invoking provider or billing endpoints.

Success: one enforced Node contract; zero high/critical npm advisories across all
four lockfiles; tests, checks, builds, routing, and persistence pass; no paid or
telemetry request occurs; main, CI, deployment, and the live URL are verified.
```

Why this is next: dependency security is the only Red system gate, and the
Node 20/22 split makes every local, CI, release, and remediation result less
reproducible. This repair improves every feature surface before more product work
is added.

## Product intent and implementation model

PromptLab is a local-first prompt workbench. Its core loop is:

1. write or compose a prompt;
2. improve it with deterministic guidance or a selected model provider;
3. protect sensitive input before execution;
4. save, organize, share, and version the prompt;
5. run test cases, compare variants, inspect history, and promote good output to a
   golden response;
6. repeat the loop across the Chrome extension, hosted web app, or Tauri desktop
   shell.

The React/Vite frontend under `prompt-lab-extension/src/` is shared by all three
surfaces. The extension uses a Manifest V3 service worker and Chrome storage. The
desktop shell uses Tauri, local storage, and direct provider access. The hosted
web app uses Clerk identity and a guarded `/api/proxy` boundary; it is a
convenience/evaluation surface, while extension and desktop remain the primary
full-provider products. Prompt, run, test-case, collection, notebook, and session
data are persisted locally through browser storage, local storage, and IndexedDB.

## Scoring rubric

Every feature is scored from the behavior currently available on `main`, not from
plans, issue labels, or historical reports.

| Dimension | Max | Full-credit evidence |
| --- | ---: | --- |
| **V — Value and workflow** | 20 | The capability solves a clear user job, is discoverable, and completes its intended workflow. |
| **C — Correctness** | 20 | Logic and UI behavior are implemented and deterministic tests cover success and important failure paths. |
| **R — Reliability and data** | 15 | Persistence, reload, migration, cancellation, error, and recovery behavior are safe where applicable. |
| **X — Intended-surface coverage** | 15 | The feature works on every surface it claims to support; intentionally surface-specific features are not penalized. |
| **S — Safety, privacy, and cost** | 15 | Secret, PII, permission, billing, telemetry, and paid-call boundaries fail closed. |
| **E — Evidence and operability** | 15 | Builds, runtime smoke tests, CI, documentation, observability, and release proof support the claim. |

Health assignment:

| Score | Grade | Light | Meaning |
| ---: | --- | --- | --- |
| 90–100 | A | 🟢 | Implemented and strongly verified; no material gate is open. |
| 85–89 | B | 🟢 | Implemented and verified; no material gate is open. |
| 80–84 | B | 🟡 | Useful and implemented, but a verification, parity, reliability, or release gap remains. |
| 70–79 | C | 🟡 | Implemented in part or insufficiently verified for its intended contract. |
| 60–69 | D | 🔴 | A material health gate is failing or the capability is not release-ready. |
| 0–59 | F | 🔴 | The capability or system gate is unhealthy and requires remediation. |
| No reliable evidence | — | ⚪ | Source of truth is missing or could not be queried. |

Additional gates:

- No feature can be Green without at least one passing behavior test on an
  intended surface.
- Cross-surface claims require surface-specific evidence; one successful build is
  not runtime parity.
- Provider-backed workflows remain Amber when only mocks are exercised, even if
  avoiding paid calls is intentional.
- Any critical advisory, known data-loss path, secret exposure, unsafe billing
  behavior, or broken primary workflow caps the product at Red.
- High advisories, unresolved release proof, or a conflicting runtime contract cap
  the product at Amber unless reachability proves a Red condition.
- The overall score uses the category weights below; it is not a simple average
  that lets numerous small utilities hide a weak core workflow.

## Cohesive feature dashboard

The compact score is `V/C/R/X/S/E → total` using the rubric above.

### Create and improve — 84.5/100 · 25% of product score

| Feature | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Prompt editor and Markdown preview | Write, edit, clear, preview, and move between editor layouts in `CreateEditorPane`. | `18/18/13/14/14/12 → 89` | 🟢 | Unit/UI coverage and all three builds pass. No current visual-regression baseline. |
| Enhancement modes and provider execution | Seven modes build a structured system prompt, stream or parse a provider result, expose notes/variants, and persist runs. | `18/16/10/10/13/11 → 78` | 🟡 | Provider adapters and mocked execution pass. No real-provider runtime or output-quality corpus was exercised. |
| Prompt score, lint, and quick fixes | Score role, task, format, constraints, and context; flag deterministic lint issues and apply fixes. | `17/16/12/14/14/7 → 80` | 🟡 | Mechanics are tested. There is no versioned benchmark set proving the heuristic correlates with better prompt outcomes. |
| Variables and Ghost Variables | Detect placeholders, collect values, resolve previews, and handle inferred/missing values. | `17/18/13/14/14/10 → 86` | 🟢 | Resolver and schema tests pass; the active feature spec still describes parts of this as future work. |
| PII scan, redaction, and sensitive-input guard | Detect sensitive input, preview redaction, block or sanitize execution, and avoid storing raw secrets. | `18/19/14/14/15/12 → 92` | 🟢 | Scanner, redaction, modal, telemetry, and API-safety tests pass. |
| Follow-up actions and workflow handoffs | Copy results, continue refinement, and route output into editor/composer workflows. | `17/17/12/14/13/9 → 82` | 🟡 | UI behavior is covered; cross-shell runtime handoffs and cancellation recovery need dedicated smoke coverage. |

### Library and prompt assets — 88.8/100 · 20% of product score

| Feature | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Save, edit, delete, and smart naming | Persist prompts with metadata, suggest stable titles, reopen, update, and remove entries. | `18/19/14/14/14/11 → 90` | 🟢 | Schema, naming, hook, and UI tests pass. |
| Search, tags, sort, reorder, and collections | Organize a growing local library and move entries through collection-aware views. | `18/19/14/14/14/11 → 90` | 🟢 | CRUD, matching, collection, ordering, and UI tests pass. |
| Starter Libraries and preset packs | Discover curated packs, preview imports, avoid duplicates, and load Dave's 14-instrument suite. | `19/19/14/15/15/12 → 94` | 🟢 | Unit/import tests pass; exact-baseline production smoke verified 14/14 titles, reload persistence, clean console, and clean app requests. |
| JSON import/export, URL share, and legacy migration | Move prompts between installations while normalizing old schemas and resolving duplicates. | `18/18/13/14/14/10 → 87` | 🟢 | Codec, migration, matching, and persistence tests pass. Large-library and malformed-file browser tests are still thin. |
| Version history, diff, and restore | Preserve prompt revisions, compare text changes, and restore an earlier version. | `18/19/14/14/14/10 → 89` | 🟢 | Schema, version, diff, and UI tests pass. |
| Golden response benchmark | Pin a successful run, compare later output, and retain benchmark metadata with a prompt. | `18/17/12/14/14/8 → 83` | 🟡 | Schema and UI mechanics pass. No stable semantic-quality threshold or regression corpus exists. |

### Compose, evaluate, and learn — 83.8/100 · 20% of product score

| Feature | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Composer | Build a larger prompt from ordered instruments and route the result back into creation/evaluation. | `18/18/12/14/13/10 → 85` | 🟢 | Component and handoff tests pass. Persisted multi-step recovery lacks a focused browser test. |
| Test cases and batch runs | Define reusable inputs, execute a prompt across cases, and save outcomes as evaluation runs. | `18/16/10/12/12/11 → 79` | 🟡 | CRUD and mocked execution pass. No real-provider or deterministic semantic pass/fail benchmark is run in CI. |
| Run timeline and evaluation history | Persist successful, failed, blocked, and canceled runs; filter, inspect, annotate, and export them. | `18/19/14/14/14/9 → 88` | 🟢 | Store, schema, hook, graph/export, and panel tests pass. `FEATURE_SPEC_RUN_TIMELINE.md` incorrectly says the feature is not started. |
| A/B compare and word diff | Run two variants, compare output/latency, inspect a diff, record preference, and retain experiment history. | `18/17/11/12/13/10 → 81` | 🟡 | Compare/diff and mocked adapter tests pass. Pro gating and provider runtime are not covered end to end on every shell. |
| Notebook and pads | Keep local scratchpads, edit and export notes, and promote useful content into the prompt library. | `18/18/14/14/13/9 → 86` | 🟢 | Shortcut, persistence, export, and promotion tests pass. |

### Product experience — 87.7/100 · 10% of product score

| Feature | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Navigation, routes, command palette, and shortcuts | Provide consistent Create, Library, Evaluate, Compare, Compose, and Notebook navigation with hash deep links and keyboard access. | `18/18/13/15/14/10 → 88` | 🟢 | Registry, route, navigation, and shortcut tests pass. `CURRENT_MENU_SYSTEM.md` incorrectly says the UI is not URL-routed. |
| Theme, density, responsive UI, and accessibility | Adapt contrast, spacing, layouts, focus, keyboard behavior, and touch controls across viewport sizes. | `18/18/13/14/14/10 → 87` | 🟢 | Theme/a11y unit tests and 400/768 px Playwright smoke tests pass. No automated screen-reader or full visual-diff suite exists. |
| Session restore and error recovery | Restore editor/UI state and present explicit blocked, failed, canceled, and boundary-error states. | `18/19/14/14/14/9 → 88` | 🟢 | Session, execution-flow, failed-run, and ErrorBoundary coverage pass. Browser crash/interrupted-write recovery is untested. |

### Providers and product surfaces — 79.5/100 · 10% of product score

| Feature/surface | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Provider registry and settings | Normalize Anthropic, OpenAI, Gemini, OpenRouter, and Ollama models, credentials, payloads, and results behind one adapter contract. | `18/16/10/10/14/10 → 78` | 🟡 | Adapter/settings tests pass. No zero-cost provider contract server or real-provider matrix currently proves runtime parity. |
| Chrome extension | Deliver the full local-first workbench in an MV3 side panel with service-worker provider calls and Chrome storage. | `18/17/12/13/13/9 → 82` | 🟡 | Current-main Extension CI and mocked Playwright flow pass. Seven advisories remain, bundle JS is 613.81 kB, and Chrome Web Store release is not complete. |
| Hosted web app | Provide a signed-in convenience/evaluation surface at `/app/` using the guarded proxy and shared frontend. | `18/17/11/12/13/9 → 80` | 🟡 | Build, API safety, deployment, and starter-library production flow pass. The full authenticated create→enhance→evaluate path was not run, and paid-provider execution remains deliberately unexercised. |
| Tauri desktop | Deliver the full provider workbench as a desktop shell with local settings and distributable artifacts. | `17/16/10/12/13/10 → 78` | 🟡 | Frontend build passes; the latest applicable Desktop Build workflow is green. Five advisories remain, JS is 614.34 kB, and an installed/signed current-baseline runtime was not exercised. |

### Safety, identity, and cost controls — 88.0/100 · 10% of product score

| Feature | Intent and current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Clerk identity, billing state, and Pro gates | Bind account identity to entitlement state and gate A/B, batch, collections, export, and other Pro workflows. | `16/17/11/12/15/10 → 81` | 🟡 | Billing-state and owner-entitlement tests pass and production billing defaults fail closed. No Stripe call was made; live checkout/portal/webhook behavior is therefore unverified by design. |
| Telemetry and privacy defaults | Keep telemetry explicit, opt-in, redacted, and disabled when storage or configuration is unavailable. | `17/19/15/14/15/13 → 93` | 🟢 | Privacy-safe telemetry and production-default tests pass; no telemetry action was invoked. |
| Proxy, API safety, and paid-call guards | Allowlist origins/providers, validate requests, constrain failure modes, and keep disabled backends terminal. | `18/19/14/13/15/11 → 90` | 🟢 | All 52 API safety tests pass. This audit made no provider or billing request. |

### Documentation and delivery system — 65.3/100 · 5% of product score

| System gate | Current implementation | Score | 🚦 | Evidence and open gate |
| --- | --- | ---: | --- | --- |
| Product docs and onboarding truth | README, architecture, roadmap, menu, feature specs, public guide, and handoff artifacts describe overlapping product states. | `14/12/9/11/14/6 → 66` | 🔴 | Docs lint passes, but Run Timeline, Ghost Variables, Golden Response, and URL-routing docs contradict shipped code; working reports are stale. |
| CI, release, and Node contract | API Safety, Extension CI, Docs CI, Pages, Desktop Build, and Release workflows cover different paths. | `17/16/10/10/14/5 → 72` | 🟡 | Current-main API Safety/Extension CI/Pages pass. `.nvmrc`, engines, docs, and guards require Node 20 while extension/desktop/release CI runs Node 22; the guard only warns. |
| Dependency security | Four lockfiles support docs, extension, web, and desktop packages. | `16/11/8/9/8/3 → 55` | 🔴 | Audit reports: docs root 2 high/2 moderate; extension 6 high/1 low; web 5 high; desktop 5 high. Fixes exist, but several require deliberate major upgrades. |
| Bundle and runtime performance | Vite builds all surfaces; web splits provider code while extension/desktop ship a larger shared bundle. | `15/13/9/10/14/7 → 68` | 🔴 | Builds pass. Extension JS is 613.81 kB (180.56 kB gzip) and desktop JS is 614.34 kB (180.73 kB gzip), both above Vite's 500 kB warning threshold; no performance budget exists. |

## Evidence ledger

| Check | Baseline result | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Shared unit suite | 49 files, 472 tests passed | Broad deterministic behavior across hooks, schemas, components, providers, persistence, billing, PII, telemetry, and evaluation mechanics | Real provider correctness or semantic output quality |
| API safety suite | 52 tests passed | Proxy, disabled-backend, webhook/billing boundary, configuration, and fail-closed contracts | Live third-party provider or Stripe behavior |
| Extension Playwright smoke | Refine/save mocked flow passed | Built MV3 shell launches and completes its primary local workflow | Store installation or real provider execution |
| Responsive Playwright smoke | 400 px and 768 px passed | Core controls remain visible and operable at tested widths | Full visual fidelity or assistive-technology behavior |
| Production Starter Library smoke | 14/14 titles, reload persistence, no console errors, no failed app requests | The exact audited code baseline reached production and its new library workflow works live | Full authenticated authoring/evaluation coverage |
| Builds | Extension, hosted web, and desktop frontend passed | All shared frontend targets compile | Installed desktop behavior, CWS behavior, or semantic quality |
| Current-main GitHub checks | API Safety, Extension CI, and Pages succeeded at `9c0661b` | Applicable current-main workflows are green | Exact-baseline Desktop Build, release signing, or store publishing |
| Dependency audits | 4/4 package roots queried | Current advisory counts and fix availability are known | Exploitability; reachability still requires package-by-package review |

No Anthropic, OpenAI, Gemini, OpenRouter, Stripe, billing, or telemetry action was
invoked to produce this dashboard.

## Surface availability matrix

`Full` means the shared feature is intended and exposed there. `Scoped` means the
surface deliberately narrows or changes the implementation. `N/A` means it is not
part of that surface's contract.

| Capability family | Extension | Hosted web | Desktop |
| --- | --- | --- | --- |
| Create, score, lint, variables, PII | Full | Full | Full |
| Library, collections, starter packs, versions, golden response | Full | Full | Full |
| Composer, test cases, runs, A/B, Notebook | Full | Full, subject to auth/Pro/backend gates | Full |
| Providers | Five via service worker | Scoped; Anthropic-first proxy plus local Ollama path | Five direct/local paths |
| Persistence | Chrome storage + IndexedDB | Browser storage + IndexedDB | Local storage + IndexedDB |
| Identity and billing | Entitlement-aware | Clerk/entitlement-aware | Entitlement-aware |
| Distribution proof | Unpacked/CI; store pending | Production deployed | CI artifacts; signed install not verified |

## Not counted as current-main features

| Item | State | Reason excluded from feature score |
| --- | --- | --- |
| Native iPhone/iPad app | Separate prototype branch/plan | The SwiftUI implementation is not present on current `main`; JSON contracts are the intended sharing boundary. |
| Multi-step autonomous prompt chains | Deferred | Specs describe future chaining, but the current composer and follow-up handoffs are not an autonomous chain runtime. |
| Team playbooks or shared cloud library | Deferred | Current persistence is local-first; no team synchronization contract is shipped. |
| Public Chrome Web Store release | Release task, not a feature | Submission assets/checklist exist, but public-store availability is not verified. |

## Ranked upgrade queue

1. **Dependency and Node contract remediation** — execute the prompt at the top of
   this dashboard. Exit: one enforced Node LTS and zero high/critical advisories.
2. **Deterministic prompt-quality evaluation corpus** — version representative raw
   prompts, expected lint/score properties, provider-response fixtures, golden
   comparisons, and regression thresholds. Exit: the core promise is measured,
   not only the UI mechanics.
3. **Cross-surface primary-flow smoke matrix** — exercise create→enhance→save→test→
   history→reload with a local deterministic provider fixture on extension, web,
   and desktop. Exit: no paid request and three surface-specific passes.
4. **Bundle budgets and code splitting** — lazy-load evaluation/provider-heavy
   areas and enforce build budgets. Exit: no Vite large-chunk warnings and tracked
   load/interaction budgets.
5. **Documentation reconciliation** — update or archive contradictory active
   specs and make this dashboard the feature-status source of truth. Exit: active
   docs agree with routes, shipped features, runtime contract, and release state.

## Refresh protocol

Update this dashboard when a feature, provider, surface, dependency baseline, or
release state changes:

1. fetch and inspect current `origin/main`;
2. query tests, builds, audits, applicable CI, deployment, and runtime source of
   truth;
3. score each changed row in all six dimensions and record exact evidence;
4. recompute category and weighted product scores;
5. apply the cap rules;
6. replace the top executable prompt with the highest-risk actionable gap;
7. commit and push the dashboard update directly to `main` with the product change.

Never raise a score from an implementation claim alone. If a source cannot be
queried, mark the affected claim Grey or reduce Evidence rather than inferring a
pass.
