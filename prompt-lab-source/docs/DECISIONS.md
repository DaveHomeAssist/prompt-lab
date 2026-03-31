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

Rationale: VS Code webviews don't support pushState — hash routing is the only option that works identically across extension, desktop, and web. No framework dependency needed. Supports deep-linking (`#/evaluate/run/abc123`) and browser back/forward via hashchange. The web app is a demo surface, not the primary product, so clean URLs and SEO are not requirements.

Consequences: Phase 2 UI work is unblocked. Create workflow can split into `#/create/prompt`, `#/create/config`, `#/create/run` to reduce verticality. No router library needed — reduces bundle size. If web app ever becomes the primary surface, can migrate to pushState later.

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

Rationale: Free users need multi-provider access to experience the core value (comparing LLM outputs). Gating the analysis and workflow tools creates a natural upgrade moment: "I want to run these head-to-head automatically" triggers A/B testing paywall. No auth system needed at launch — Lemon Squeezy license key validates locally via a `plan` field in Dexie.

Consequences: Lemon Squeezy integration unblocked. Implementation path: (1) add `plan` field to Dexie, (2) license key check on app load, (3) `if (plan === 'pro')` guards on gated features, (4) "Upgrade to Pro" modal linking to Lemon Squeezy checkout.

---

## Resolved decisions

---

### [D-R01] PLB data layer — Dexie.js vs SQLite WASM

Status: resolved
Date resolved: 2026-03 (prior sprint)

Decision: Dexie.js
Rationale: SQLite WASM is incompatible with MV3 extension context. Dexie.js provides a clean IndexedDB abstraction that works in service workers and content scripts.
Consequences: All run logging, prompt storage, and library state lives in Dexie/IndexedDB. No file system access.

---

### [D-R02] Monetization platform — Lemon Squeezy vs Gumroad

Status: resolved
Date resolved: 2026-03 (prior sprint)

Decision: Lemon Squeezy
Rationale: Fee structure analysis favored Lemon Squeezy. Better VAT handling for international sales.
Consequences: All PLB product listings, prompt packs, and subscription tiers will be managed through Lemon Squeezy.

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

Decision: Lemon Squeezy hosted checkout + license key activation/validation, with plan state cached locally in Prompt Lab storage.
Rationale: The prior Stripe gateway was tightly coupled to Clerk auth, customer records, and server-side entitlements. Current Prompt Lab is local-storage-first and intentionally auth-light. Lemon Squeezy provides hosted checkout, an unsigned/signed customer portal, and a license API that fits extension, desktop, and hosted web surfaces without reintroducing a user account system.
Consequences: Prompt Lab now depends on three billing API routes (`/api/billing/checkout`, `/api/billing/license`, `/api/billing/portal`) plus local `plan` and license state in app storage. Pro gating is implemented in the shared React shell for A/B testing, diff view, batch runs, collections, and exports. Revisit only if Prompt Lab adds a durable server-side user identity layer that justifies moving entitlement state back to the backend.

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

*Last updated: 2026-03-29*
*Related: CLAUDE.md, PIPELINE.md, PROMPT_SYSTEM.md*
