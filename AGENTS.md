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
| 001 | P2 | open | Composer still teaches drag first interaction | Current composer still leads with drag to add and drag reorder |
| 002 | P2 | in-progress | Create workflow remains too vertically stacked | Layout is improved, but Create still carries too many stages in one scroll path |
| 003 | P2 | in-progress | Experiments and run history are still split | A B flow and run analysis are improved but not fully unified |
| 004 | P2 | open | Accessibility parity remains incomplete | Header icon labeling and light mode body background still need cleanup |
| 005 | P2 | resolved | Privacy policy page missing, all nav links dead | Created docs/privacy.html, fixed all nav/footer links to relative paths |
| 006 | P2 | resolved | No diff viewer for A/B test outputs | Added DiffEngine.js, DiffPane.jsx, and Sync View button in ABTestTab |

## Session Log

[2026-03-18] [PLB] [docs] Add AGENTS baseline
[2026-03-18] [PLB] [fix] Create privacy page and fix dead nav links across all docs pages

