# Prompt Lab Current Project Report

## Project Snapshot

- Repo: `/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab`
- Branch: `main`
- Product: Prompt engineering workbench spanning extension, desktop, hosted web app, and public landing site
- Core stack:
  - React
  - Vite
  - Chrome / Vivaldi MV3 extension
  - Tauri 2 desktop shell
  - Node 22
  - Vitest
- Live surfaces:
  - Public landing page: `https://promptlab.tools/`
  - Hosted web app: `https://prompt-lab-tawny.vercel.app/app/`

## What Prompt Lab Is

Prompt Lab is a multi-provider prompt engineering product for authoring, enhancing, linting, A/B testing, composing, saving, and reusing prompts. It currently supports:

- Anthropic
- OpenAI
- Google Gemini
- OpenRouter
- Ollama

The product is intentionally multi-surface:

- extension for in-browser use
- desktop app for installed workflows
- hosted web app for low-friction access
- public marketing/docs layer for acquisition and onboarding

## Architecture Reality

The current architecture is shared-core plus runtime shells.

- Shared frontend lives in `prompt-lab-source/prompt-lab-extension/src/`
- Extension-specific assets live in `prompt-lab-source/prompt-lab-extension/extension/`
- Desktop shell lives in `prompt-lab-source/prompt-lab-desktop/`
- Hosted web shell and landing surfaces live in `prompt-lab-source/prompt-lab-web/`
- Public docs/marketing surface lives in `docs/`
- Hosted web mode uses a Vercel proxy edge function to bypass browser CORS for provider requests

Important runtime distinction:

- extension and desktop call providers directly from the client
- hosted web app relies on a public backend dependency: `api/proxy.js`
- Ollama bypasses the proxy and goes direct to localhost

## Product Strengths Visible in the Repo

- Strong multi-provider abstraction instead of vendor-specific UI hardwiring
- Real prompt workflow breadth:
  - enhancement
  - linting
  - scoring
  - A/B testing
  - prompt composition
  - library persistence
  - variable templating
  - eval/run history
- Shared frontend reduces duplication across extension, desktop, and web
- Local-first persistence model keeps the product fast and mostly offline tolerant
- Existing architecture/docs are better than average for a solo product repo

## Current Known Product Issues

From `AGENTS.md`, these issues remain active:

- `002` in-progress: Create workflow is still too vertically stacked
- `003` in-progress: Experiments and run history are still split

These look like the main unresolved UX/product structure issues, not basic missing-feature gaps.

## Current In-Progress Repo State

There are active uncommitted edits in two landing/docs surfaces:

- `docs/index.html`
- `prompt-lab-source/public/prompt-lab-landing.html`

Diff summary:

- `2 files changed, 51 insertions(+), 46 deletions(-)`

Observed direction of those edits:

- migrate canonical and social metadata from the old GitHub Pages domain to `https://promptlab.tools/`
- point GitHub links at `DaveHomeAssist/prompt-lab` instead of the older `prompt-lab-provider-options` repo
- reposition the product as both web app and Chrome extension, not just Chromium side-panel software
- change primary CTAs toward the hosted web app
- add privacy links and some focus-state/accessibility cleanup
- bump visible versioning to `v1.7.0`

These edits look product-correct in direction. They are not random copy churn.

## Key Files That Matter Right Now

- `README.md`
  - product summary, supported platforms, local dev commands
- `AGENTS.md`
  - active project rules, issue tracker, recent session log
- `IMPLEMENTATION_PLAN.md`
  - execution tracker for the recent `v1.6.0` push and its remaining manual/distribution items
- `prompt-lab-source/ARCHITECTURE.md`
  - current runtime model and deploy shape across extension, desktop, web, and landing
- `docs/index.html`
  - public docs/marketing site surface, currently dirty
- `prompt-lab-source/public/prompt-lab-landing.html`
  - landing source for the hosted/public presentation layer, currently dirty
- `prompt-lab-source/package.json`
  - Node 22 contract and scripts for build, test, preflight, and Notion docs agent
- `prompt-lab-source/NOTION_DOCS_AGENT.md`
  - repo-local Notion sync agent doc and workflow assumptions

## What Changed Recently

Based on repo docs and issue logs, recent work has already landed around:

- privacy page creation and dead-nav cleanup
- A/B diff viewer support
- accessibility parity improvements
- better empty-state/help text in composer flows
- versioning visibility work
- landing page conversion work
- public demo mode and setup/privacy-related docs

The current repo is not an early prototype. It is a real product with active refinement work.

## Current Strategic Read

Prompt Lab’s real problem is not feature absence. It is clarity and consolidation.

The repo already suggests this:

- feature coverage is broad
- runtime surfaces are real
- docs and architecture exist
- remaining issues are mostly UX compression and product narrative clarity

Highest-value work likely sits in:

1. simplifying the Create workflow
2. unifying experiments and run-history analysis
3. tightening the landing/onboarding story so web app, extension, and install paths are not confusing
4. making the hosted web app feel like a first-class surface rather than a secondary deployment

## Questions Worth Giving to Perplexity Project AI

1. Product architecture:
   - Given the current three-shell model, what are the highest-risk complexity costs of maintaining extension, desktop, and hosted web in one shared frontend?

2. UX prioritization:
   - How should Prompt Lab compress the Create workflow without losing power-user capability?

3. Information architecture:
   - What is the best model for unifying experiments, run history, and version history into one coherent analysis surface?

4. Positioning:
   - Should Prompt Lab lead as a web app with extension support, or extension-first with web access as a fallback?

5. Distribution:
   - What is the best launch sequence for a product with:
     - hosted app
     - extension install flow
     - desktop packaging
     - prompt engineering audience

6. Technical risk:
   - How should the team think about the long-term maintenance cost of a public CORS proxy edge layer for model-provider traffic?

## Suggested Ask for Perplexity

Use this repo state as context:

- Prompt Lab is a multi-provider prompt engineering workbench with extension, desktop, hosted web app, and public landing surfaces.
- The codebase already has broad feature coverage and shared frontend architecture.
- The main unresolved issues appear to be product-flow clarity, Create workflow compression, and unifying experiments with run history.
- Current landing/docs work is moving the brand from older GitHub Pages positioning toward `promptlab.tools` plus hosted web app access.

Please analyze:

1. the most important product/UX weaknesses implied by this repo state
2. the highest-leverage next implementation work
3. the risks of the current multi-surface architecture
4. the best positioning and onboarding model for extension vs web app vs desktop
5. a concrete priority roadmap for the next 2–4 weeks

Keep the analysis grounded in the current repo state, not generic SaaS advice.

## Verification Commands

```bash
git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab status --short --branch
git -C /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab diff --stat -- docs/index.html prompt-lab-source/public/prompt-lab-landing.html
sed -n '1,220p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/AGENTS.md
sed -n '1,220p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/README.md
sed -n '1,260p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/prompt-lab-source/ARCHITECTURE.md
sed -n '1,240p' /Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab/IMPLEMENTATION_PLAN.md
```
