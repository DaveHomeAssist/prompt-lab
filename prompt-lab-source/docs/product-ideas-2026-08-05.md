# Prompt Lab Product Ideas 2026-08-05

Status: working backlog snapshot.

This document converts Dave's 2026-08-05 idea list into ordered workstreams.
It is not a public commitment or a shipped-feature description. Use
`../ROADMAP.md` for the canonical product roadmap.

## Source ideas

- Admin-only status board and health dashboard
- Skill Lab
- Agent Lab
- Follow-up prompt expansion
- Native iPhone and iPad app
- Desktop stabilization
- Notepad and scratchpad improvements
- Workbench enhance-flow improvements
- Library navigation, import, sync, persistence, and compatibility

## Execution order

1. Establish a clean `main` and deployment baseline.
2. Stabilize desktop development, packaging, storage, and providers.
3. Improve the enhance workflow and follow-up prompt lifecycle.
4. Harden library navigation, imports, persistence, compatibility, and sync.
5. Upgrade scratchpads with inline rename and rich editing.
6. Define Skill Lab and Agent Lab records and execution boundaries.
7. Add an admin-only health dashboard after diagnostics are reliable.
8. Continue native mobile work after shared contracts and desktop packaging are stable.

## Isolated WIP branch disposition

The deleted-upstream branch
`wip/prompt-lab-library-layout-fix-2026-03-23` remains preserved in its
original worktree. Its six commits were reviewed before current-main work
started.

| Commit | Disposition |
|---|---|
| `df690fd` library stabilization and legacy recovery | Superseded by the current `main` migration, matching, and library tests. |
| `b60fa27` dual-pane containment | Superseded by the current responsive workspace structure. |
| `aa669e7` dual-pane click fix and generated publish output | Do not port generated output; current source and builds have moved on. |
| `ae3389a` workspace and library redesign | Superseded by `AppHeader`, `CreateEditorPane`, route-aware navigation, and current library components. |
| `77e9e9e` landing docs and publish alignment | Partially useful; only current source-of-truth deployment documentation was reimplemented. |
| `16555f6` sprint execution prompts | Replaced by this current-main backlog and implementation sequence. |

No commit should be cherry-picked wholesale. The old branch is a recovery
reference, not a base for new feature work.

## Desktop stabilization

- Add one repeatable desktop preflight covering JavaScript tests, the shared
  frontend build, Cargo checks, and Tauri packaging.
- Verify provider settings, local storage, restart behavior, remote providers,
  and Ollama discovery.
- Make storage, authentication, connectivity, and model errors visible.
- Verify packaged behavior at the minimum and default desktop window sizes.

## Enhance workflow and follow-ups

- Present Draft, Refine, Review Result, and Save or Continue as one workflow.
- Keep user input visible during loading, cancellation, and errors.
- Prioritize output after a successful enhancement while keeping copy, save,
  replace, compare, variants, and notes reachable.
- Generate follow-up suggestions from actual selected run output when available.
- Preserve source prompt, source run, provider, model, and timestamp metadata.
- Allow follow-ups to be saved as independent library records.

## Library reliability and sync

- Freeze the native export contract with round-trip fixtures.
- Put local persistence behind a repository interface with load, save,
  subscribe, backup, export, and import operations.
- Back up data before migrations, imports, and bulk operations.
- Use a fixed identify, normalize, validate, preview, resolve, commit, summarize
  import pipeline.
- Add revision-aware cross-tab synchronization before cloud synchronization.
- Gate cloud sync on an explicit authentication, backend, deletion, and conflict
  resolution design.

## Scratchpad rich editing

- Add double-click inline rename with Enter, Escape, and blur behavior.
- Support normal text, H1, H2, bold, italics, underline, bullets, numbered
  lists, task lists, and an accessible text-color palette.
- Migrate existing plain-text pads through a versioned, backed-up schema.
- Preserve autosave, readable export, library promotion, keyboard access, and
  narrow-layout behavior.

## Later product-model work

Skill Lab and Agent Lab need a shared record model before UI implementation.
The design must decide whether skills and agents are library records, linked
execution templates, or separate entities.

The admin health dashboard should report provider configuration, storage
health, recent run failures, sync state, shell version, and deployment version.
It should remain diagnostic and access-controlled rather than becoming a
general landing page.
