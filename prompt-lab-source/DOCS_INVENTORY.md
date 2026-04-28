# Prompt Lab Documentation Inventory

Updated: 2026-03-30

## Canonical Source Rules

- `../README.md` is the contributor entry point for the repo.
- `ARCHITECTURE.md` is the canonical system architecture reference.
- `ROADMAP.md` is the canonical forward-looking product/runtime roadmap.
- `prompt-lab-extension/VERSION_HISTORY.md` is the canonical multi-surface changelog.
- `prompt-lab-web/index.html` is the authoring source for the public landing page.
- `prompt-lab-web/public/` is the preferred authoring source for auxiliary public HTML docs where a source copy exists.
- `../docs/` is the published public-docs/static-site copy, not the preferred authoring location.
- Root operational docs like `../CURRENT_PROJECT_REPORT.md` and `../SESSION_HANDOFF_PROMPT.md` are working context artifacts, not canonical product docs.

## Canonical Repo Docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `../README.md` | Repo entry point | Active | High-level product summary, live surfaces, project structure, and local development commands. |
| `../AGENTS.md` | Project operating notes | Active | Current repo rules, issue tracker, and session log. |
| `ARCHITECTURE.md` | Canonical system architecture | Active | Runtime layout across landing, hosted web app, extension, desktop, proxy, and shared frontend. |
| `ROADMAP.md` | Product and release priorities | Active | Current shipped state and near-term priorities. |
| `DOCS_INVENTORY.md` | Docs map and source-of-truth rules | Active | Inventory of major docs, public-doc authoring rules, and maintenance notes. |
| `NOTION_DOCS_AGENT.md` | Notion automation setup | Active | Documents the GitHub Actions driven Notion docs sync agent, required secrets, and trigger behavior. |

## Surface Docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `prompt-lab-extension/README.md` | Extension developer quickstart | Active | Source install, testing, and role of the MV3 side-panel shell alongside the web app and desktop shell. |
| `prompt-lab-desktop/README.md` | Desktop developer quickstart | Active | Documents Tauri build, packaging, and the shared frontend relationship to web and extension shells. |
| `prompt-lab-web/README.md` | Hosted web deployment quickstart | Active | Documents the public `promptlab.tools` landing page, hosted app URL, local dev, and Vercel deploy flow. |
| `prompt-lab-extension/PERMISSIONS_JUSTIFICATION.md` | CWS review support | Active | Mirrors current MV3 permissions and host permissions. |
| `prompt-lab-extension/PRIVACY_POLICY.md` | Store/privacy disclosure | Active | Extension-scoped privacy disclosure describing local storage and provider-only transmission. |
| `prompt-lab-extension/CWS_SUBMISSION_CHECKLIST.md` | Release checklist | Active | Tracks remaining Chrome Web Store submission work. |
| `prompt-lab-extension/CWS_STORE_LISTING.md` | Store listing draft | Active | Extension-specific listing copy that now references the hosted web companion where appropriate. |
| `prompt-lab-extension/VERSION_HISTORY.md` | Release history | Active | Canonical changelog across extension, web, and desktop milestones. |
| `prompt-lab-extension/VERSION_REPORT.md` | Current release snapshot | Active | High-level technical snapshot of the shared codebase; verify release number before quoting externally. |
| `prompt-lab-extension/CHANGELOG_PLAIN_ENGLISH.md` | Non-technical release notes | Active | Product-facing summary of the current release. |
| `vercel.json` | Vercel config | Active | Root build config for the hosted web deployment, including `/app` rewrites and `/api` passthrough. |
| `api/proxy.js` | CORS proxy edge function | Active | Domain-allowlisted pass-through proxy for provider APIs. |
| `.vercelignore` | Vercel upload filter | Active | Excludes local dependencies, build artifacts, and Tauri output from deployments. |
| `MOBILE_DEPLOYMENT_ROADMAP.md` | Future mobile shell plan | Active | Mobile roadmap relative to the shared extension/web/desktop frontend. |

## Documentation governance / reference

| Path | Scope | Status | Notes |
|---|---|---|---|
| `docs/docs-style-guide.md` | Documentation authoring rules | Active | Naming, tone, source-of-truth, markdown conventions, and docs update checklist. |
| `docs/docs-map.md` | Audience and task-based docs map | Active | Routes contributors to the right canonical, supporting, and working docs. |
| `docs/glossary.md` | Shared terminology reference | Active | Standardizes product-surface, UI, and documentation terms. |
| `.markdownlint-cli2.jsonc` | Markdown lint config | Active | Root docs-lint scope and rule overrides for repo markdown. |
| `../.lychee.toml` | Internal docs link-check config | Active | Offline link validation config for markdown and HTML docs. |
| `../.github/workflows/docs-ci.yml` | Docs CI workflow | Active | Runs markdown lint and internal link validation for docs-facing changes. |

## Internal Technical Docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `docs/CURRENT_MENU_SYSTEM.md` | Current menu/navigation model | Active | Code-grounded reference for header layers, state mapping, and command palette/menu behavior. |
| `docs/create-evaluate-restructure-plan.md` | Create/Evaluate implementation brief | Active | Phase 0 implementation brief for Create compression and Evaluate unification, including acceptance criteria and initial refactor boundaries. |
| `docs/next-3-sprints-plan.md` | Near-term sprint execution plan | Active | Three-sprint execution plan focused on activation runway, Evaluate proof, and conversion. |
| `docs/uxui-bold-restructure-spec.md` | UX/UI redesign spec | Active | Bold cross-surface UX/UI restructuring spec covering landing conversion, app-shell coherence, and phased execution. |
| `docs/uxui-bold-restructure-plan.md` | UX/UI slice 1 plan | Active | Task-by-task implementation plan for the first cross-surface redesign slice. |
| `docs/CODEBASE_AUDIT_2026-03-30.md` | Codebase audit and execution plan | Active | Audit of architecture, infrastructure, stale artifacts, UX gaps, and the executed top-five remediation batch. |
| `docs/SCRATCHPAD_SHORTCUTS.md` | Scratchpad shortcut policy | Active | Defines the supported scratchpad shortcuts and explicitly documents browser-reserved combos that are intentionally unsupported. |
| `docs/RUN_OBJECT_SCHEMA_RESEARCH.md` | Run-object schema analysis | Active | Research/reference material for run data modeling. |
| `docs/UX_AUDIT_2026-03-17.md` | Product UX audit | Active | Time-bounded audit; verify against current code before treating any finding as live truth. |
| `docs/DOCUMENTATION_SYSTEM_AUDIT_2026-03-20.md` | Documentation-system audit | Active | Current audit of documentation structure, duplication, drift, and maintenance recommendations. |

## Public Docs Authoring and Published Copies

| Path | Scope | Status | Notes |
|---|---|---|---|
| `prompt-lab-web/index.html` | Landing page authoring source | Active | Canonical authoring source for the public landing page. |
| `../docs/index.html` | Published landing/docs copy | Active | Live published copy; currently has local edits in progress. |
| `prompt-lab-web/public/guide.html` | Guide authoring source | Active | Preferred source for the user guide. |
| `../docs/guide.html` | Published guide copy | Active | Published copy of the guide. |
| `prompt-lab-web/public/setup.html` | Setup doc authoring source | Active | Preferred source for setup instructions. |
| `../docs/setup.html` | Published setup copy | Active | Published copy of setup instructions. |
| `prompt-lab-web/public/prompt-embed.html` | Embed doc authoring source | Active | Preferred source for prompt embedding docs. |
| `../docs/prompt-embed.html` | Published embed doc copy | Active | Published copy of prompt embed docs. |
| `prompt-lab-web/public/privacy.html` | Privacy doc authoring source | Active | Preferred source for the public privacy page. |
| `../docs/privacy.html` | Published privacy doc copy | Active | Published copy of the privacy page. |
| `../docs/UI_ISSUES_TABLE.html` | UI issue tracker snapshot | Active | Static HTML issue table; confirm whether this should remain public-facing. |
| `../docs/QA-SMOKE-TEST-v1.md` | QA checklist | Active | QA reference/checklist stored in the published-docs tree. |

## Operational / Working Docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `../CURRENT_PROJECT_REPORT.md` | Current-state project report | Working | Current repo-state handoff and Perplexity-ready context. |
| `../PROJECT_CONTEXT.md` | Durable repo-local context map | Working | Consolidated onboarding and handoff context spanning repo layout, runtime surfaces, backend seams, and known doc drift. |
| `../PROMPT_LAB_AGENT.md` | Stable repo-local agent prompt | Working | Prompt Lab-specific operating rules for AI assistants. |
| `../SESSION_INIT_PROMPT.md` | New-session bootstrap prompt | Working | Paste-ready repo-specific session initializer. |
| `../SESSION_HANDOFF_PROMPT.md` | Current session handoff prompt | Working | Current repo handoff prompt for fresh AI sessions. |

## Historical but retained

| Path | Scope | Status | Notes |
|---|---|---|---|
| `prompt-lab-extension/EXECUTION_PRD_V1.4.md` | Implementation planning | Historical | Keep for design context; not the source of truth for current behavior. |
| `prompt-lab-extension/BUG_PATCH_REPORT.md` | One-off remediation report | Historical | Useful for audit trail, but superseded by version history. |
| `../IMPLEMENTATION_PLAN.md` | Execution tracker | Historical | Useful release context, but not the canonical description of current system behavior. |
| `../V1.6.0_NOTES.md` | Version notes | Historical | Snapshot release notes; keep for context, not as a live product spec. |
| `_archive/DEPRECATED.md` | Archive marker | Historical | Indicates archived material under `_archive/`. |
| `_archive/PROPOSAL_V1.3.1.md` | Older proposal | Historical | Snapshot only; do not use for current architecture decisions. |
| `_archive/QA_LANDING_PAGE.md` | Earlier landing-page QA pack | Historical | Checklist from the older standalone marketing-site phase. |

## Legacy / duplicate docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `../prompt-lab-extension/README.md` | Older unpacked extension bundle | Legacy | Outside the canonical `prompt-lab-source/` tree. Leave untouched unless that duplicate tree is intentionally revived. |

## Maintenance notes

- Prefer updating authoring sources under `prompt-lab-source/` first, then sync the published copy under `../docs/` when relevant.
- When shared frontend behavior changes, update extension, web, and desktop docs together.
- When public URLs, repo slug, or deploy shape change, update:
  - `../README.md`
  - `ARCHITECTURE.md`
  - `prompt-lab-web/README.md`
  - affected public HTML docs
- Treat stale `prompt-lab-provider-options` references and older GitHub Pages wording as drift bugs, not acceptable historical leftovers in active docs.
- Keep release docs aligned with the latest verified commands and current deploy shape.
