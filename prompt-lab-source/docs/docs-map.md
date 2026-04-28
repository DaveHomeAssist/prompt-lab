# Prompt Lab Docs Map

## Purpose

This file routes contributors to the right documentation source based on task and audience.

## Start here

If you are new to the repo, read these first:

1. `../README.md`
2. `../AGENTS.md`
3. `../ARCHITECTURE.md`
4. `../DOCS_INVENTORY.md`

## By audience

### Contributor or reviewer

- `../README.md`
- `../AGENTS.md`
- `../DOCS_INVENTORY.md`

Use these to understand the repo shape, live surfaces, and current issue log.

### Product or architecture work

- `../ARCHITECTURE.md`
- `../ROADMAP.md`
- `next-3-sprints-plan.md`
- `create-evaluate-restructure-plan.md`
- `CURRENT_MENU_SYSTEM.md`
- `glossary.md`

Use these for runtime shape, platform model, UI/state mapping, and shared terminology.

### Extension work

- `../prompt-lab-extension/README.md`
- `../prompt-lab-extension/PERMISSIONS_JUSTIFICATION.md`
- `../prompt-lab-extension/PRIVACY_POLICY.md`
- `../prompt-lab-extension/CWS_SUBMISSION_CHECKLIST.md`
- `../prompt-lab-extension/VERSION_HISTORY.md`

### Hosted web app and public docs

- `../prompt-lab-web/README.md`
- `../prompt-lab-web/index.html`
- `../prompt-lab-web/public/guide.html`
- `../prompt-lab-web/public/setup.html`
- `../prompt-lab-web/public/prompt-embed.html`
- `../prompt-lab-web/public/privacy.html`

Authoring rule:

- prefer `prompt-lab-web/` and `prompt-lab-web/public/` as the authoring source
- treat `../docs/` as the published copy, except current documented exceptions

### Desktop work

- `../prompt-lab-desktop/README.md`
- `../ARCHITECTURE.md`

### Release and version work

- `../prompt-lab-extension/VERSION_HISTORY.md`
- `../prompt-lab-extension/VERSION_REPORT.md`
- `../prompt-lab-extension/CHANGELOG_PLAIN_ENGLISH.md`

Use `VERSION_HISTORY.md` as the canonical changelog. Treat the others as supporting summaries.

### Internal audits and technical notes

- `create-evaluate-restructure-plan.md`
- `next-3-sprints-plan.md`
- `UX_AUDIT_2026-03-17.md`
- `DOCUMENTATION_SYSTEM_AUDIT_2026-03-20.md`
- `SCRATCHPAD_SHORTCUTS.md`
- `CURRENT_MENU_SYSTEM.md`
- `RUN_OBJECT_SCHEMA_RESEARCH.md`

### AI / operational handoff context

- `../../PROJECT_CONTEXT.md`
- `../../CURRENT_PROJECT_REPORT.md`
- `../../PROMPT_LAB_AGENT.md`
- `../../SESSION_INIT_PROMPT.md`
- `../../SESSION_HANDOFF_PROMPT.md`

These are working-context files, not canonical product documentation.

## By task

### I need the current deploy model

- `../ARCHITECTURE.md`
- `../prompt-lab-web/README.md`
- `../vercel.json`
- `../api/proxy.js`

### I need the menu or navigation model

- `CURRENT_MENU_SYSTEM.md`
- `../prompt-lab-extension/src/lib/navigationRegistry.js`
- `../prompt-lab-extension/src/hooks/useUiState.js`

### I need scratchpad behavior

- `SCRATCHPAD_SHORTCUTS.md`
- `../prompt-lab-extension/src/PadTab.jsx`
- `../prompt-lab-extension/src/lib/padShortcuts.js`

### I need public onboarding docs

- `../prompt-lab-web/index.html`
- `../prompt-lab-web/public/guide.html`
- `../prompt-lab-web/public/setup.html`
- `../prompt-lab-web/public/privacy.html`

### I need docs governance rules

- `../DOCS_INVENTORY.md`
- `docs-style-guide.md`
- `glossary.md`

## Authoring vs published copies

Use this rule first:

- edit authoring sources under `prompt-lab-source/`
- sync or publish to `docs/` after the source copy is correct

Current public-doc mapping:

| Authoring source | Published copy |
|---|---|
| `../prompt-lab-web/index.html` | `../../docs/index.html` |
| `../prompt-lab-web/public/guide.html` | `../../docs/guide.html` |
| `../prompt-lab-web/public/setup.html` | `../../docs/setup.html` |
| `../prompt-lab-web/public/prompt-embed.html` | `../../docs/prompt-embed.html` |
| `../prompt-lab-web/public/privacy.html` | `../../docs/privacy.html` |

## Naming guidance

- Canonical repo-wide docs use uppercase singleton names.
- New internal markdown docs under `prompt-lab-source/docs/` should default to `kebab-case`.
- Date suffixes are for audits and reports only.

## Maintenance rule

Any doc add, remove, rename, or reclassification should update `../DOCS_INVENTORY.md` in the same change.
