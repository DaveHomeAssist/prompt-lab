# Prompt Lab Roadmap

## Current source and distribution state

Prompt Lab currently contains:

- an MV3 side panel extension
- a Tauri desktop app that reuses the shared React frontend
- a public hosted React workbench at `https://promptlab.tools/app/`
- a separate public React mobile prototype at `https://promptlab.tools/mobile/`
- a focused native SwiftUI iPhone/iPad app with M0-M3 implemented

Implemented source is not the same as marketplace distribution. Chrome Web Store materials remain in preparation, desktop builds are CI/local artifacts rather than a current public release, and native M4/TestFlight/App Store work is blocked on distribution inputs.

Current shipped capabilities include:

- prompt enhancement workflows
- A/B testing
- eval run history and test cases
- five provider support across extension and desktop, with an Anthropic-first hosted web surface
- PII scanning
- web, extension, desktop, native, docs, and API CI coverage

## Near-term priorities

These are active priorities, not shipped commitments:

1. Implement the required controls in `docs/release-versioning.md`, bump the shared product through the single version tool, and promote the next feature release as `1.8.0` only after its gates pass.
2. Re-audit the August behavioral fixes before promoting the unreleased source line.
3. Tighten desktop release packaging and distribution beyond CI/local artifacts.
4. Finish Chrome Web Store submission materials:
   - store listing copy
   - screenshots and promo assets
   - final permission review
5. Supply the native app's production bundle identifier, store assets, Apple distribution access, privacy metadata, and release criteria before M4.
6. Keep the shared React surfaces, React mobile prototype, native contract, public URLs, and release metadata aligned with verified behavior.

## Platform posture

| Surface | Current posture |
|---|---|
| Extension | Primary full-provider React workbench; store submission not complete |
| Desktop | Primary full-provider React workbench; cross-platform artifacts verified in CI |
| Hosted `/app/` | Public Anthropic-first workbench backed by the Vercel proxy |
| React `/mobile/` | Public touch-first prototype, not an installed mobile product |
| Native iPhone/iPad | Focused Anthropic-first SwiftUI v1; distribution blocked at M4 |
| Prompt Lab Server | Proposed self-hosted mode; not shipped |
| Tauri Mobile | Deferred alternative retained for reference; not the current native path |

ADR D-011 selected the native SwiftUI universal app over the earlier Tauri Mobile plan. `MOBILE_DEPLOYMENT_ROADMAP.md` is a deferred fallback, not the active architecture.

## Next improvements under consideration

These are candidates, not released features:

1. Additional provider integrations beyond the current five-provider set.
2. Broader end-to-end coverage for desktop and cross-platform packaging flows.
3. More explicit release packaging for public extension builds versus developer-oriented local-provider builds.
4. Continued cleanup of legacy duplicate trees and archived planning material.
5. Decide whether the React mobile prototype remains an evaluation surface, graduates into a supported PWA, or is retired in favor of the native app.

## Guardrails

- Do not describe roadmap items as shipped in public-facing docs.
- Treat `prompt-lab-source/` as the canonical source tree for active documentation.
- Keep release notes and README content based on verified commands and current repo state.
- **v1.x rule:** avoid introducing a public backend unless it unlocks a core feature that cannot be delivered client-side.
- Treat package versions, Git tags, GitHub Releases, marketplace distribution, and deployed code as separate release facts.
