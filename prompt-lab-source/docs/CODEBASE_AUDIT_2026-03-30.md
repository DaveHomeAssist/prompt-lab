# Prompt Lab Codebase Audit — 2026-03-30

## Scope

Audit focused on the active `prompt-lab-source/` tree, with emphasis on:

- runtime architecture and state boundaries
- local test/build/deploy infrastructure
- stale artifacts and release hygiene
- Create, Evaluate, Library, and public-site UX
- public narrative alignment across docs and landing surfaces

## Findings

### Architectural gaps

- Navigation state was duplicated across `src/lib/navigationRegistry.js`, `src/hooks/useUiState.js`, `src/hooks/useNavigation.js`, and `src/hooks/useRouteSync.js`. The same tab, section, and route rules were encoded in multiple places.
- `src/App.jsx` still carries a large orchestration surface. The extracted hooks/components improved it, but cross-cutting navigation and workflow state are still tightly coupled to the root.
- Public landing authoring remains split between `prompt-lab-web/index.html` and `public/prompt-lab-landing.html`, which creates copy drift risk.

### Weak infrastructure components

- Vitest local stability was degraded by the forced `forks` pool under Node 22; jsdom bootstrap could fail before test collection.
- `scripts/preflight.mjs` did not verify desktop Cargo version parity and did not enforce publication of `privacy.html` and `prompt-embed.html`.
- `scripts/publish-landing.mjs` copied only `guide.html` and `setup.html`, which left public auxiliary pages out of the documented publish path.

### Artifacts from older builds

- `prompt-lab-web/dist/privacy.html` and `prompt-lab-web/dist/prompt-embed.html` were still tracked even though `prompt-lab-web/dist/` is ignored.
- Release/version docs still carried the old hosted URL and older release snapshots.
- `.github/copilot-instructions.md` contained trailing malformed content from an older path/export artifact.

### Graphical shortcomings

- Evaluate had weak feedback loops for empty, filtered-empty, and error states. Users had to infer why the timeline was empty.
- Library empty states were passive and visually inert despite starter packs and import actions already existing.
- The public site still framed the product as a fully multi-provider hosted app, which now creates visual and narrative mismatch with the live experience.

### Potential UI/UX improvements

- Evaluate needed active filter chips, a visible filtered summary, and an explicit retry path.
- Library needed starter-pack and clear-filter CTAs at the point of failure instead of only lower in the panel.
- Navigation needed a single shared contract so future UI changes do not regress route/header behavior.

### Narrative design issues

- Public and repo docs still pointed users to `prompt-lab-tawny.vercel.app/app/`.
- Hosted web copy still promised “five providers” and “enter your API key” even after the hosted surface was intentionally narrowed to Anthropic-first shared-key usage.
- Version docs overstated precision with stale test counts and under-described the current hosted/runtime split.

### Other areas for enhancement

- `App.jsx` remains the next major architectural compression target after navigation cleanup.
- Duplicate landing authoring sources should eventually be consolidated so the public site has one canonical narrative source.
- Preflight and release docs should continue shifting from optimistic historical claims to verified current-state checks.

## Prioritized next steps

### 1. Centralize navigation state contract

Impact:
- Removes the highest-value architectural duplication and reduces regression risk for future route/header changes.

Plan:
- Move tab, section, and route mapping rules into `navigationRegistry.js`.
- Update `useUiState`, `useNavigation`, and `useRouteSync` to consume the shared helpers.
- Extend tests around route/section/tab round-trips.

Execution status:
- Completed in this change.

### 2. Improve Evaluate feedback states

Impact:
- Directly improves first-run comprehension and reduces “empty but unclear why” friction in the Evaluate surface.

Plan:
- Surface total counts from `useEvalRuns`.
- Add filter summary chips and a visible filtered summary row.
- Add explicit no-match and retryable error states in `RunTimelinePanel`.
- Extend panel tests for filtered-empty and error handling.

Execution status:
- Completed in this change.

### 3. Improve Library empty-state onboarding

Impact:
- Converts the Library from a passive archive view into an action-oriented onboarding surface.

Plan:
- Add CTA-driven empty states for first-run library usage.
- Expose starter-pack loading directly from the empty state.
- Add “Clear Filters” from no-results state.
- Cover the new paths with focused LibraryPanel tests.

Execution status:
- Completed in this change.

### 4. Align hosted-mode narrative and public docs

Impact:
- Fixes trust-breaking copy drift between the live hosted product and what the docs/landing pages claim.

Plan:
- Replace stale hosted URLs with `https://promptlab.tools/app/`.
- Update hosted copy to describe Anthropic-first web behavior accurately.
- Remove stale counts and malformed instruction artifacts from supporting docs.
- Refresh version/release docs to match the current release posture.

Execution status:
- Completed in this change.

### 5. Harden test and release hygiene

Impact:
- Stabilizes the local validation loop and closes gaps that let stale or incomplete public outputs slip through.

Plan:
- Switch Vitest to a stable pool configuration for Node 22.
- Extend landing publish/preflight to include auxiliary public docs.
- Restore Cargo/package version parity.
- Remove tracked build artifacts from ignored dist directories.

Execution status:
- Completed in this change.

## Residual risks

- `src/App.jsx` still remains large and should be the next architectural decomposition target.
- Landing authoring is still duplicated between two HTML sources; copy has been aligned, but the duplication itself remains.
- Public docs publishing still depends on a manual/static pipeline rather than a single generated artifact path.
