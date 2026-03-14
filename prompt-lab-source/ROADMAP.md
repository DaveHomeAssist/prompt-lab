# Prompt Lab Roadmap

## Current shipped state

Prompt Lab is currently shipped as:

- an MV3 side panel extension
- a Tauri desktop app that reuses the shared frontend
- a hosted web app deployed to Vercel with a CORS proxy edge function

Current shipped capabilities include:

- prompt enhancement workflows
- A/B testing
- eval run history and test cases
- five provider support
- PII scanning
- extension CI and desktop build CI

## Near-term priorities

These are active priorities, not shipped commitments:

1. Tighten desktop release packaging and distribution flow beyond local macOS validation.
2. Finish Chrome Web Store submission materials:
   - store listing copy
   - screenshots and promo assets
   - final permission review
4. Keep extension, desktop, and web documentation aligned as the shared architecture evolves.
5. Deploy hosted web version to Vercel and verify end-to-end proxy flow.

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
