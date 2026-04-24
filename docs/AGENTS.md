# AGENTS.md

Inherits root rules from `/Users/daverobertson/Desktop/Code/AGENTS.md`.

## Project Overview

Prompt Lab is a multi surface prompt engineering tool with extension, desktop, and web oriented shells. It focuses on authoring, saving, testing, comparing, and reusing prompts across multiple providers.

## Stack

- React
- Vite
- Chrome extension surface plus desktop and web shells
- Local storage and Chrome storage persistence
- Vitest for targeted tests

## Key Decisions

- Keep provider support abstracted so UI and execution flows are not hard wired to one model vendor
- Separate authoring, library, experiments, and notebook concerns even when they share one shell
- Persist prompt, run, and settings state locally to keep the tool fast and offline tolerant where possible

## Issue Tracker

| ID | Severity | Status | Title | Notes |
|----|----------|--------|-------|-------|
| 001 | P2 | resolved | Composer still teaches drag first interaction | Fixed all help text strings; empty state and block hints now lead with Add/Move controls |
| 002 | P2 | resolved | Create workflow remains too vertically stacked | Phase 1 complete: extracted CreateEditorPane, collapsed scoring+lint strip, inline quick inject chips, merged status bar, compact context breadcrumb |
| 003 | P2 | in-progress | Experiments and run history are still split | Unified under Evaluate with persistent timeline filters; compare-model toggle no longer traps active state on filtered timelines, and broader QA under Node 22 now passes locally |
| 004 | P2 | resolved | Accessibility parity remains incomplete | Added aria-labels to theme/shortcuts/settings buttons; ThemeProvider now syncs body bg |
| 005 | P2 | resolved | Privacy policy page missing, all nav links dead | Created docs/privacy.html, fixed all nav/footer links to relative paths |
| 006 | P2 | resolved | No diff viewer for A/B test outputs | Added DiffEngine.js, DiffPane.jsx, and Sync View button in ABTestTab |

## Session Log

[2026-03-18] [PLB] [docs] Add AGENTS baseline
[2026-03-18] [PLB] [fix] Create privacy page and fix dead nav links across all docs pages
[2026-03-18] [PLB] [fix] Prevent create pane action rows and diff output from overflowing at narrow widths
[2026-03-24] [PLB] [docs] Add Create and Evaluate Phase 0 implementation brief and docs inventory entries
[2026-03-24] [PLB] [fix] Persist Evaluate timeline filters and stabilize re-enhance mode imports
[2026-03-24] [PLB] [test] Add hook coverage for library filters, quick-inject ranking, and collection cleanup
[2026-03-24] [PLB] [test] Harden Evaluate navigation semantics with hook and header regression coverage
[2026-03-24] [PLB] [refactor] Extract CreateEditorPane, compress Create vertical stack (Phase 1 complete)
[2026-03-31] [PLB] [fix] Keep Evaluate model-compare toggle visible when persisted state stays active on filtered timelines
[2026-03-31] [PLB] [test] Expand Evaluate hook coverage for filters, pagination, and run patch updates
[2026-04-14] [PLB] [test] Stabilize RunTimelinePanel timeouts so the full extension suite passes under Node 22
