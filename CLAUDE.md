# CLAUDE.md

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

## Documentation Maintenance

- **Issues**: Track in the issue tracker table below
- **Session log**: Append to `/Users/daverobertson/Desktop/Code/95-docs-personal/today.csv` after each meaningful change

## Issue Tracker

Full visual tracker: `_internal/UI_ISSUES_TABLE.html` (open locally in browser)

| ID | Sev | Status | Title |
|----|-----|--------|-------|
| 001 | P2 | done | Navigation no longer gives every legacy surface equal weight |
| 002 | P2 | done | Create layout controls behave like layout preferences |
| 003 | P2 | done | Save metadata no longer interrupts Create flow inline |
| 004 | P2 | done | Create results use tabs instead of one vertical stack |
| 005 | P2 | done | Error handling presents compact recovery actions |
| 006 | P2 | done | Frequently Used no longer competes with result area |
| 007 | P2 | done | Library rows no longer expose full action set inline |
| 008 | P2 | done | Winner selection is inline instead of modal-driven |
| 009 | P2 | done | Composer teaches explicit Add/Move controls, not drag-only |
| 010 | P2 | done | Provider setup exposes all five providers with correct fields |
| 011 | P2 | partial | Create authoring surface above results still dense |
| 012 | P2 | partial | Library detail still expands inline causing list jitter |
| 013 | P2 | partial | Experiments and history still split across two surfaces |
| 014 | P2 | partial | Icon labeling and light-mode background parity need cleanup |
| 015 | P2 | partial | Two-tier save needs workflow validation |
| 016 | P2 | partial | Create Library drawer actions need user testing |
| 017 | P2 | partial | Auto-save vs explicit save clarity in experiments |
| 018 | P2 | partial | Composer overlay entry points need shell-specific tuning |
| 019 | P3 | deferred | Full WCAG AA contrast audit after visual system lands |
| 020 | P3 | deferred | Shared Connection Center across onboarding/settings/Options |
| 021 | P3 | deferred | Reduce micro-label density and raise global type scale |
| 022 | P3 | deferred | Panel width and bottom-sheet tuning for narrow shells |

## Session Log

[2026-03-18] [PLB] [docs] Add AGENTS baseline
[2026-03-18] [PLB] [fix] Create privacy page and fix dead nav links across all docs pages
[2026-03-18] [PLB] [fix] Prevent create pane action rows and diff output from overflowing at narrow widths
