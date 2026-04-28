# Prompt Lab Next 3 Sprints Plan

Status: active
Updated: 2026-04-16

## Purpose

This document turns the current Prompt Lab priority stack into an execution order for the next three product sprints.

It is intentionally narrow:

- Sprint 1 focuses on activation
- Sprint 2 focuses on proof
- Sprint 3 focuses on conversion

This sequence is meant to improve the part of the business loop that matters most right now:

1. user arrives
2. user gets a first win
3. user believes the product is better than generic prompt tooling
4. user hits a compelling upgrade moment

## Why this order

Prompt Lab already has meaningful capability breadth. The biggest near-term upside is not more raw surface area. It is making the existing workflow easier to start, easier to trust, and easier to pay for.

That means:

- do not lead with net-new feature sprawl
- do not let release/distribution work replace product activation work
- do not chase backend/platform expansion before the core loop is sharper

## Sprint overview

| Sprint | Theme | Primary outcome |
|---|---|---|
| Sprint 1 | Activation runway | More users reach first saved prompt and first run |
| Sprint 2 | Evaluate as proof | More users trust Prompt Lab's judgment workflow |
| Sprint 3 | Conversion engine | More users hit clear reasons to upgrade |

## Global success markers

These should improve across the full three-sprint block:

- more users load a starter prompt or begin from a usable draft
- more users save at least one prompt to Library
- more users generate and review at least one Evaluate run
- more users attempt gated comparison or export flows
- fewer dead-end empty states across Workbench, Library, and Evaluate

## Sprint 1: Activation runway

### Goal

Make the first-run path feel obvious and momentum-building from landing CTA to Workbench to Library to Evaluate.

### User outcome

A new user should be able to move from blank state to:

1. starter draft or pasted draft
2. refined prompt
3. saved library entry
4. first Evaluate run

without needing to infer the product model from scattered controls.

### Scope

- tighten first-run CTA language between landing and in-app surfaces
- improve Workbench empty-state guidance and next-action clarity
- add a visible first-run activation runway inside the app
- reduce dead ends between Workbench, Library, and Evaluate
- keep the shared hybrid brand system intact while doing this

### Primary files

- `prompt-lab-extension/src/App.jsx`
- `prompt-lab-extension/src/CreateEditorPane.jsx`
- `prompt-lab-extension/src/RunTimelinePanel.jsx`
- `prompt-lab-extension/src/tests/CreateEditorPane.test.jsx`
- `prompt-lab-extension/src/tests/RunTimelinePanel.test.jsx`
- `prompt-lab-web/index.html`

### Acceptance criteria

- Workbench clearly tells the user what the next best action is
- first-run users can load a starter draft from the Workbench surface itself
- users with a draft but no saved prompt are nudged to save
- users with a saved prompt but no run are nudged toward Evaluate
- Evaluate empty states reinforce the first-run path instead of feeling separate
- no new visual drift is introduced between landing and app shell

### Verification

- targeted Vitest coverage for Workbench and Evaluate activation states
- extension build passes
- web build passes if landing CTA copy or flow changes land in this sprint
- manual browser smoke check for first-run flow

## Sprint 2: Evaluate as proof

### Goal

Turn Evaluate into the place where Prompt Lab proves its value, not just where old runs accumulate.

### User outcome

A user should understand:

- what changed
- which output is better
- why it is better
- what to keep

without bouncing between compare/history mental models.

### Scope

- stronger compare-and-history cohesion
- clearer winner framing and verdict handling
- sharper golden-response and benchmark affordances
- easier save-back or promote-to-library flow from strong results
- stronger diff emphasis and review hierarchy

### Primary files

- `prompt-lab-extension/src/RunTimelinePanel.jsx`
- `prompt-lab-extension/src/ABTestTab.jsx`
- `prompt-lab-extension/src/hooks/useABTest.js`
- `prompt-lab-extension/src/hooks/useEvalRuns.js`
- `prompt-lab-extension/src/tests/RunTimelinePanel.test.jsx`
- `prompt-lab-extension/src/tests/App.test.jsx`

### Acceptance criteria

- Evaluate feels like one coherent proof surface
- compare/history switching does not feel like crossing product seams
- strong runs can be identified and reused quickly
- empty and low-data states still teach the user how to generate evidence
- power-user utility remains intact

### Verification

- targeted Vitest coverage for compare/history behavior
- manual smoke pass for run review and saved-winner flow
- extension build passes

## Sprint 3: Conversion engine

### Goal

Convert improved activation and proof into more upgrade intent without making the product feel hostile.

### User outcome

When a user hits a Pro gate, the upgrade should feel like the natural next move because the workflow value is already obvious.

### Scope

- improve gated empty states and blocked-action moments
- make Pro benefits concrete at the point of need
- tighten billing copy and modal hierarchy
- instrument upgrade-intent events around A/B, diff, collections, export, and batch runs
- reduce accidental friction in Stripe sync and post-checkout state recovery

### Primary files

- `prompt-lab-extension/src/lib/billing.js`
- `prompt-lab-extension/src/hooks/useBillingState.js`
- `prompt-lab-extension/src/App.jsx`
- `prompt-lab-extension/src/RunTimelinePanel.jsx`
- `prompt-lab-extension/src/LibraryPanel.jsx`
- `prompt-lab-extension/src/modals/` billing-related surfaces
- `api/billing/license.js`
- `api/billing/checkout.js`

### Acceptance criteria

- blocked features explain the benefit, not just the restriction
- upgrade CTAs are placed at high-intent moments
- billing sync and local plan refresh feel reliable
- upgrade events are measurable without adding auth-heavy complexity

### Verification

- targeted Vitest coverage for gated surface states
- manual billing-flow smoke pass in hosted web mode
- extension build passes
- web build passes

## Parallel release track

These items are still important, but they should not replace the sprint sequence above:

- Chrome Web Store listing polish
- screenshots and promo assets
- permission review copy
- desktop packaging and distribution hardening

Treat this as a parallel release track that benefits from the UX improvements above rather than a substitute for them.

## What to defer during this block

Defer unless a sprint explicitly proves the need:

- mobile shell work
- major public-backend expansion
- provider sprawl beyond current strategic need
- broad refactors that do not improve activation, proof, or conversion

## Immediate execution order

Start from the top:

1. land Sprint 1 activation runway changes
2. validate them in the browser and tests
3. move into Evaluate proof shaping
4. only then harden conversion and upgrade moments

This keeps Prompt Lab moving toward a cleaner growth loop instead of scattering effort across unrelated improvements.
