# Prompt Lab for iPhone & iPad — Native Swift App Plan

Status: proposed (ADR recorded — see `docs/DECISIONS.md` [D-011]; scaffold awaits owner greenlight)
Created: 2026-07-26
Updated: 2026-07-28 — retargeted from iPad-only to a **universal iPhone + iPad app** per owner decision. Core architecture is unchanged; the delta is a compact-width (iPhone) navigation model and universal deployment target.
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
| Tauri Mobile shell (current roadmap) | One React codebase; extension/desktop parity for free | WebView UX on iPhone/iPad; weaker multitasking/pencil/keyboard support; app-review risk for WebView-heavy apps |
| Native SwiftUI universal app (this plan) | First-class iOS/iPadOS UX (compact-width flows on iPhone; Split View, Stage Manager, hardware keyboard, sidebar idioms on iPad); Keychain-native key storage; best App Store positioning | Second UI codebase to maintain; feature drift risk against the React app |
| Hybrid: SwiftUI shell + shared JS core | Native chrome with shared enhance/parsing logic via JavaScriptCore | Bridging complexity; still two UI trees |

**Recommendation:** Native SwiftUI app scoped to a focused feature set (below), with
the JSON contracts — not the UI — as the sharing boundary. The React app's provider
payload/response logic is already centralized, and those contracts are portable as data, not code.

### Source-of-truth map (what to port, and from where)

The shared app is **not** in `prompt-lab-web/` — that package is a thin mount over the
extension's `src/`. Most load-bearing, platform-agnostic logic lives in
**`prompt-lab-extension/src/lib/`**, while the enhance contract builder remains at
**`prompt-lab-extension/src/constants.js`**. Port these sources; discard the shell-specific seams.

| Concern | Source (verified 2026-07-28) | Ports to |
|---|---|---|
| Prompt / version / golden schema | `prompt-lab-extension/src/lib/promptSchema.js` | SwiftData `@Model` entities |
| Eval-run schema | `prompt-lab-extension/src/lib/evalSchema.js` | SwiftData `EvalRun` model |
| Provider descriptors | `prompt-lab-extension/src/lib/providerRegistry.js` (Anthropic `defaultModel: claude-sonnet-4-6`) | `ProviderClient` conformances |
| Enhance system prompt + JSON contract | `buildSystemPrompt` in `prompt-lab-extension/src/constants.js` → `{enhanced, variants, notes, assumptions, tags}` | reused verbatim as the contract string |
| Keyboard shortcut map | `prompt-lab-extension/src/lib/navigationRegistry.js` | `.keyboardShortcut` modifiers |
| **Discard (shell-specific):** | `platform.js`, `desktopApi.js`, extension `background.js` | replaced by URLSession + Keychain |

## What the app is (v1 scope)

A workbench mirroring the web app's mental model, adaptive across size classes:

1. **Sidebar** — Library (saved prompts, collections), Pads (scratchpads), Runs.
2. **Editor** — prompt authoring with enhance modes (balanced/claude/chatgpt/image/code/concise/detailed), variables, and lint hints.
3. **Results** — enhanced output, variants, notes/assumptions, diff vs. original, run history.

**Adaptive layout (universal):**
- **iPad (regular width):** the full three-column `NavigationSplitView` (Sidebar → Editor → Results).
- **iPhone (compact width):** the same three columns **collapse to a stacked push flow** — Library/Runs list → Editor (with a Results tab/segment or a push to a Results detail). No side-by-side Editor+Results on iPhone; Results is reached by segment control or navigation push. This is a presentation change only — the `WorkbenchStore` and models are identical across size classes.

v1 explicitly **excludes**: A/B compare, composer chains, billing/Pro gating, telemetry,
and the PII scanner (deferred until parity is worth the port).

## Architecture

- **UI:** SwiftUI, `NavigationSplitView` (three-column on regular width; auto-collapses to a stacked `NavigationStack` flow on compact width). Universal target: **iOS 17+ / iPadOS 17+**.
- **State:** `@Observable` models; one `WorkbenchStore` per window scene to support iPad Split View / Stage Manager multitasking (a single scene on iPhone).
- **Persistence:** SwiftData for library entries, pads, and run records. Schemas mirror the web app's normalized shapes (`promptSchema.js`, `evalSchema.js`) so import/export stays lossless.
- **Interchange:** import/export of the existing library JSON export format is a v1 requirement — it is the bridge between surfaces and removes migration risk.
- **Providers:** a `ProviderClient` protocol with Anthropic first (streaming via URLSession async bytes), then OpenAI/Gemini/OpenRouter. Payload construction ports the shapes in `providerRegistry.js`. Ollama is excluded from v1 (a localhost endpoint does not map to an iOS/iPadOS device).
- **Enhance contract:** reuse the exact JSON contract from `buildSystemPrompt` (`constants.js`) — `{"enhanced","variants","notes","assumptions","tags"}` — so results are interchangeable with the web app and eval records stay comparable.
- **Secrets:** API keys in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Never in UserDefaults; no key sync in v1.
- **Auth/billing:** none in v1. The app is BYO-keys, matching the extension/desktop posture rather than the hosted web app's Clerk+Stripe path.

## Repo layout

New top-level package `prompt-lab-ios/` (universal iPhone + iPad target) beside
`prompt-lab-extension/`, `prompt-lab-desktop/`, and `prompt-lab-web/`:

```
prompt-lab-ios/
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

1. **M0 — Scaffold (1 sprint, gated on owner greenlight):** the ADR is already recorded (`docs/DECISIONS.md` [D-011]); this milestone is the first code — create the Xcode project, SwiftData models, and library JSON import round-trip tests. No app code lands before greenlight.
2. **M1 — Enhance end-to-end (1–2 sprints):** editor + Anthropic streaming enhance + results panel with variants/notes; Keychain key management.
3. **M2 — Library + pads + runs (1 sprint):** saved library CRUD, scratchpads, local run history mirroring `eval_runs` fields (including `enhanceMode` and the `success/error/blocked/canceled` statuses added 2026-07-26).
4. **M3 — Adaptive layout + polish (1–2 sprints):** compact-width (iPhone) navigation — collapse the three columns to a stacked push flow with a Results segment; Dynamic Type and safe-area correctness on iPhone. iPad-specific: hardware keyboard shortcuts (mirror `navigationRegistry.js` mappings), Split View/Stage Manager, drag-and-drop of prompts as text, share-sheet export (share sheet also covers the iPhone export path).
5. **M4 — Beta:** TestFlight, App Store metadata reusing `store-assets/`, privacy nutrition labels (no tracking; keys on device).

## Risks

- **Feature drift:** every enhance-contract change in `constants.js` must be treated as a cross-surface API change; add a checklist item to `docs/PIPELINE.md` when it happens.
- **Two sources of truth for schemas:** mitigated by round-trip import/export tests against fixture exports generated by the web app's test suite.
- **App review:** BYO-key AI apps are accepted (precedent exists), but the first submission should include reviewer notes explaining the key model.
- **Maintenance load:** if v1 retention data doesn't justify the second codebase, fall back to the Tauri Mobile roadmap — nothing in this plan blocks it.
