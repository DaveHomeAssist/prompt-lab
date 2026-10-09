# Prompt Lab Roadmap

## Storyline reconciliation — 2026-10-09

Evidence baseline: main `f03f414b761d047d9a3d12dd356a03f5329608f9`.
This is continuity reconciliation, not a new readiness assessment. Historical
plans retain their original dates; missing completion evidence is not cancellation.

| Storyline | Evidence and disposition | Next action / exit condition |
|---|---|---|
| Daily dashboard | April collector/renderer/scheduler documented; physical HTML location Unknown in the reported search. No migration to project-progress established. | Locate an original artifact or record bounded recovery failure; decide retention separately from re-enabling scheduling. |
| Activation and Evaluate | Activation milestones and next-action controls exist in CreateEditorPane; Evaluate timeline exists. April product-outcome acceptance is not freshly established. | Trace starter → draft → save → run → compare/reuse through existing tests and a bounded browser scenario; record pass/fail per original criterion before proposing UI changes. |
| DaveLLM integration | [PR #131](https://github.com/DaveHomeAssist/prompt-lab/pull/131) is open at `8f9e460`; Windows acceptance failed and alternate-package acceptance was skipped. PR reports fixture-router proof, not live-model acceptance. | Reconcile the PR with current main and diagnose the Windows failure; require fresh applicable checks. Keep the explicitly Dave-gated live-model milestone separate. |
| Launch and conversion | Launch plans and store assets exist; no completed commercial launch is established by this review. Billing acceptance retains test-environment prerequisites. | Verify existing Clerk/Stripe test-mode prerequisites, then prove checkout/webhook/entitlement/portal recovery without a live charge; validate store/distribution receipts separately. |
| Architecture simplification | Main contains MainWorkspace, LibraryWorkspace and other extracted components; old decomposition intentions are not proof of a completed refactor. | Map each old hotspot to present ownership and a concrete maintenance problem; avoid a broad refactor based only on file size. |
| Feature health | August 9 health score is historical; issue counts measure recorded dispositions. | Reassess original rubric against a named revision and runtime evidence before publishing a new score. |
| Native distribution | M0–M3 implemented; M4 inputs and maintained-release posture remain open on the existing native issue. | Resolve bundle identity, store/privacy assets, Apple distribution access and release criteria; verify exact artifacts and operator acceptance. |
| Tauri Mobile | Explicitly deferred by D-011 in favor of native SwiftUI. | Preserve the decision; do not restart the deferred path without a new product decision. |

### Execution phases and acceptance boundaries

1. **Source reconciliation (this change):** connect existing records, annotate stale
   claims, preserve all issue dispositions and historical evidence. Exit: Notion
   readback plus deterministic dashboard parity; no readiness promotion.
2. **Acceptance and integration:** continue the already accepted Plan J controls
   (actual starter loading, tag/status filters, stale deletion reconciliation and
   full browser-process restart). Review PR #131 in its own bounded integration
   lane; a green Library navigation slice does not waive its failed Windows check.
   Exit: exact-head checks and named runtime evidence; keep human/native gates open.
3. **Product outcome verification:** audit the existing activation/Evaluate journey
   against the April plan and map architecture work to remaining observed problems.
   Exit: a criterion-by-criterion result and a small repair brief for confirmed gaps.
4. **Commercial and distribution acceptance:** execute only when the existing
   billing test environment and native distribution inputs are available.
   Exit: safe billing lifecycle proof and supported-platform release receipts.

Phases are not dates or blanket permission to call models, change credentials,
enable billing, publish stores, restart schedulers or revive deferred features.
The first live DaveLLM model run remains explicitly Dave-gated.

### Open choices

- **CONT-01 — April dashboard:** A (recommended) retain as historical evidence and
  recover originals only; B restore it as an operational dashboard after an owner,
  source contract and duplicate-tracking policy are agreed. B adds maintenance and
  scheduling responsibilities. Status: Open; no scheduler change.
- **Native release posture:** reuse the existing experimental/internal/beta/supported
  choice on the native issue; do not create a competing decision or infer approval.
- Existing billing environment and Library Tests runner-semantics choices retain
  their original owners and unanswered state.

### Evidence sources

- [Canonical source guide](https://app.notion.com/p/31f255fc8f44807abbd8d0dd4d62cb89)
- [Reference map](https://app.notion.com/p/064ddc1d2f494d67ba4facd6e0c5d981)
- [Archive register](https://app.notion.com/p/e7052c5832134aa8bae125fed3c0616c)
- [Implementation RUN](https://app.notion.com/p/3d2255fc8f44810a85d4e3fec5ddc6f2)
- [Native release issue](https://app.notion.com/p/cecbf7cfcd9d489a8e92770131436505)
- [Three-sprint intent](docs/next-3-sprints-plan.md)
- [Historical health rubric](docs/feature-health-dashboard.md)

The hub records a successful August 12 P1 re-audit and PR #36 provenance closeout;
the earlier August 11 hold is historical, not the current release verdict.
[PR #99](https://github.com/DaveHomeAssist/prompt-lab/pull/99) merged September 20 as
`2444340`; old draft/conflict claims are superseded. Neither correction closes
remaining billing, desktop, signing or human acceptance.

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
2. Preserve the recorded August 12 P1 re-audit and provenance closeout; evaluate remaining acceptance against the current candidate rather than carrying the earlier hold forward.
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
