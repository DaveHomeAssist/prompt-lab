# PromptLab architecture

This document covers the multi-agent pipeline architecture, repo structure, and system topology for the PromptLab ecosystem.

---

## System topology

```
Notion Sprint Tracker (task source)
        ↓
Orchestrator Service (localhost:8001)
        ↓
DaveLLM Router (localhost:8000)
        ↓
    ┌───┴────┐
  Claude   Codex
(reasoning) (execution)
        ↓
Git worktrees (per task)
        ↓
Jest (CI quality gate)
        ↓
Vercel (deploy)
```

### Port map

| Service | Port |
|---|---|
| PromptLab extension dev | 5173 |
| DaveLLM Router | 8000 |
| Orchestrator (planned) | 8001 |
| Metagrid | 3000 |
| Static projects | 8000 (python3 -m http.server) |

---

## Agent role split

The core principle: Claude handles reasoning, Codex handles mechanical execution. Never ask Codex to make architectural decisions. Never ask Claude to write boilerplate.

| Phase | Owner | Inputs | Outputs |
|---|---|---|---|
| 1. Requirements | Claude | Task description, Sprint Tracker row | Spec doc, acceptance criteria |
| 2. Architecture | Claude | Spec doc, existing codebase | ARCHITECTURE notes, schema definitions |
| 3. Implementation | Codex | Architecture notes, CODEX.md | Code, tests |
| 4. QA / auto-repair | Codex | Jest output, error traces | Fixed code, passing tests |
| 5. Review / docs | Claude | Diff, test results | PR description, doc updates |
| 6. Human review | Dave | PR | Approve or request changes |

Governance docs per repo:
- `CLAUDE.md` — reasoning tasks, architectural constraints, formatting rules
- `CODEX.md` — mechanical execution tasks, file conventions, test patterns

---

## Repo map

### Full orchestrator — prompt-lab-extension

Path: `~/Desktop/Code/10-active-projects/prompt-lab-main-clean/prompt-lab-source/`

Stack: React, Tailwind, Dexie.js (IndexedDB), Vite, MV3
(See `../ARCHITECTURE.md` for full repo layout, runtime model, and platform paths.)

Key architectural decisions locked:
- Dexie.js is the source of truth (SQLite WASM ruled out — MV3 incompatible)
- DaveLLM Router is an optional local super-provider on localhost:8000
- Flat Run Object schema aligned to OpenInference/OpenTelemetry conventions
- Graph Explorer export seam for LLM run lineage visualization

Orchestrator plan:
- FastAPI service on localhost:8001
- Routes through DaveLLM Router on localhost:8000
- SQLite for task state
- Notion Sprint Tracker as task source
- Git worktrees per task
- Jest as CI quality gate
- Stream Deck XL: physical Run/Approve/Abort controls

Build order:
1. Write ORCHESTRATOR.md
2. Scaffold FastAPI service
3. Wire Notion as task source
4. Implement git worktrees with quality gates
5. Add Stream Deck integration

### Lightweight split — garden-os

Path: `~/Desktop/Code/10-active-projects/garden-os/`

Pattern: CLAUDE.md + CODEX.md split, no orchestrator.

Notes:
- Local-first decision support software, zero backend, single-file browser tool
- Built for Dave's mom — accessibility and simplicity are hard constraints
- Shared CSS theme system: `garden-os-theme.css` with canonical token set
- Tests: 324/324 green as of 2026-03-25

### Lightweight split — trailkeeper

Path: `~/Desktop/Code/10-active-projects/trailkeeper/`

Pattern: CLAUDE.md + CODEX.md split, no orchestrator.

**Hard dependency:** `trailkeeper.store` localStorage schema must be defined by Claude before any Codex implementation work begins. No feature development until the unified store schema exists. This is a Claude-first task.

### Deploy artifacts — no pipeline needed

- `notion-widgets` — static embeds
- Freelance sites (Act Two Catering, Summit Contracting, Freelance landing)
- These deploy via Netlify Drop or GitHub Pages, no orchestrator involvement

---

## Home lab topology

Relevant to DaveLLM cluster deployment.

| Machine | Role | Status |
|---|---|---|
| MacBook Air M4 | Primary dev machine | Active |
| Duncan (Windows PC) | Cluster node | LAN IP needed |
| MSI GP66 | Cluster node | LAN IP needed |
| MSI Katana x2 | Cluster nodes | LAN IPs needed |
| Dell home server | Dokku/Dokploy host | Active |
| Raspberry Pi units | Supporting infra | Active |

All machines connected via Tailscale. DaveLLM cluster is blocked until LAN IPs for GP66, Katana x2, and Duncan are confirmed.

Deployment stack:
- Dokku/Dokploy on Dell server
- Bun/Vite/PM2 for fast local deploys
- rsync over Tailscale SSH for cross-machine targeting
- Stream Deck XL for physical deploy control

LLM inference: Ollama (assumption — confirm vs llama-server across Windows nodes before cluster deploy).

---

## Domain and hosting

| Property | Host | Notes |
|---|---|---|
| promptlab.tools | Vercel | Live |
| standardacidprocedure.com | Vercel | Custom domain cutover complete |
| act-two-catering | Netlify | In progress |
| av-resume | GitHub Pages | Live |
| davehomeassist (27 repos) | GitHub Pages | Audited 2026-03-26 |

Monetization platform: Stripe (selected to preserve customer/subscription data and webhook visibility).

---

## Active build plan — PLB phases

Five-phase 34-week plan. Current position: Phase 1–2 complete on App.jsx breakup.

Phase milestones:
1. Core architecture (Dexie schema, provider registry, run logging) — complete
2. UI component extraction from App.jsx monolith — phases 1–2 complete
3. Evaluate tab + run history — Issue 003 QA complete, 7 bugs documented
4. Monetization (Stripe integration, prompt packs, gating)
5. Public launch (CWS listing, website, onboarding)

Nav strategy decision pending: React Router hash mode vs state router. Must be resolved before Phase 2 UI work continues.

## Native contract parity gate

The universal SwiftUI app and the React/extension surfaces share data contracts, not UI code. The canonical cross-surface fixture is:

- `../../contracts/promptlab-enhance-contract-v1.json`

Any change to enhance provider defaults, mode IDs, tag names, response fields, run statuses, or prompt-title generation must update the fixture and both parity suites in the same pull request:

- React/Vitest: `prompt-lab-extension/src/__tests__/nativeContractParity.test.js`
- Swift/XCTest: `../../prompt-lab-ios/PromptLabTests/PromptLabTests.swift`

Required gate:

1. Run the extension test/build suite under the repository's pinned Node 22 runtime.
2. Run native unit tests on at least one iOS simulator family.
3. Run the credential-free native UI smoke suite on both iPhone and iPad simulator families.
4. Confirm untouched web-library fixtures still export byte-identically and edited entries retain variants, notes, tags, collections, and unknown JSON fields.
5. Keep paid provider testing opt-in: do not supply `ANTHROPIC_API_KEY` unless a live smoke call is explicitly authorized.

---

*Last updated: 2026-08-17*
*Related: CLAUDE.md, PROMPT_SYSTEM.md, DECISIONS.md*
