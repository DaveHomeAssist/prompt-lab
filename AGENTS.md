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
- Treat hosted Vercel compute as opt in. Static app delivery is acceptable; public API routes, billing, provider proxy, telemetry persistence, webhooks, and bug report writes require explicit cost review before release

## Current Operations

- Production domain: `promptlab.tools`
- Last verified production deployment: `dpl_AJyJPKC5agM6N1CN2KtezPY9ypxR`
- Last verified deployed source commit: `93ea5cb70dc22231272f5b911d3f6c6451d70522`
- Local branch contains commits after the deployed source. Do not assume local docs, desktop, or tracker changes are deployed
- Hosted billing, hosted provider proxy, hosted shared key, and telemetry persistence are intentionally disabled
- Public API routes can still create Vercel invocation and log cost if bots or users hit them
- Do not push this branch without deciding the Vercel preview build cost strategy
- Home OS has separate dirty files under `/Users/daverobertson/Code/active/home-os`; do not mix those changes into Prompt Lab

## Documentation Maintenance

- Issues are tracked in this `AGENTS.md` table
- Current session log entries go in `/Users/daverobertson/Desktop/Code/90-governance/docs/today.csv`
- The inline session log below is retired and kept only as a pointer
- Vercel incident report: `docs/incidents/prompt-lab-vercel-billing-incident-2026-04-29.md`
- Historical release gate note: `docs/release-gate-classification-2026-04-24.md`
- Vercel refund support draft: `docs/vercel-billing-refund-request-2026-04-28.md`
- For Vercel production, API route, billing, provider proxy, telemetry, webhook, or unpause work, use the root Vercel API and Cost Safety Standard and the `vercel-cost-guard` skill before making any fix claim

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
