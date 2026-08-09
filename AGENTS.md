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
| 003 | P2 | in-progress | Experiments and run history are still split | Unified under Evaluate with persistent timeline filters; compare-model toggle no longer traps active state on filtered timelines, and broader QA under Node 22 is still pending |
| 004 | P2 | resolved | Accessibility parity remains incomplete | Added aria-labels to theme/shortcuts/settings buttons; ThemeProvider now syncs body bg |
| 005 | P2 | resolved | Privacy policy page missing, all nav links dead | Created docs/privacy.html, fixed all nav/footer links to relative paths |
| 006 | P2 | resolved | No diff viewer for A/B test outputs | Added DiffEngine.js, DiffPane.jsx, and Sync View button in ABTestTab |
| 007 | P2 | resolved | Selected pad title unreadable in light theme | Threaded colorMode into PadTab; theme-aware active title, fixed dead theme sniff, stable row width |
| 008 | P2 | resolved | GitHub-login entitlement persistence diverges from email login | Clerk-id-first Stripe lookup, checkout clerkUserId binding, revalidate guard parity, billing state reset on account switch |
| 009 | P2 | resolved | Failed/cancelled enhance runs missing from run history | Error and cancelled enhance attempts now recorded with enhanceMode tag and timeline status filters |
| 010 | P2 | resolved | Library auto-naming produced prefix-slice titles | Heading/role-aware title suggestion; enhance no longer clobbers user-typed titles |
| 011 | P1 | resolved | iOS prototype dropped failed/cancelled enhance runs (regression vs 009) | Native store now writes RunRecord with status failed/canceled; attempts that never reach the provider (no API key) still record nothing |
| 012 | P1 | resolved | iOS enhance parser rejected fenced or preambled contract JSON | Recover outermost JSON object before decoding; fences and short preambles no longer fail an otherwise-valid run |
| 013 | P2 | resolved | iOS provider discarded Anthropic error bodies | Non-2xx responses drained (8KB cap) and decoded so invalid-key/rate-limit reasons surface instead of a bare status code |

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
[2026-06-06] [PLB] [ops] Create latest-main route/CI greenline worktree from origin/main b61f254
[2026-06-06] [PLB] [fix] Add privatepolicy redirect, publish static mobile fallbacks, and prevent mobile canvas state 404s
[2026-06-06] [PLB] [fix] Restore docs lint pass and desktop isolated build dependency resolution
[2026-06-06] [PLB] [test] Verify docs check, web build, isolated desktop build, and local static route smoke
[2026-06-06] [PLB] [ci] Include macOS universal Tauri bundle paths in artifact uploads
[2026-06-06] [PLB] [build] Verify local Windows Tauri MSI/NSIS packaging and sync Cargo lock version
[2026-06-08] [PLB] [fix] Broaden preset importer to load library exports and starter library JSON
[2026-06-08] [PLB] [ops] Extend local preflight command timeout for current Vitest suite duration
[2026-06-09] [PLB] [feature] Add server-side owner Pro entitlement for verified Clerk accounts
[2026-06-09] [PLB] [landing] Refresh landing page around import packs, portable libraries, and current Pro gates
[2026-06-09] [PLB] [fix] Surface preset import failures and expand Library import regression coverage
[2026-07-26] [PLB] [fix] Make selected pad sidebar title theme-aware and stabilize row layout
[2026-07-26] [PLB] [fix] Align GitHub-social and email Clerk login entitlement persistence
[2026-07-26] [PLB] [feature] Record failed and cancelled enhance runs with enhance-mode tags in run history
[2026-07-26] [PLB] [feature] Smarter library auto-naming (headings, role preambles, no title clobbering)
[2026-07-26] [PLB] [feature] Add on-demand follow-up prompt suggestions with editor/composer chaining
[2026-07-26] [PLB] [docs] Add native Swift iPad app plan (IPAD_NATIVE_APP_PLAN.md)
[2026-07-28] [PLB] [feature] Add Recent Surface Sweep maintenance prompt to Workspace Cleanup seed library
[2026-08-02] [PLB] [review] Audit native iPad prototype branch; 3 P1/P2 issues found (011-013)
[2026-08-02] [PLB] [fix] Record failed and canceled enhance runs in native run history (011)
[2026-08-02] [PLB] [fix] Tolerate Markdown-fenced and preambled enhance contract JSON on iOS (012)
[2026-08-02] [PLB] [fix] Surface Anthropic error bodies instead of bare HTTP status codes (013)
[2026-08-02] [PLB] [test] Verify native suite on iPad Pro simulator, 14/14 passing
[2026-08-08] [PLB] [feature] Add Dave's project-specific verify-only prompt instruments starter library
[2026-08-09] [PLB] [build] Complete Node 22 remediation: engines/guards/CI to 22.x, four pinned upgrades, lockfiles regenerated, dependency-health workflow, audit gate zero high/critical
[2026-08-09] [PLB] [landing] Reconcile the landing redesign with Node 22 and the shared dependency health gate
[2026-08-09] [PLB] [ios] Reconcile the universal native prototype with the verified landing and Node 22 release baseline
