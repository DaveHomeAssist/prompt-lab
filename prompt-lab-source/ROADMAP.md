# Prompt Lab Roadmap

## Current shipped state

Prompt Lab is currently shipped as:

- an MV3 side panel extension
- a Tauri desktop app that reuses the shared frontend
- a hosted web deployment split between the landing page on `promptlab.tools` and the currently public shared app at `https://promptlab.tools/app/`

Current shipped capabilities include:

- prompt enhancement workflows
- A/B testing
- eval run history and test cases
- five provider support across extension and desktop, with an Anthropic-first hosted web surface
- PII scanning
- extension CI and desktop build CI

## Near-term priorities

These are active priorities, not shipped commitments:

1. Tighten desktop release packaging and distribution flow beyond local macOS validation.
2. Finish Chrome Web Store submission materials:
   - store listing copy
   - screenshots and promo assets
   - final permission review
3. Keep extension, desktop, and web documentation aligned as the shared architecture evolves.
4. Keep the `promptlab.tools` landing page, the public hosted app URL, and the proxy-backed web flow aligned with the current product docs.

## Platform expansion strategy

| Version | Focus |
|---------|-------|
| v1.6 | Distribution polish (CWS submission + desktop preview) |
| v1.7 | Prompt Lab Server experiment (self-hosted browser access) |
| v1.8 | Workflow improvements (ghost variables, golden response UI) |
| v2.x | Mobile or public web platform |

Platform priority ladder:

1. **Extension + Desktop** — current primary surfaces, zero backend
2. **Prompt Lab Server** — self-hosted process for browser access without a public proxy
3. **Native mobile apps** — only if demand justifies it
4. **Public web app / PWA** — deferred until a backend is architecturally justified

The hosted web app at `https://promptlab.tools/app/` is a convenience surface for evaluation
and demo purposes. It is not the primary product and should not gate feature work.

## Next improvements under consideration

These are candidates, not released features:

1. Additional provider integrations beyond the current five-provider set.
2. Broader end-to-end coverage for desktop and cross-platform packaging flows.
3. More explicit release packaging for public extension builds versus developer-oriented local-provider builds.
4. Continued cleanup of legacy duplicate trees and archived planning material.
5. Mobile deployment via a Tauri Mobile shell after desktop CI and packaging stabilize. See `MOBILE_DEPLOYMENT_ROADMAP.md` and the ADR in Notion.

## Guardrails

- Do not describe roadmap items as shipped in public-facing docs.
- Treat `prompt-lab-source/` as the canonical source tree for active documentation.
- Keep release notes and README content based on verified commands and current repo state.
- **v1.x rule:** avoid introducing a public backend unless it unlocks a core feature that cannot be delivered client-side.
