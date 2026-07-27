# Prompt Lab for iPad — Native Swift App Plan

Status: proposed (requires an ADR before implementation)
Created: 2026-07-26
Owner: Dave Robertson

## Why this document exists

The July 26 work list calls for a **native Swift iPad Prompt Lab app**. That direction
conflicts with `MOBILE_DEPLOYMENT_ROADMAP.md`, whose stated goal is to ship iOS and
Android **without forking the shared frontend** by wrapping the existing React app in a
Tauri Mobile shell. A native SwiftUI app is a deliberate fork of the UI layer, so the
decision needs to be recorded (Notion `DB | Decisions` → ADR in
`DB | Technical Decisions Log`) before code lands. This plan captures the recommended
scope so the ADR and the first implementation sprint have a concrete basis.

## Decision framing

| Option | Pros | Cons |
|---|---|---|
| Tauri Mobile shell (current roadmap) | One React codebase; extension/desktop parity for free | WebView UX on iPad; weaker multitasking/pencil/keyboard support; app-review risk for WebView-heavy apps |
| Native SwiftUI iPad app (this plan) | First-class iPad UX (Split View, Stage Manager, hardware keyboard, sidebar idioms); Keychain-native key storage; best App Store positioning | Second UI codebase to maintain; feature drift risk against the React app |
| Hybrid: SwiftUI shell + shared JS core | Native chrome with shared enhance/parsing logic via JavaScriptCore | Bridging complexity; still two UI trees |

**Recommendation:** Native SwiftUI app scoped to a focused iPad feature set (below), with
the JSON contracts — not the UI — as the sharing boundary. The React app's provider
payload/response logic is already centralized (`providerRegistry.js`, `promptUtils.js`,
system prompts in `constants.js`), and those contracts are portable as data, not code.

## What the app is (v1 scope)

A three-column iPad workbench mirroring the web app's mental model:

1. **Sidebar** — Library (saved prompts, collections), Pads (scratchpads), Runs.
2. **Editor** — prompt authoring with enhance modes (balanced/claude/chatgpt/image/code/concise/detailed), variables, and lint hints.
3. **Results** — enhanced output, variants, notes/assumptions, diff vs. original, run history.

v1 explicitly **excludes**: A/B compare, composer chains, billing/Pro gating, telemetry,
and the PII scanner (deferred until parity is worth the port).

## Architecture

- **UI:** SwiftUI, `NavigationSplitView` (three-column), targeting iPadOS 17+.
- **State:** `@Observable` models; one `WorkbenchStore` per window scene to support Split View multitasking.
- **Persistence:** SwiftData for library entries, pads, and run records. Schemas mirror the web app's normalized shapes (`promptSchema.js`, `evalSchema.js`) so import/export stays lossless.
- **Interchange:** import/export of the existing library JSON export format is a v1 requirement — it is the bridge between surfaces and removes migration risk.
- **Providers:** a `ProviderClient` protocol with Anthropic first (streaming via URLSession async bytes), then OpenAI/Gemini/OpenRouter. Payload construction ports the shapes in `providerRegistry.js`. Ollama is excluded from v1 (localhost does not map to iPad).
- **Enhance contract:** reuse the exact JSON contract from `buildSystemPrompt` (`constants.js`) — `{"enhanced","variants","notes","assumptions","tags"}` — so results are interchangeable with the web app and eval records stay comparable.
- **Secrets:** API keys in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Never in UserDefaults; no key sync in v1.
- **Auth/billing:** none in v1. The iPad app is BYO-keys, matching the extension/desktop posture rather than the hosted web app's Clerk+Stripe path.

## Repo layout

New top-level package `prompt-lab-ipad/` beside `prompt-lab-extension/`,
`prompt-lab-desktop/`, and `prompt-lab-web/`:

```
prompt-lab-ipad/
  PromptLab.xcodeproj
  PromptLab/            # SwiftUI app target
    Models/             # SwiftData models mirroring promptSchema/evalSchema
    Providers/          # ProviderClient + Anthropic/OpenAI implementations
    Features/           # Sidebar, Editor, Results, Settings
    Interchange/        # library JSON import/export
  PromptLabTests/
  README.md
```

CI: a `macos-14` GitHub Actions job running `xcodebuild build test` for the simulator
destination, added alongside the existing desktop matrix.

## Milestones

1. **M0 — ADR + scaffold (1 sprint):** record the decision; create the Xcode project, SwiftData models, and library JSON import round-trip tests.
2. **M1 — Enhance end-to-end (1–2 sprints):** editor + Anthropic streaming enhance + results panel with variants/notes; Keychain key management.
3. **M2 — Library + pads + runs (1 sprint):** saved library CRUD, scratchpads, local run history mirroring `eval_runs` fields (including `enhanceMode` and the `success/error/blocked/canceled` statuses added 2026-07-26).
4. **M3 — iPad polish (1 sprint):** hardware keyboard shortcuts (mirror `navigationRegistry.js` mappings), Split View/Stage Manager, drag-and-drop of prompts as text, share-sheet export.
5. **M4 — Beta:** TestFlight, App Store metadata reusing `store-assets/`, privacy nutrition labels (no tracking; keys on device).

## Risks

- **Feature drift:** every enhance-contract change in `constants.js` must be treated as a cross-surface API change; add a checklist item to `docs/PIPELINE.md` when it happens.
- **Two sources of truth for schemas:** mitigated by round-trip import/export tests against fixture exports generated by the web app's test suite.
- **App review:** BYO-key AI apps are accepted (precedent exists), but the first submission should include reviewer notes explaining the key model.
- **Maintenance load:** if v1 retention data doesn't justify the second codebase, fall back to the Tauri Mobile roadmap — nothing in this plan blocks it.
