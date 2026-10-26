# Decisions log

Open and resolved decisions across the PromptLab ecosystem. Format:

```
## [ID] Decision title
Status: open | resolved | deferred
Owner: who needs to decide
Date opened: YYYY-MM-DD
Date resolved: YYYY-MM-DD (if applicable)

Context: why this decision exists
Options: what was considered
Decision: what was chosen (if resolved)
Rationale: why
Consequences: what this unlocks or closes off
```

---

## Open decisions

---

### [D-017] October intake triage and slice order

Status: open
Owner: Dave
Date opened: 2026-10-26

Context: Dave's Scratch intake list (October 21 to 26) was rated and specified in [`OCTOBER_INTAKE_BRIEF.md`](OCTOBER_INTAKE_BRIEF.md). Implementation waits for Dave's go.

Options and recommendations: D-INT-1 live Scratch formatting (recommended: live-preview Markdown editor, storage stays Markdown); D-INT-2 Dual Pane after Scratch beside Write (recommended: retire it as a destination, routes open Write); D-INT-3 feedback destination (recommended: local append and copy only); D-INT-4 meaning of generic prompt mode (recommended: a General enhance mode); D-INT-5 slice order (recommended: 0, 1, 2, 3, 6, 4, 5, 7); D-INT-6 release cut (recommended: show build date and revision now, tag 1.8.0 when release gates pass, then 1.9.0-dev).

Consequences: Slice 0 is a routine bug fix and needs no decision. The other slices start in the chosen order after the go. Unanswered recommendations stay open.

---

### [D-016] PromptLab library storage sequence

Status: direction decided; implementation and hosted provider pending
Owner: Dave
Date opened: 2026-10-23
Date direction decided: 2026-10-23

Decision: Support both storage modes. Start with a folder Dave chooses in iCloud Drive, then add optional hosted storage. Preserve all history and backups. The app and API use the same logical library, identity, revisions and command service.

Scope: Dave requested reconciliation of the existing proposal and plan before implementation. No runtime work, personal-data migration, provider provisioning or public policy activation is authorized by this documentation change. The actual folder is selected through the delivered picker later.

Rationale: A user-owned durable library and supported API remove dependence on a browser profile and mouse automation while retaining complete recovery and portability.

Consequences: The previous web-first Neon recommendation is superseded as the execution sequence. The former four-kind schema, 25-version cap and omission of runs/evaluations/Scratch cannot meet the preservation requirement. The revised [proposal](account-library-sync.md) and [build slices](account-library-sync-slices.md) define folder acceptance before hosted work. Existing runtime policy remains unchanged until implemented and verified.

Open before hosted work: provider/cost, region, encryption/key recovery and history/backup erasure policy. Neon/Clerk is a candidate, not a selected service. Desktop/local-service first, immutable package and explicit backend switches are proposed implementation defaults for review. Mirrors DEC-87 in DB | Decisions; prior options and recommendation remain in [Git history](https://github.com/DaveHomeAssist/prompt-lab/blob/7a1ad40/prompt-lab-source/docs/DECISIONS.md).

---

### [D-001] PLB nav strategy — hash mode vs state router

Status: resolved
Owner: Dave
Date opened: 2026-03-25
Date resolved: 2026-03-29

Context: PromptLab's internal navigation strategy needs to be locked before Phase 2 UI work begins. Two viable approaches are on the table.

Options:
- React Router hash mode (`/#/library`, `/#/evaluate`) — URL-based, shareable, predictable, compatible with MV3 extension context
- State router (React state only, no URL changes) — simpler, no URL coupling, but harder to deep-link and debug

Decision: Hash-based routing (`location.hash`). Routes: `#/library`, `#/create`, `#/evaluate`, `#/settings`.

Rationale: VS Code webviews don't support pushState — hash routing is the only option that works identically across extension, desktop, and web. This decision does not block framework or routing changes elsewhere when the product needs them. Supports deep-linking (`#/evaluate/run/abc123`) and browser back/forward via hashchange. The web app is a demo surface, not the primary product, so clean URLs and SEO are not requirements.

Consequences: Phase 2 UI work is unblocked. Create workflow can split into `#/create/prompt`, `#/create/config`, `#/create/run` to reduce verticality. No router library needed — reduces bundle size. If web app ever becomes the primary surface, can migrate to pushState later.

As shipped: the hash-routing decision held, but the specific routes above were never built as written. The record is left intact for provenance; this block is what actually runs. Source of truth is `ROUTE_TO_STATE` in `prompt-lab-extension/src/lib/navigationRegistry.js`.

State values below are the literal ones `resolveRouteState` returns, so this
table can be checked against the registry rather than merely read alongside it.
`scripts/docs-consistency.mjs` fails if a row drifts.

| Route | State | Reads as |
| --- | --- | --- |
| `/` | `create` · `editor` | Create, editor |
| `/library` | `create` · `library` | Create, library |
| `/composer` | `create` · `composer` | Create, composer |
| `/split` | `create` · `split` | Create, dual pane |
| `/split/write` | `create` · `split` · `editor` | Dual pane, compact, editor pane |
| `/split/library` | `create` · `split` · `library` | Dual pane, compact, library pane |
| `/evaluate` | `runs` · `history` | Runs, history |
| `/compare` | `runs` · `compare` | Runs, compare |
| `/scratch` | `notebook` | Notebook — canonical |
| `/pad` | `notebook` | Notebook — legacy alias, accepted but never emitted |

Differences from the decision as written:

- there is no `#/create`; the create surface is the root route `/`
- there is no `#/settings` route; settings open as a modal, not a route
- run-level deep links (`#/evaluate/run/abc123`) were never implemented
- the `#/create/prompt` / `#/create/config` / `#/create/run` split never happened; Create gained `library`, `composer`, and `split` subviews instead
- a router library *is* used — `useRouteSync.js` builds on `react-router-dom`, contrary to "no router library needed"

`/scratch` is canonical for the notebook view. `/pad` is accepted for links saved under the Notebook-era UI, but `stateToRoute` always emits `/scratch`.

---

### [D-002] DaveLLM cluster — LLM inference engine

Status: open
Owner: Dave
Date opened: 2026-03-25

Context: The DaveLLM cluster assumes Ollama for local inference across Windows nodes (Duncan, GP66, Katana x2). This has not been confirmed.

Options:
- Ollama — easiest setup, good model support, REST API compatible
- llama-server (llama.cpp) — more control, lower overhead, less tooling

Consequences: Cluster cannot be deployed until this is confirmed and LAN IPs for all three Windows machines are provided.

---

### [D-003] DaveLLM cluster — LAN IPs

Status: open (partial)
Owner: Dave
Date opened: 2026-03-25

Context: Orchestrator routing to cluster nodes requires static or known LAN IPs for GP66, Katana x2 (x2), and Duncan.

Progress (2026-03-29):
- Walter (MSI GP66 Leopard): 192.168.1.193 — confirmed up, Ollama status pending
- Duncan (Windows PC): 192.168.1.243 — confirmed, Ollama running (gemma3:27b, gpt-oss:20b, gpt-oss:120b)
- Home Assist (Dell Server): 192.168.1.215 — confirmed up (was .214, corrected)
- Katana 1 + Katana 2: still offsite at Convention Center, IPs pending return

Action remaining: Confirm Ollama on Walter and Home Assist. Assign static IPs via router DHCP reservation. Collect Katana IPs on return.

Consequences: Partially unblocked — Duncan is ready for cluster work. Full deployment blocked on remaining nodes.

Update (2026-10-06): superseded for DaveLLM routing. DaveLLM's macOS launcher resolves its nodes (Dominic and Walter, plus Duncan when it is online) from live Tailscale peer records at every start, so the router no longer depends on LAN IPs or DHCP reservations. The 2026-03-29 addresses above are historical. Prompt Lab reaches the cluster only through DaveLLM (`scripts/eval-davellm.mjs` and `POST /eval/chat`; see `DAVELLM_EVAL.md`).

---

### [D-004] Act Two Catering — Notion leads pipeline

Status: resolved
Owner: Dave
Date opened: 2026-03-26
Date resolved: 2026-03-29

Context: Quote form → Netlify Function → Notion API pipeline is fully architected.

Decision: Notion database created for quote form submissions with table, pipeline board, calendar, and form views. Integration key sharing still requires manual Notion token creation.

Consequences: Quote form backend delivery is wired (POST to /.netlify/functions/quote). Full leads pipeline functional.

---

### [D-005] Act Two Catering — 4 remaining menu photos

Status: open
Owner: Dave / Tom
Date opened: 2026-03-26

Context: 19 of 24 image slots filled with real photography. 4 menu slots still on emoji fallback: 3 croquette variants and the dipping trio.

Action needed: Acquire or shoot the 4 remaining photos. Resize to spec and drop into `act-2-photos/`.

---

### [D-006] Trailkeeper store schema

Status: open
Owner: Dave (Claude-first task)
Date opened: 2026-03-25

Context: Trailkeeper requires a unified `trailkeeper.store` localStorage schema before any independent feature development can begin. This is a hard architectural dependency — Codex cannot implement features without the schema defined first.

Action needed: Schedule a Claude session to define and document the full store schema. Output goes to `trailkeeper/docs/STORE_SCHEMA.md`.

Consequences: All Trailkeeper feature work is blocked until this is done.

---

### [D-007] Garden OS — repo integrity

Status: resolved
Owner: Dave
Date opened: 2026-03-25
Date resolved: 2026-03-26

Context: Garden OS experienced git index corruption. Fresh clone created, two build-breaking bugs fixed (ui-binder.js duplicate declaration, save.test.js teardown order), 324/324 tests pass, build clean, pushed to main.

---

### [D-008] ShieldBox — production URL + brand spelling

Status: open
Owner: Dave / ShieldBox client
Date opened: 2026-03-25

Context: ShieldBox quote form client feedback has been shipped. Two items remain unresolved before the project can be considered closed.

Action needed:
- Confirm production URL
- Lock brand spelling (ShieldBox vs Shieldbox vs SHIELDBOX)

---

### [D-009] PromptLab — untracked files decision

Status: resolved
Owner: Dave
Date opened: 2026-03-25
Date resolved: 2026-03-26

Context: 27 uncommitted files split into 5 clean commits covering docs cleanup, app refactor, persistence flow, build config, and a new test. Remaining untracked items (scratch files, misplaced garden-os-fresh clone) are not worth committing.

---

### [D-010] PLB feature gating strategy — free vs paid tier

Status: resolved
Owner: Dave
Date opened: 2026-03-27
Date resolved: 2026-03-30

Context: D-R03 resolved the pricing structure (free / $9 per month / $100 annual) but did not define which features live behind the paywall. This must be decided before any gating logic is implemented.

Options:
- Gate by usage limits (number of prompts, runs per day, library size)
- Gate by feature access (A/B testing, diff viewer, collections, export)
- Gate by provider access (free tier limited to one provider)
- Hybrid (usage + feature gates)

Decision: Hybrid — free tier gets all providers + basic editor + single runs + library (50 prompts) + basic history. Paid tier gates A/B testing, side-by-side diff viewer, batch runs, collections, CSV/JSON export, priority support.

Rationale: Free users need multi-provider access to experience the core value (comparing LLM outputs). Gating the analysis and workflow tools creates a natural upgrade moment: "I want to run these head-to-head automatically" triggers A/B testing paywall. A lightweight Stripe billing path with local plan caching keeps the app auth-light while still capturing customer/subscription data.

Consequences: Billing integration unblocked. Implementation path: (1) add `plan` field to local storage, (2) Stripe checkout + customer portal routes, (3) Pro sync by billing email on app load, (4) `if (plan === 'pro')` guards on gated features, (5) "Upgrade to Pro" modal linking to Stripe checkout.

---

## Resolved decisions

---

### [D-015] Create annotations — first slice and rollout

Status: resolved
Owner: Dave
Date opened: 2026-10-17
Date resolved: 2026-10-18

Context: Dave annotated the hosted Create screen and a mobile screenshot on 2026-10-17 (C1 to C7, M1). Codex proposed implementation details and acceptance checks based on those annotations; they are recommendations, not approved requirements. All seven findings were confirmed against `e0b4a3b` and placed in the Enhance workspace redesign slices: C2 in slice 2, C6 and C7 in a new slice 2A, and C1, C3, C4 and C5 in slice 3. Source: [`evidence/workspace-annotations-2026-10-17.md`](evidence/workspace-annotations-2026-10-17.md).

Options: see D-ENH-7 (which slice first) and D-ENH-8 (where C6 and C7 ship) in [`ENHANCE_WORKSPACE_REDESIGN_BRIEF.md`](ENHANCE_WORKSPACE_REDESIGN_BRIEF.md#decisions). Recommended: D-ENH-7 **A** (slice 2A first) and D-ENH-8 **B** (hosted web, both layouts).

Decision: D-ENH-7 **A** (slice 2A first) and D-ENH-8 **B** (hosted web, both layouts), chosen by Dave on 2026-10-18. Claude builds slice 2A; Codex keeps L1 to L8.

Consequences: the answers authorise the first Create annotation implementation. Library items L1 to L8 are outside this decision; they belong to the separate Library workspace controls draft.

---

### [D-014] Enhance redesign slice 2 — visual identity and layout

Status: resolved
Owner: Dave
Date opened: 2026-10-17
Date resolved: 2026-10-18

Context: D-013 folds the refinement workspace mockup into the Create view as the reference for slice 2 of the Enhance workspace redesign. The mockup carries a graphite, smoked-glass and electric-cyan look and a three-column Draft / Refine / Review layout, while the brief excludes new visual language and slice 1 shipped two panes with a control row.

Options: see D-ENH-5 (visual identity) and D-ENH-6 (layout) in [`ENHANCE_WORKSPACE_REDESIGN_BRIEF.md`](ENHANCE_WORKSPACE_REDESIGN_BRIEF.md#decisions). Recommended: D-ENH-5 **A** (keep the current palette; take structure and behaviour only, and route the graphite direction to the visual pass) and D-ENH-6 **A** (keep two panes; conditions live in the control row).

Decision: D-ENH-5 **B** (restyle the Create view in graphite) and D-ENH-6 **A** (two panes; conditions in the control row), chosen by Dave on 2026-10-18. Dave then held the graphite restyle until the Library palette work (L4) lands, so it builds on those palette tokens.

Consequences: the answers fix slice 2's visual spec and layout. Slice 2 behaviour (changed-condition markers, candidate receipt) does not depend on them and can be specified now.

---

### [D-013] Refinement workspace mockup — integration scope (DEC-01)

Status: resolved
Owner: Dave
Date opened: 2026-10-16
Date resolved: 2026-10-17

Context: A standalone refinement workspace mockup (Draft / Refine / Review, local simulation only) was reviewed on 2026-10-16 and restyled on 2026-10-17. Its review left one scope question: integrate it into the product or keep it as a separate workspace.

Options: A. Integrate as a focused Create view, keeping the Library / Evaluate / Scratch structure. B. Keep it as a separate experimental workspace, which permits more experimentation but adds a navigation surface.

Decision: **A**, chosen by Dave on 2026-10-17.

Rationale: Create already holds the refinement lifecycle, and the Enhance workspace redesign is reshaping it in flagged slices; a second workspace would duplicate that path and add a destination the nav plan (Phase B1) has not approved.

Consequences: The mockup becomes the reference for slice 2 of [`ENHANCE_WORKSPACE_REDESIGN_BRIEF.md`](ENHANCE_WORKSPACE_REDESIGN_BRIEF.md) (changed-condition markers, a candidate receipt) rather than a new surface. Its Evaluate comparison bench and Scratch capture channels are out of scope and would need their own briefs. Opens D-014 (slice 2 visual identity and layout).

---

### [D-012] Enhance workspace redesign — sequencing, scope, rollout, quality label

Status: resolved
Owner: Dave
Date opened: 2026-10-15
Date resolved: 2026-10-15

Context: The Enhance workspace redesign brief (`ENHANCE_WORKSPACE_REDESIGN_BRIEF.md`) left four choices open before slice 1 could start: how it relates to the draft Expanded-defaults PR #138, whether the left navigation rail (viewport plan Phase B1) is in scope, how it rolls out, and what happens to the 0–5 quality number.

Options: see the brief's Decisions table (D-ENH-1 to D-ENH-4).

Decision: Dave chose the recommended option for each. D-ENH-1 **B**: build slice 1 now on the current enhance modes, and the Strategy / Task / Destination split (slice 2) after PR #138 lands. D-ENH-2 **A**: Create workspace only; the nav rail stays with Phase B1. D-ENH-3 **A**: hosted web behind a flag first, then extension and desktop. D-ENH-4 **A**: keep the number, labelled as a heuristic structure check.

Rationale: Slice 1 needs nothing from PR #138; keeping the nav change separate keeps its own sign-off and rollback; a flag on hosted web keeps Vercel instant rollback and matches the viewport Phase A pattern.

Consequences: Slice 1 (two-pane Create, one primary Save, overflow for secondary actions, assumptions count in the result header) is authorised behind a flag on hosted web. Phase B1 navigation and PR #138 remain separately open.

---

### [D-R01] PLB data layer — Dexie.js vs SQLite WASM

Status: resolved
Date resolved: 2026-03 (prior sprint)

Decision: Dexie.js
Rationale: SQLite WASM is incompatible with MV3 extension context. Dexie.js provides a clean IndexedDB abstraction that works in service workers and content scripts.
Consequences: All run logging, prompt storage, and library state lives in Dexie/IndexedDB. No file system access.

---

### [D-R02] Monetization platform — Stripe vs Gumroad

Status: resolved
Date resolved: 2026-03 (prior sprint)

Decision: Stripe
Rationale: Capturing customer identity, subscription state, portal activity, and webhook events is more valuable than the earlier fee-optimization argument. Stripe better matches the current need to connect billing to product analytics without restoring the prior full auth stack.
Consequences: All Prompt Lab subscriptions run through Stripe hosted checkout, Stripe billing portal, and Stripe webhooks.

---

### [D-R03] PLB pricing structure

Status: resolved
Date resolved: 2026-03-26

Decision: Freemium — free tier / $9 per month / $100 annual
Rationale: Gives users a reason to try without friction, upgrade for real features, and commit annually for a discount.
Consequences: Feature gating strategy needs to be defined — what lives behind the paywall vs free tier.

---

### [D-R06] PLB billing implementation path

Status: resolved
Date resolved: 2026-03-31

Decision: Stripe hosted checkout + Stripe customer portal, with Pro access synced by billing email and cached locally in Prompt Lab storage.
Rationale: Stripe captures customer and subscription data that the product can use for upgrade, retention, and support workflows without forcing Prompt Lab back into a full account system. A billing-email sync flow preserves the app's local-first posture while making customer identity durable on the backend.
Consequences: Prompt Lab now depends on Stripe-backed billing API routes (`/api/billing/checkout`, `/api/billing/license`, `/api/billing/portal`, `/api/billing/webhook`) plus local `plan` and customer state in app storage. Pro gating is implemented in the shared React shell for A/B testing, diff view, batch runs, collections, and exports.

---

### [D-R04] SAP hosting — GitHub Pages vs Vercel

Status: resolved
Date resolved: 2026-03-25

Decision: Vercel
Rationale: Custom domain support, serverless function support (needed for AI beat generation endpoint), better deploy pipeline.
Consequences: standardacidprocedure.com and www cutover complete. Drum machine AI endpoint running as Vercel serverless function.

---

### [D-R05] System by Dave brand palette

Status: resolved
Date resolved: 2026-03-25

Decision: Rust / sand / charcoal (#c0623a, #e8dece, #1c1917)
Rationale: Hard no on lime green (PromptLab territory). Muted and sophisticated direction selected.
Consequences: All System by Dave Notion Marketplace assets use this palette. Distinct from PLB Acid Lab v1 identity.

---

### [D-011] Native SwiftUI app for iPhone & iPad vs Tauri Mobile shell

Status: resolved
Owner: Dave
Date opened: 2026-07-26
Date resolved: 2026-07-28

Context: The July 26 work list calls for a native Swift iPad Prompt Lab app. That direction conflicts with `MOBILE_DEPLOYMENT_ROADMAP.md`, whose stated goal is to ship iOS/Android **without forking the shared frontend** by wrapping the existing React app (which lives in `prompt-lab-extension/src/`) in a Tauri Mobile shell. A native app is a deliberate fork of the UI layer, so the decision must be recorded before code lands. This ADR is the gate the plan (`IPAD_NATIVE_APP_PLAN.md`) requires.

Options:
- **Tauri Mobile shell** (existing roadmap) — one React codebase; extension/desktop parity for free. Cost: WebView UX, weaker iPad multitasking/keyboard/pencil support, app-review risk for WebView-heavy apps.
- **Native SwiftUI universal app** — first-class iOS/iPadOS UX (Split View, Stage Manager, hardware keyboard, Keychain-native key storage, best App Store positioning). Cost: a second UI codebase; feature-drift risk against the React app.
- **Hybrid: SwiftUI shell + shared JS core via JavaScriptCore** — native chrome, shared enhance/parsing logic. Cost: bridging complexity; still two UI trees.

Decision: **Native SwiftUI universal app targeting iPhone + iPad (iOS/iPadOS 17+).** The sharing boundary is the **JSON contracts, not the UI** — the enhance contract (`buildSystemPrompt` in `constants.js`), `promptSchema.js`, and `evalSchema.js` are portable as data. Scope is the focused v1 in `IPAD_NATIVE_APP_PLAN.md`; A/B, composer chains, billing, telemetry, and PII are deferred. BYO API keys in Keychain; no Clerk/Stripe auth in v1.

Rationale: The prompt workbench is a keyboard- and multitasking-heavy tool where WebView UX is a real ceiling on iPad, and the extension/desktop already run auth-free with client-side keys, so a BYO-key native app matches the existing posture. Contract-level sharing (not code-level) keeps drift risk bounded and testable via import/export round-trips.

Consequences: Introduces `prompt-lab-ios/` (universal iPhone + iPad) as a native surface and a second UI codebase to maintain. Every change to the enhance contract in `constants.js` becomes a cross-surface API change (add a checklist item to `docs/PIPELINE.md`). The Tauri Mobile roadmap remains a deferred fallback if native retention does not justify the second codebase.

Implementation status (2026-08-19): M0-M3 are implemented in `prompt-lab-ios/`, with contract parity enforced through `contracts/promptlab-enhance-contract-v1.json`, Vitest, and XCTest. M4 distribution remains blocked on production bundle identity, store assets, Apple distribution access, privacy metadata, and release criteria.

---

*Last updated: 2026-08-19*
*Related: CLAUDE.md, PIPELINE.md, PROMPT_SYSTEM.md, IPAD_NATIVE_APP_PLAN.md*
