# Prompt Lab Documentation Inventory

Updated: 2026-03-13

## Active docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `prompt-lab-extension/README.md` | Extension developer quickstart | Active | Primary setup, test, and architecture entry point for the MV3 build. |
| `prompt-lab-desktop/README.md` | Desktop developer quickstart | Active | Documents Tauri build, packaging, and the shared frontend source relationship. |
| `prompt-lab-extension/PERMISSIONS_JUSTIFICATION.md` | CWS review support | Active | Mirrors current MV3 permissions and host permissions. |
| `prompt-lab-extension/PRIVACY_POLICY.md` | Store/privacy disclosure | Active | Describes local storage and provider-only transmission model. |
| `prompt-lab-extension/CWS_SUBMISSION_CHECKLIST.md` | Release checklist | Active | Tracks remaining Chrome Web Store submission work. |
| `prompt-lab-extension/VERSION_HISTORY.md` | Release history | Active | Canonical changelog across extension and desktop milestones. |
| `prompt-lab-extension/VERSION_REPORT.md` | Current release snapshot | Active | High-level technical state for v1.5.0. |
| `prompt-lab-extension/CHANGELOG_PLAIN_ENGLISH.md` | Non-technical release notes | Active | Product-facing summary of the current release. |
| `QA_LANDING_PAGE.md` | Landing page QA pack | Active | Manual QA checklist for the GitHub Pages marketing site. |

## Historical but retained

| Path | Scope | Status | Notes |
|---|---|---|---|
| `prompt-lab-extension/EXECUTION_PRD_V1.4.md` | Implementation planning | Historical | Keep for design context; not the source of truth for current behavior. |
| `prompt-lab-extension/BUG_PATCH_REPORT.md` | One-off remediation report | Historical | Useful for audit trail, but superseded by version history. |
| `_archive/DEPRECATED.md` | Archive marker | Historical | Indicates archived material under `_archive/`. |
| `_archive/PROPOSAL_V1.3.1.md` | Older proposal | Historical | Snapshot only; do not use for current architecture decisions. |

## Legacy / duplicate docs

| Path | Scope | Status | Notes |
|---|---|---|---|
| `../prompt-lab-extension/README.md` | Older unpacked extension bundle | Legacy | Outside the canonical `prompt-lab-source/` tree. Leave untouched unless that duplicate tree is intentionally revived. |

## Maintenance notes

- Prefer updating docs under `prompt-lab-source/`; treat material outside that tree as legacy unless there is an explicit migration task.
- When shared frontend behavior changes, update both extension and desktop docs because `prompt-lab-desktop/index.html` imports `../prompt-lab-extension/src/main.jsx`.
- Keep release docs aligned with the latest verified commands: `npm test`, `npm run build`, and Tauri bundle commands where relevant.
