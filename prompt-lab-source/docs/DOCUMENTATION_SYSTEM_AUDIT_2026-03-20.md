# Documentation System Audit

> **Historical snapshot — not canonical.** This report records what was true
> at the commit it audited and is not updated afterwards. Findings may since
> have been fixed, superseded, or re-prioritised. For current product status
> see `feature-health-dashboard.md`.

## Audit Scope

This audit reviews the current documentation system for Prompt Lab as it exists in the repository on `2026-03-20`.

It focuses on:

- completeness
- accuracy
- consistency
- discoverability
- duplication
- nomenclature drift
- maintainability

## Inputs Used

### Project Documentation Reviewed

Core repo and system docs:

- `README.md`
- `AGENTS.md`
- `IMPLEMENTATION_PLAN.md`
- `prompt-lab-source/ARCHITECTURE.md`
- `prompt-lab-source/DOCS_INVENTORY.md`
- `prompt-lab-source/ROADMAP.md`
- `prompt-lab-source/MOBILE_DEPLOYMENT_ROADMAP.md`
- `prompt-lab-source/NOTION_DOCS_AGENT.md`
- `prompt-lab-source/prompt-lab-extension/README.md`
- `prompt-lab-source/prompt-lab-web/README.md`
- `prompt-lab-source/prompt-lab-desktop/README.md`
- public docs surface in `docs/`
- public source docs surface in `prompt-lab-source/prompt-lab-web/public/`
- current internal docs added recently in `prompt-lab-source/docs/`

### Project Context

Verified codebase metrics from the current filesystem:

- JS-family files in `prompt-lab-source/`: `121`
- HTML files in `prompt-lab-source/`: `11`
- CSS files in `prompt-lab-source/`: `1`
- JS-family LOC: approximately `18,982`
- HTML LOC: approximately `6,216`
- CSS LOC: approximately `297`
- Shared frontend code files in `prompt-lab-extension/src/`: `83`
- Test files in `prompt-lab-extension/src/tests/`: `9`
- Markdown docs inside `prompt-lab-source/` at depth <= 3: `35`

Complexity assessment:

- Medium-to-large application
- Multi-surface product, not a single-runtime tool
- Shared codebase with extension, desktop, hosted web app, public docs/marketing, and deployment/proxy concerns

Team size and structure:

- Assumption: solo developer or very small team
- Evidence: no explicit team roster, no visible dedicated docs ownership model, QA appears document-driven rather than role-driven
- Recommendation impact: documentation system should optimize for low-overhead maintenance and strong source-of-truth rules

Current documentation tools/practices visible in repo:

- Markdown docs
- HTML public documentation pages
- repo-local agent/context docs
- manually maintained inventories and reports
- no visible markdown linting or documentation validation pipeline
- no visible Storybook or dedicated docs site generator for internal technical docs

## Executive Assessment

Prompt Lab has **high documentation volume** and **above-average architectural self-awareness**, but the documentation system is currently **fragmented**, **partially stale**, and **not strongly source-of-truth governed**.

The strongest parts:

- architecture is documented
- platform surfaces are explicitly named
- package-level READMEs exist
- public docs exist
- release and audit notes exist

The weakest parts:

- multiple overlapping documentation locations
- duplicate public docs in two different trees
- stale root-level framing and old repo/domain references
- inconsistent naming and file taxonomy
- no clear canonical-vs-derived rule for docs maintenance

The current system is workable for a small team, but it is already too fragmented for the project’s size and surface count.

## Documentation System Assessment

### Completeness

Strengths:

- architecture and runtime layout are documented
- extension, web, and desktop each have package-level docs
- release history and execution-tracker style docs exist
- public docs cover guide, setup, privacy, and prompt embedding
- special-purpose docs exist for Notion sync, permissions, store submission, audits, and roadmaps

Gaps:

- no single canonical “start here” technical index that cleanly routes a developer by role and task
- no documentation style guide or authoring conventions file
- no explicit source-of-truth rules for public docs versus generated/deployed copies
- no canonical glossary/nomenclature guide
- no documentation ownership or update workflow
- no doc explaining how root-level docs, `prompt-lab-source/docs/`, package READMEs, and `docs/` are supposed to relate

### Accuracy

Strengths:

- `ARCHITECTURE.md` appears materially aligned with the current deploy shape
- package READMEs for extension/web/desktop are directionally consistent with the codebase
- the menu-system and scratchpad docs recently added are precise and code-grounded

Weaknesses:

- root `README.md` still describes Prompt Lab as extension + desktop only, while the architecture explicitly includes a hosted web app and public landing page
- root `README.md` still describes `docs/` as a GitHub Pages landing site, while active work is aligning the public surface to `promptlab.tools`
- `docs/privacy.html` still contains old `prompt-lab-provider-options` GitHub links and `v1.5.0` footer text
- `DOCS_INVENTORY.md` is already stale relative to current repo additions and recently created docs

### Consistency

Strengths:

- architectural docs consistently use the surface language of extension, desktop, web, landing, and shared frontend
- package-level READMEs are structurally similar

Weaknesses:

- inconsistent file naming patterns
- inconsistent versioning references across docs
- inconsistent platform framing between root README and architecture/web docs
- inconsistent repo naming between current docs and older legacy references

### Accessibility and Discoverability

Strengths:

- public docs exist in browsable HTML form
- core docs are plain-text markdown and easy to inspect locally

Weaknesses:

- docs are spread across too many locations
- public docs are duplicated in:
  - `docs/`
  - `prompt-lab-source/prompt-lab-web/public/`
- internal docs are split across:
  - repo root
  - `prompt-lab-source/`
  - `prompt-lab-source/docs/`
  - package subfolders
- the repo lacks one obvious entry point for:
  - product docs
  - developer docs
  - release docs
  - decision records

## Nomenclature Patterns

### What Is Working

There is a recognizable high-level vocabulary across the repo:

- Prompt Lab
- extension
- desktop
- hosted web
- landing page
- shared frontend
- provider
- library
- experiments
- notebook

### Where Naming Diverges

Documentation file naming is inconsistent across styles:

- all-caps canonical docs:
  - `ARCHITECTURE.md`
  - `ROADMAP.md`
  - `IMPLEMENTATION_PLAN.md`
- prefixed/spec-style docs:
  - `FEATURE_SPEC_PRESET_PACKS.md`
  - `EXECUTION_PRD_V1.4.md`
- date-stamped docs:
  - `UX_AUDIT_2026-03-17.md`
  - `DOCUMENTATION_SYSTEM_AUDIT_2026-03-20.md`
- session/handoff docs:
  - `CURRENT_PROJECT_REPORT.md`
  - `SESSION_INIT_PROMPT.md`
  - `SESSION_HANDOFF_PROMPT.md`
- public HTML docs:
  - `guide.html`
  - `setup.html`
  - `privacy.html`

This is understandable for a fast-moving solo repo, but not standardized.

### Code-to-Docs Naming Alignment

Good alignment:

- `Prompt Lab`
- `Notebook`
- `Library`
- `Experiments`
- `Build`
- `Settings`

Misalignment examples:

- visible menu labels do not map cleanly to the underlying state model
  - `Library` is not a `primaryView`
  - `Build` is `workspaceView=composer`
- docs use both “hosted web app” and “public web deployment”
- root docs still imply GitHub Pages as the public-docs model while newer docs imply Vercel + `promptlab.tools`

## Gaps and Overlaps

### High-Value Overlaps

1. Public documentation exists in two places:
   - `docs/`
   - `prompt-lab-source/prompt-lab-web/public/`

Confirmed duplicate HTML doc names:

- `guide.html`
- `prompt-embed.html`
- `setup.html`

This is the single biggest docs-system risk.

2. Release/status storytelling is spread across too many files:

- `IMPLEMENTATION_PLAN.md`
- `V1.6.0_NOTES.md`
- `VERSION_HISTORY.md`
- `VERSION_REPORT.md`
- `CHANGELOG_PLAIN_ENGLISH.md`
- `BUG_PATCH_REPORT.md`

Some of these are useful, but the taxonomy is not obvious.

3. Repo-level context/handoff docs are accumulating in root:

- `CURRENT_PROJECT_REPORT.md`
- `PROMPT_LAB_AGENT.md`
- `SESSION_INIT_PROMPT.md`
- `SESSION_HANDOFF_PROMPT.md`

These are useful operationally, but without a dedicated folder they will become clutter quickly.

### Missing Documentation

- documentation style guide
- glossary / nomenclature reference
- “Where docs live and which copy is canonical” guide
- doc maintenance checklist for product-surface changes
- contributor-facing docs map by audience

### Outdated or Drift-Prone Content

- root `README.md`
- `docs/privacy.html`
- `DOCS_INVENTORY.md`
- older references to `prompt-lab-provider-options`
- older GitHub Pages wording

## Prioritized Findings

### P1

- No enforced single source of truth for public docs. Duplicate HTML docs exist in both deploy-facing and source-facing trees.

### P1

- Root-level onboarding docs are partially stale relative to the current architecture and deployment model.

### P2

- Documentation inventory exists but is not maintained tightly enough to stay authoritative.

### P2

- Naming and taxonomy for internal docs are inconsistent enough to reduce discoverability.

### P2

- Release and audit documentation overlap without a clear lifecycle model.

### P3

- No documentation linting, link checking, or inventory automation is visible.

## Actionable Recommendations

### 1. Structure and Organization

Adopt a clear documentation system with four top-level categories:

```text
docs/
  public/          # deployable user-facing docs
  internal/
    architecture/
    product/
    audits/
    reports/
    adr/
  reference/
    glossary.md
    docs-style-guide.md
    docs-map.md
  release/
    changelog.md
    release-notes/
```

Practical Prompt Lab mapping:

- Keep public HTML docs authored in one place only
  - recommended: `prompt-lab-source/prompt-lab-web/public/`
- Treat `docs/` as generated/published output only
- Move internal markdown docs out of repo root over time into:
  - `prompt-lab-source/docs/architecture/`
  - `prompt-lab-source/docs/audits/`
  - `prompt-lab-source/docs/reports/`
  - `prompt-lab-source/docs/reference/`

### 2. Canonical Source Rules

Define and document these rules explicitly:

- `prompt-lab-source/prompt-lab-web/public/` is the authoring source for public HTML docs
- `docs/` is deployment output only
- root `README.md` is the contributor entry point
- `ARCHITECTURE.md` is the canonical system overview
- `ROADMAP.md` is the canonical forward-looking plan
- release history should collapse into one changelog system plus release notes

### 3. Content and Style Guide

Add `docs-style-guide.md` with:

- file naming rules
- heading rules
- tone rules
- when to create a new doc versus update an existing one
- when to date-stamp a file
- how to label docs:
  - canonical
  - working
  - audit
  - historical
  - generated

Recommended tone:

- direct
- technical
- source-aware
- low-marketing
- explicit about assumptions and current state

Markdown style guidance:

- one H1 per file
- sentence-case body headings or consistently applied title case
- tables only when scanning value is high
- code fences with paths or commands
- explicit “Status” and “Source of truth” sections for operational docs

### 4. Nomenclature Standardization

Adopt these naming rules:

- reserve uppercase singleton names for true canonical repo-wide docs only:
  - `README.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `ROADMAP.md`
  - `CHANGELOG.md`
- use kebab-case for most new markdown docs:
  - `documentation-system-audit-2026-03-20.md`
  - `scratchpad-shortcuts.md`
  - `current-menu-system.md`
- use date suffixes only for time-bounded audits/reports
- avoid new root-level `CURRENT_*` / `SESSION_*` files unless they are deliberately ephemeral

For product surface terms, standardize on:

- `extension`
- `desktop`
- `hosted web app`
- `public landing page`
- `shared frontend`

Avoid mixing in older labels unless marked legacy.

### 5. Tooling and Automation

Recommended lightweight stack:

- `markdownlint-cli2` for markdown consistency
- `lychee` for link validation across markdown and HTML
- a small inventory generator script to refresh `DOCS_INVENTORY.md`
- optional `Vale` for terminology and style enforcement

Code-adjacent documentation tooling:

- add JSDoc to critical `src/lib/` modules, provider adapters, and complex hooks
- do not introduce Storybook unless the goal is a component-library workflow; the higher-value need right now is docs governance, not component showroom tooling

CI recommendations:

- docs link check on PRs
- markdown lint on PRs
- fail if generated `docs/` diverges from `prompt-lab-web/public/` after build/publish step

### 6. Maintenance Process

Establish one docs update checklist triggered by any change to:

- public navigation
- deploy URLs
- supported platforms
- provider support
- extension permissions
- settings flows
- menu system
- public onboarding/install instructions

Require these docs to be reviewed together when relevant:

- `README.md`
- `ARCHITECTURE.md`
- package README for affected surface
- public guide/setup/privacy docs
- `DOCS_INVENTORY.md`

Lightweight process recommendation for a small team:

1. mark each new doc as canonical, working, or historical
2. update `DOCS_INVENTORY.md` in the same PR
3. if a public HTML doc changes, update only the authoring copy and regenerate/publish the deploy copy
4. archive superseded reports instead of leaving them adjacent to live docs forever

## Recommended Immediate Next Steps

### Next 1–2 sessions

1. Decide and document the canonical authoring source for public HTML docs.
2. Update root `README.md` to reflect:
   - hosted web app
   - `promptlab.tools`
   - current repo/deploy model
3. Refresh `DOCS_INVENTORY.md` so it includes current docs and correct statuses.
4. Fix stale public references in `docs/privacy.html`.

### Next 1 week

1. Create:
   - `docs-style-guide.md`
   - `docs-map.md`
   - `glossary.md`
2. Move root operational handoff docs into a dedicated internal docs folder.
3. Add markdown lint and link checking to CI.

### Next 2–4 weeks

1. Consolidate release-note taxonomy.
2. Normalize doc naming conventions.
3. Add doc ownership/update expectations to contributor workflow.

## Bottom Line

Prompt Lab does not have a documentation shortage. It has a **documentation governance problem**.

The right move is not “write more docs everywhere.” The right move is:

- reduce duplicate doc surfaces
- define canonical sources
- standardize naming
- automate inventory and link validation
- keep public docs and architecture docs synchronized with the actual product surfaces
