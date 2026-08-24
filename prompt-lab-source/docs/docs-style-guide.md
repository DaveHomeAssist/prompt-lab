# Prompt Lab Docs Style Guide

## Purpose

This file defines the default authoring rules for Prompt Lab documentation.

Use it to keep docs consistent across repo-level docs, package READMEs, internal technical notes, and public HTML documentation.

## Status labels

Every new documentation file should fit one of these states:

- `canonical`: the source of truth for a domain
- `active`: a current supporting doc that reflects the live system
- `working`: session-specific or operational context that may change quickly
- `audit`: time-bounded review or assessment
- `historical`: retained for context, not authoritative
- `generated`: derived output that should not be edited first

If a doc is operational or time-bounded, say so near the top of the file.

## Source-of-truth rules

- `README.md` is the contributor entry point.
- `ARCHITECTURE.md` is the canonical system architecture reference.
- `ROADMAP.md` is the canonical forward-looking plan.
- `prompt-lab-extension/VERSION_HISTORY.md` is the canonical cross-surface changelog.
- `prompt-lab-web/index.html` is the authoring source for the public landing page.
- `prompt-lab-web/public/` is the preferred authoring source for public HTML docs when a source copy exists there.
- `docs/` is the published public-docs tree, not the preferred place to author new content.

If two docs say different things, the canonical doc wins unless the code proves otherwise.

## File naming

- Reserve uppercase singleton names for repo-wide canonical docs:
  - `README.md`
  - `AGENTS.md`
  - `ARCHITECTURE.md`
  - `ROADMAP.md`
  - `CHANGELOG.md`
- Use `kebab-case` for most new markdown docs under `prompt-lab-source/docs/`.
- Use date suffixes only for time-bounded audits, reports, or snapshots.
- Avoid creating new root-level `CURRENT_*` or `SESSION_*` files unless they are intentionally short-lived working artifacts.

Examples:

- `docs-style-guide.md`
- `docs-map.md`
- `glossary.md`
- `documentation-system-audit-2026-03-20.md`

## Headings and structure

- Use one `#` heading per file.
- Keep section headings short and functional.
- Prefer sentence case for body headings.
- Use tables only when they improve scanning.
- Use bullets when the content is reference-like.
- Use short paragraphs for explanation and rationale.

Recommended sections for operational docs:

- `Status`
- `Scope`
- `Source of truth`
- `Current behavior`
- `Known gaps`
- `Verification`

Not every doc needs all of them, but operational docs should make their status and authority explicit.

## Tone and writing style

- Write in a direct, technical, source-aware tone.
- Prefer current-state descriptions over aspirational language.
- Mark assumptions clearly.
- Avoid marketing phrasing in internal docs.
- Avoid vague words like `simple`, `intuitive`, or `robust` unless you immediately explain what they mean.
- Name exact files, commands, URLs, and runtime surfaces when possible.

## Markdown conventions

- Use fenced code blocks with a language where possible.
- Use inline code for paths, commands, URLs, settings names, and identifiers.
- Keep list items short and parallel.
- Prefer relative repo paths in docs unless an absolute local path is necessary for workflow context.
- Do not overuse bold. Reserve it for high-signal distinctions.

## Terminology

Prefer these product surface terms:

- `extension`
- `desktop`
- `hosted web app`
- `public landing page`
- `shared frontend`

Avoid mixing older labels unless you mark them as legacy.

When a UI label differs from the underlying state model, document both:

- visible product label
- implementation/state term

Example:

- `Build` in the UI maps to `workspaceView=composer`

## When to create a new doc

Create a new doc only when at least one of these is true:

- the topic has ongoing independent value
- the content would make an existing canonical doc harder to scan
- the topic is an audit, report, or snapshot with a useful date boundary
- the audience is different enough to justify a separate surface

Update an existing doc instead when:

- the information belongs in a current canonical source
- the new content only clarifies or corrects existing behavior
- a second file would create duplication or source-of-truth ambiguity

## Public HTML docs workflow

- Author public docs in `prompt-lab-web/public/` when a source copy exists there.
- Treat `docs/` as the published copy.
- Do not edit both copies independently.
- If a public doc currently exists only in `docs/`, either:
  - keep it there as a temporary exception and document that in `DOCS_INVENTORY.md`, or
  - move it into `prompt-lab-web/public/` and then treat `docs/` as derived output.

## Update checklist

When any of these change, review docs together:

- public navigation
- public URLs
- supported platforms
- provider support
- extension permissions
- settings flows
- menu system
- onboarding or install flow

Minimum review set:

- `README.md`
- `ARCHITECTURE.md`
- affected package README
- affected public HTML docs
- `DOCS_INVENTORY.md`

## Verification

Before closing a docs change:

1. confirm the source-of-truth file was updated first
2. update `DOCS_INVENTORY.md` if a doc was added, removed, renamed, or reclassified
3. check links, repo slug references, and public URLs
4. confirm terminology matches the current product surfaces
5. confirm the doc does not contradict the live code or deploy model

Current validation entry point:

- from `prompt-lab-source/`, run `npm run docs:check` — markdown lint plus the
  consistency checks below
- CI also runs `.github/workflows/docs-ci.yml` for markdown lint, internal link
  validation, and documentation consistency

## Documentation consistency checks

`scripts/docs-consistency.mjs` pins a small number of high-risk documentation
contracts — facts stated in prose that are expensive to get wrong — against the
modules that define them. Markdown lint catches formatting and lychee catches
dead links; neither notices when a document states something the code no longer
does.

Currently pinned:

| Contract | Source of truth | Documents checked |
| --- | --- | --- |
| Hash routes | `ROUTE_TO_STATE` in `navigationRegistry.js` | `docs/DECISIONS.md`, `useRouteSync.js` |
| Hosted proxy boundary | `SUPPORTED_HOST`, `SUPPORTED_PATH`, `SHARED_KEY_PLACEHOLDER`, `DEFAULT_ALLOWED_MODELS` in `api/proxy.js` | `ARCHITECTURE.md` |
| Golden regression threshold | `DEFAULT_GOLDEN_THRESHOLD` in `constants.js` | `GOLDEN_RESPONSE_THRESHOLD.md` |

### When a check fails

A failure means a document and the code disagree. Decide which is right:

- the code changed and the document is now stale — update the document
- the document states the intended contract and the code drifted — fix the code

Never satisfy a check by loosening it. If a contract genuinely no longer applies,
delete the check and say why in the commit.

### Adding a check

Add a function to `scripts/docs-consistency.mjs` and call it from `main()`.
Two rules keep the checks trustworthy:

1. **Read the expectation from current source at run time.** Import the module
   or parse the current file; never hardcode the expected value. A check with a
   literal expectation becomes a second thing to keep in sync, and will pass
   against a stale snapshot of itself.
2. **Add the source-of-truth file to both `paths` filters in
   `docs-ci.yml`.** Otherwise a code change that breaks a documentation
   contract will not trigger Docs CI, and the drift ships.

Pin a contract only when it is high-risk: stated in prose, load-bearing for a
reader, and cheap to check. Broad prose is better served by review than by a
brittle assertion.
