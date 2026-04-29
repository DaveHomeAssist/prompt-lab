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
| 007 | P1 | open | Release gate blocked by unpushed commits and audit findings | Mixed dirty docs were resolved in `738dd66`; worktree is clean, but the branch has local commits not pushed because Vercel preview builds can create cost. Fresh root audit shows 5 vulnerabilities: 3 moderate, 1 high, 1 critical. Remaining Vercel cost-surface decisions also block a clean release gate |
| 008 | P1 | resolved | Vercel spend containment is proved | Verified production deployment dpl_AJyJPKC5agM6N1CN2KtezPY9ypxR on promptlab.tools; project unpaused, Node 22.x, Fluid false, elastic false, billing and provider proxy envs closed; live billing checkout returned 503 with timeout=false log |
| 009 | P1 | resolved | Vercel cost incident prevention captured | Incident report lives at docs/incidents/prompt-lab-vercel-billing-incident-2026-04-29.md; future Vercel production, API, billing, telemetry, webhook, or unpause work must use the workspace Vercel API and Cost Safety Standard plus the vercel-cost-guard skill |

## Session Log

This inline log is retired. Current session entries live in `/Users/daverobertson/Desktop/Code/90-governance/docs/today.csv` per the workspace logging standard.

Historical entries remain in git history before commit `57b8aef`.
