# Prompt Lab bold UX/UI restructure spec

## Status

- Status: `active`
- Updated: `2026-04-12`
- Scope: bold UX/UI restructuring across the public landing surface and the in-app Prompt Lab experience

## Purpose

Prompt Lab currently feels like two adjacent products:

- the landing page is editorial, cinematic, serif-led, and rust/gold accented
- the app is compact, utility-first, and primarily violet/Tailwind-driven

That split weakens conversion and trust. The marketing surface promises a premium, coherent tool, while the product surface still feels like a capable but accumulated internal workbench.

This spec defines a bold restructure that improves:

- landing-page conversion
- cross-surface design coherence
- product mental-model clarity
- perceived product maturity

## Goals

1. Increase landing conversion into the hosted app and extension flow.
2. Reconcile the landing and app into one recognizable Prompt Lab design system.
3. Present the product around a clearer mental model instead of a feature pile.
4. Preserve Prompt Lab's power-user utility while making the product feel more intentional and premium.

## Non-goals

- no backend or build-architecture changes
- no auth or billing architecture redesign
- no full IA rewrite of every app view in a single pass
- no complete visual rewrite of every component before the shell and message are corrected

## Product diagnosis

### Current landing strengths

- strong atmosphere and premium feel
- memorable typography and motion
- better emotional framing than the app currently has

### Current landing weaknesses

- product story is still feature-collage heavy
- visual language does not map tightly enough to the current app
- CTA structure is app-first but not activation-optimized enough
- the page sells "Prompt Lab" more than it sells the actual workflow users will adopt

### Current app strengths

- real functionality breadth
- strong keyboard and local-first utility
- meaningful prompt-engineering workflows already exist

### Current app weaknesses

- top-level shell still feels mechanically assembled
- visual hierarchy is too flat and too violet-utility-coded
- header/navigation exposes implementation history more than product clarity
- it does not inherit enough of the brand confidence promised by the landing

## Design direction

Prompt Lab should use a dual-register hybrid system:

- the landing remains more editorial and persuasive
- the app remains more operational and task-focused
- both share the same underlying brand spine

This is not a compromise mush. It is one system with two expressions.

## Shared design spine

### Color

Adopt one primary brand family across both surfaces:

- `ink`: deep charcoal/near-black base
- `paper`: warm off-white for main text
- `ember`: primary brand/action color
- `ember-bright`: hover/active action color
- `gold`: trust, premium, benchmark, and proof accent

Rules:

- `ember` replaces `violet` as the dominant brand/action color
- cool colors remain available only for functional states such as tags, diffs, and charting
- green and red remain semantic, not brand-defining

### Typography

- `Instrument Serif`: high-emphasis moments only
- `Outfit`: UI and body copy
- `JetBrains Mono`: metadata, shortcuts, versions, models, and system labels

Rules:

- the landing keeps more serif drama
- the app uses serif sparingly for workspace titles, premium callouts, and empty-state framing
- the app should not become decorative or slower to scan

### Shape and framing

- slightly heavier borders
- soft but disciplined corner radii
- luminous, thin framing on active surfaces
- fewer flat Tailwind-default gray blocks

### Motion

- same easing family across both surfaces
- landing motion: staged, reveal-driven
- app motion: short, confirmation-driven

## Information architecture direction

### Landing mental model

The landing should frame Prompt Lab around three product ideas:

1. `Workbench`
2. `Library`
3. `Evaluate`

These are the durable user concepts, even if underlying internal state remains `create`, `library`, and `runs`.

### App mental model

The app shell should visibly move toward:

- `Workbench`
- `Library`
- `Evaluate`
- `Notebook` as secondary utility

This does not require rewriting every internal state key immediately. The product label can evolve before every implementation detail does.

## Landing restructure

### Core messaging change

Shift from:

- "here are many things Prompt Lab can do"

To:

- "here is the workflow Prompt Lab gives you"

### Structural change

Recommended landing order:

1. Hero
2. Immediate proof strip
3. Problem framing: why prompts fail
4. Workflow explainer: Workbench / Library / Evaluate
5. Product walkthrough visuals that align to the app shell
6. Surface flexibility: web app, extension, desktop
7. Pricing
8. Final CTA

### Hero change

The hero should:

- lead with the core promise
- present app-first CTA hierarchy
- reduce decorative ambiguity

Primary CTA:

- `Open PromptLab`

Secondary CTA:

- `Install extension`

Tertiary CTA:

- `See how it works`

### Proof strip change

The proof band should emphasize truths that reduce hesitation:

- multi-provider
- library-backed workflow
- evaluation and comparison
- local-first handling

### Feature section change

The current feature rows should be rewritten as product workflow sections rather than independent capabilities:

- Workbench: write, sharpen, iterate
- Library: save, version, reuse
- Evaluate: compare, judge, improve

### Demo alignment change

The demo surface and visual mockups should match the product shell the user will actually see.

No more implied five-peer-tab model in marketing visuals once the app shell is shifting toward a more coherent structure.

## App-shell restructure

### Header and workspace shell

The header should communicate hierarchy clearly:

- brand and product status
- primary workspaces
- contextual subviews
- utility controls

The current shell feels dense and mechanically packed. The redesign should:

- reduce the "control tray" feeling
- give the primary workspaces more clarity and authority
- visually separate utilities from product navigation

### Workbench

The main creation surface should feel like the center of gravity of the product:

- stronger title/context framing
- clearer active-prompt or active-work context
- stronger distinction between input and improved result
- more premium emphasis on the result surface

### Library

The Library should visually read as a first-class product surface, not just a place where old prompts live.

### Evaluate

Evaluate should read as a deliberate analysis surface rather than a merged leftovers area for compare/history.

## First implementation slice

This spec intentionally breaks execution into slices. The first slice should change both the landing and the app shell together.

### Slice 1 scope

- establish shared brand tokens in the app shell
- restructure the app header/workspace naming and visual hierarchy
- rewrite the landing hero, proof band, and top product sections around Workbench / Library / Evaluate
- align CTA language and visual identity across landing and app

### Slice 1 exclusions

- no full Library internals redesign yet
- no full Evaluate internals redesign yet
- no complete component-by-component app recolor pass
- no pricing/business-model changes

## Reconciliation checklist

These mismatches must be visibly reduced in the first slice:

1. rust/gold landing vs violet app branding
2. editorial landing voice vs generic utility app shell
3. conversion-first landing CTA model vs less intentional in-app shell language
4. feature-collage landing structure vs workflow-first product narrative
5. premium landing perception vs cramped app top-level experience

## Acceptance criteria

The first slice is successful when:

- the landing and app clearly look like the same product family
- the landing explains Prompt Lab as a workflow, not just a feature list
- the top-level app shell feels more premium and more coherent
- `Workbench`, `Library`, and `Evaluate` are the dominant visible product concepts
- primary CTAs across the landing consistently point toward the real activation path

## Implementation notes

- keep the current no-backend and shared-frontend architecture intact
- preserve current functionality while improving shell, hierarchy, and message
- prefer token and shell changes before deep component rewrites
- do not let marketing aesthetics reduce in-app usability
