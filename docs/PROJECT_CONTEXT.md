# Prompt Lab Project Context

## Status

- Status: `working`
- Updated: `2026-04-12`
- Scope: repo-local onboarding and handoff context for maintainers, reviewers, and AI assistants
- Source of truth: this is a context map, not a canonical product spec. If it conflicts with code, `README.md`, `prompt-lab-source/ARCHITECTURE.md`, or other canonical docs, the code and canonical docs win.

## What Prompt Lab is

Prompt Lab is a multi-surface prompt engineering workbench. The same core product is delivered through:

- a Chrome / Vivaldi MV3 side-panel extension
- a hosted web app on `https://promptlab.tools/app/`
- a Tauri desktop app
- a public landing and docs surface on `https://promptlab.tools/`

Core user workflows already present in the repo include prompt authoring, enhancement, linting, PII scanning, saved library management, A/B testing, eval/run history, template variables, and prompt composition.

## Repo orientation

The repo root is `prompt-lab/`, but the active product source tree is `prompt-lab/prompt-lab-source/`.

That split matters:

- `prompt-lab-source/` is the canonical source tree for active app code and active product docs.
- `docs/` at the repo root is the published public-docs/static-site copy, not the preferred authoring location.
- root-level files like `CURRENT_PROJECT_REPORT.md`, `SESSION_INIT_PROMPT.md`, and this file are working-context artifacts.

High-level layout:

```text
prompt-lab/
  prompt-lab-source/          # canonical app/source/docs tree
    prompt-lab-extension/     # shared React frontend + MV3 shell
    prompt-lab-desktop/       # Tauri shell
    prompt-lab-web/           # hosted web app + landing authoring source
    api/                      # Vercel edge/serverless endpoints
    docs/                     # internal technical docs and audits
  docs/                       # published public docs copy
  README.md                   # repo entry point
  AGENTS.md                   # current issue log and project notes
  CURRENT_PROJECT_REPORT.md   # time-bounded working snapshot
```

## Current runtime surfaces

| Surface | Source path | Runtime notes |
|---|---|---|
| Extension | `prompt-lab-source/prompt-lab-extension/` | Primary browser-native workflow. Uses MV3 assets plus the shared React app. |
| Hosted web app | `prompt-lab-source/prompt-lab-web/` | Public app at `/app/`. Reuses the shared React app through a web-specific entry and backend proxy/billing endpoints. |
| Desktop | `prompt-lab-source/prompt-lab-desktop/` | Tauri 2 wrapper around the shared React app. |
| Public landing/docs | `prompt-lab-source/prompt-lab-web/index.html` and `prompt-lab-source/prompt-lab-web/public/` | Canonical authoring source for the public site and HTML docs. |
| Published docs copy | `docs/` | Derived public copy. Edit source under `prompt-lab-source/` first. |

## Shared frontend model

The shared React app lives in `prompt-lab-source/prompt-lab-extension/src/`.

Important implementation facts:

- `src/main.jsx` wraps the app in `HashRouter`.
- `src/App.jsx` is still the main composition root.
- `src/lib/navigationRegistry.js` is the current single source of truth for section, route, shortcut, and command-palette mappings.
- `src/hooks/useRouteSync.js` keeps hash routes and app state aligned.
- `src/hooks/useUiState.js` manages the main navigation state model.

Current navigation state model:

- `primaryView`: `create`, `runs`, `notebook`
- `workspaceView`: `editor`, `library`, `composer`, `split`
- `runsView`: `history`, `compare`

Visible product labels do not map 1:1 to those state keys:

- `Library` is implemented as `primaryView=create` plus `workspaceView=library`
- `Evaluate` is implemented as `primaryView=runs`
- `Notebook` is its own `primaryView`

Useful source modules:

- `src/hooks/usePromptLibrary.js`: saved prompt library behavior
- `src/hooks/useEditorState.js`: editor-local prompt state
- `src/hooks/useExecutionFlow.js`: enhance/send execution path
- `src/hooks/usePersistenceFlow.js`: save/load/share/template persistence flow
- `src/hooks/useABTest.js`: compare workflow
- `src/hooks/useBillingState.js`: local billing state plus backend sync
- `src/hooks/useTelemetryState.js`: optional usage-insights events
- `src/lib/providerRegistry.js`: provider metadata, payload building, and response normalization
- `src/lib/billing.js`: plan state and Pro feature gates

## Providers, persistence, and backend seams

### Providers

The shared provider layer currently supports:

- Anthropic
- OpenAI
- Google Gemini
- OpenRouter
- Ollama

Provider behavior is centralized in `prompt-lab-source/prompt-lab-extension/src/lib/providerRegistry.js`.

### Persistence

- prompt library and app state are local-first
- extension provider settings live in `chrome.storage.local`
- desktop provider settings use `localStorage`
- billing state is cached locally via the shared storage layer
- experiments and run history persist through the app's local store layer

### Hosted backend seams

The hosted web surface is no longer "no backend" in the strict sense. It currently depends on these repo-local backend endpoints:

- `prompt-lab-source/api/proxy.js`
  - hosted provider proxy
  - currently Anthropic-only
  - enforces host allowlisting, model allowlisting, token caps, and request rate limiting
- `prompt-lab-source/api/billing/checkout.js`
- `prompt-lab-source/api/billing/license.js`
- `prompt-lab-source/api/billing/portal.js`
- `prompt-lab-source/api/billing/webhook.js`
  - Stripe-backed billing flow
- `prompt-lab-source/api/telemetry.js`
  - optional usage-insights ingestion

Current runtime split:

- extension: direct provider calls from the extension runtime
- desktop: direct provider calls from the desktop runtime
- hosted web app: provider calls route through `/api/proxy`

## Hosted web auth and identity

The hosted web app now has an auth-aware entrypoint in `prompt-lab-source/prompt-lab-web/app/main-web.jsx`.

Current behavior in code:

- if `VITE_CLERK_PUBLISHABLE_KEY` is configured, the hosted web app mounts under `ClerkProvider`
- signed-out users see a Clerk sign-in screen
- signed-in users reach the shared `App` with `clerkUser`, `clerkGetToken`, and a `UserButton`
- if the Clerk key is missing, the app falls back to unauthenticated mode

This auth layer is ahead of some of the main architecture docs, so treat the code as the current source of truth here.

## Billing and product gating

Prompt Lab has moved from earlier Lemon Squeezy assumptions to Stripe-backed billing.

Current Pro-gated features in code:

- A/B testing
- diff viewer
- batch runs
- collections
- library export

Relevant implementation files:

- `prompt-lab-source/prompt-lab-extension/src/lib/billing.js`
- `prompt-lab-source/prompt-lab-extension/src/hooks/useBillingState.js`
- `prompt-lab-source/api/_lib/stripeBilling.js`

Important product decisions already resolved in `prompt-lab-source/docs/DECISIONS.md`:

- `D-001`: hash-based routing won over state-only routing
- `D-010`: hybrid free/pro gating strategy was selected
- `D-R06`: Stripe checkout + portal + billing-email sync is the current billing path

## Docs and source-of-truth map

Start with these canonical docs:

- `README.md`
- `AGENTS.md`
- `prompt-lab-source/ARCHITECTURE.md`
- `prompt-lab-source/ROADMAP.md`
- `prompt-lab-source/DOCS_INVENTORY.md`

Then use these focused docs as needed:

- `prompt-lab-source/docs/CURRENT_MENU_SYSTEM.md`
- `prompt-lab-source/docs/DECISIONS.md`
- `prompt-lab-source/docs/PIPELINE.md`
- `prompt-lab-source/prompt-lab-extension/VERSION_HISTORY.md`
- `prompt-lab-source/prompt-lab-web/README.md`
- `prompt-lab-source/prompt-lab-extension/README.md`
- `prompt-lab-source/prompt-lab-desktop/README.md`

Working-context docs at the repo root:

- `CURRENT_PROJECT_REPORT.md`
- `PROMPT_LAB_AGENT.md`
- `SESSION_INIT_PROMPT.md`
- `SESSION_HANDOFF_PROMPT.md`
- `PROJECT_CONTEXT.md`

## Current repo state

Observed on `2026-04-12`:

- branch: `main`
- package version: `1.7.0`
- root and source-tree `.nvmrc`: `20`

Recent commit direction:

- restore legacy recovery bridge / pin Node 20
- next-gen landing page work
- preview-release preparation
- Clerk integration for the web app

## Local development and verification

Run repo-level commands from `prompt-lab-source/` unless a package-level command is needed.

Repo-level commands:

```bash
npm run dev
npm run build
npm run test
npm run docs:lint
npm run preflight
npm run deploy:preview
npm run deploy:prod
```

Surface-specific commands:

```bash
# Extension
cd prompt-lab-source/prompt-lab-extension
npm install
npm run dev
npm test
npm run build

# Hosted web
cd prompt-lab-source/prompt-lab-web
npm install
npm run dev
npm run build

# Desktop
cd prompt-lab-source/prompt-lab-desktop
npm install
npm run tauri:dev
npm run tauri:build
```

Test layout:

- `prompt-lab-source/prompt-lab-extension/src/tests/`: Vitest / RTL coverage for the shared app
- `prompt-lab-source/prompt-lab-extension/tests/`: desktop smoke and Playwright extension coverage
- `prompt-lab-source/tests/`: repo-level Node tests for hosted proxy and billing endpoints

## Current priorities and live issues

From `AGENTS.md`, the main still-active product issues are:

- Create workflow compression and vertical density
- continued Evaluate unification and QA around run history / compare behavior

From `ROADMAP.md`, near-term priorities still emphasize:

- distribution polish
- Chrome Web Store submission readiness
- documentation alignment across extension, web, and desktop
- keeping `promptlab.tools` and the hosted app flow aligned with the real product

## Known drift and caution points

These are the main places where future sessions can get tripped up:

- `prompt-lab-source/prompt-lab-desktop/README.md` still says Node `22+`, but the repo packages and both `.nvmrc` files pin Node `20`.
- older working reports may describe `D-001` as pending even though routing is already resolved to hash-based navigation in code and docs.
- older billing assumptions may still mention Lemon Squeezy; current billing code and version history are Stripe-based.
- `prompt-lab-source/ARCHITECTURE.md` and other docs describe the hosted web surface well, but the newer Clerk-authenticated app entry is easier to confirm from code than from the current docs set.
- `prompt-lab-source/public/` contains older or auxiliary public assets; do not treat it as the canonical replacement for `prompt-lab-web/` authoring sources without checking `DOCS_INVENTORY.md`.

## Fast-start reading order for a new session

1. `README.md`
2. `AGENTS.md`
3. `PROJECT_CONTEXT.md`
4. `prompt-lab-source/ARCHITECTURE.md`
5. `prompt-lab-source/DOCS_INVENTORY.md`
6. `prompt-lab-source/docs/CURRENT_MENU_SYSTEM.md`
7. the package README for the surface you are touching
8. `prompt-lab-source/prompt-lab-extension/VERSION_HISTORY.md`
9. `prompt-lab-source/docs/DECISIONS.md`

## Verification

Useful spot-check commands:

```bash
git status --short --branch
Get-Content README.md
Get-Content AGENTS.md
Get-Content prompt-lab-source/ARCHITECTURE.md
Get-Content prompt-lab-source/DOCS_INVENTORY.md
Get-Content prompt-lab-source/docs/CURRENT_MENU_SYSTEM.md
Get-Content prompt-lab-source/prompt-lab-extension/VERSION_HISTORY.md
Get-Content prompt-lab-source/prompt-lab-web/app/main-web.jsx
Get-Content prompt-lab-source/prompt-lab-extension/src/lib/navigationRegistry.js
Get-Content prompt-lab-source/prompt-lab-extension/src/lib/billing.js
```
