# Prompt Lab for iPhone & iPad — Native Swift App Plan

Status: M0–M3 implemented; M4 release preparation blocked on distribution inputs
Created: 2026-07-26
Updated: 2026-08-17 — native workbench closure implemented for Library, Pads, Runs, Results, compact navigation, shared-contract parity, accessibility, and iPhone/iPad CI.
Owner: Dave Robertson

## Why this document exists

The July 26 work list called for a **native Swift iPad Prompt Lab app**, which conflicted with the earlier Tauri Mobile direction in `MOBILE_DEPLOYMENT_ROADMAP.md`. ADR D-011 resolved that conflict in favor of a universal native SwiftUI app with JSON contracts—not shared UI—as the compatibility boundary. This plan now tracks the implemented scope and the remaining distribution gate.

## Decision framing

| Option | Pros | Cons |
|---|---|---|
| Tauri Mobile shell (earlier roadmap) | One React codebase; extension/desktop parity for free | WebView UX on iPhone/iPad; weaker multitasking/pencil/keyboard support; app-review risk for WebView-heavy apps |
| Native SwiftUI universal app (this plan) | First-class iOS/iPadOS UX (compact-width flows on iPhone; Split View, Stage Manager, hardware keyboard, sidebar idioms on iPad); Keychain-native key storage; best App Store positioning | Second UI codebase to maintain; feature drift risk against the React app |
| Hybrid: SwiftUI shell + shared JS core | Native chrome with shared enhance/parsing logic via JavaScriptCore | Bridging complexity; still two UI trees |

**Decision:** Native SwiftUI app scoped to a focused feature set (below), with
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

- **UI:** SwiftUI, explicit three-column `NavigationSplitView` at regular width and a routed `NavigationStack` at compact width. Universal target: **iOS 17+ / iPadOS 17+**.
- **State:** `@Observable` models; one `WorkbenchStore` per window scene to support iPad Split View / Stage Manager multitasking (a single scene on iPhone).
- **Persistence:** SwiftData for library entries, pads, and run records. Schemas mirror the web app's normalized shapes (`promptSchema.js`, `evalSchema.js`) so import/export stays lossless.
- **Interchange:** import/export of the existing library JSON export format is a v1 requirement — it is the bridge between surfaces and removes migration risk.
- **Providers:** a `ProviderClient` protocol with Anthropic first (streaming via URLSession async bytes), then OpenAI/Gemini/OpenRouter. Payload construction ports the shapes in `providerRegistry.js`. Ollama is excluded from v1 (a localhost endpoint does not map to an iOS/iPadOS device).
- **Enhance contract:** reuse the exact JSON contract from `buildSystemPrompt` (`constants.js`) — `{"enhanced","variants","notes","assumptions","tags"}` — so results are interchangeable with the web app and eval records stay comparable.
- **Secrets:** API keys in Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`). Never in UserDefaults; no key sync in v1.
- **Auth/billing:** none in v1. The app is BYO-keys, matching the extension/desktop posture rather than the hosted web app's Clerk+Stripe path.

## Repo layout

Top-level package `prompt-lab-ios/` (universal iPhone + iPad target) beside
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

CI: a `macos-15` GitHub Actions matrix builds and runs unit plus UI smoke suites on
both iPhone and iPad simulator families. Native and extension jobs both watch the
shared contract fixture and their canonical Swift/JavaScript inputs.

## Milestones

1. **M0 — Scaffold — complete:** Xcode project, SwiftData entities, lossless library round-trip fixture, and iPhone/iPad build matrix are present.
2. **M1 — Enhance end-to-end — complete:** Anthropic BYO-key streaming, Keychain management, resilient response parsing, progress/cancel/error states, durable result cards, and full-response run persistence are implemented. A user-observed physical M1 iPad run completed successfully on August 16, 2026; automated paid-provider execution remains opt-in only.
3. **M2 — Library + pads + runs — complete:** Library create/open/rename/delete, scratchpad create/autosave/delete, full run history/detail with input/output reuse, canonical statuses, historical `failed` compatibility, transactional import preview, and an on-disk V1→V2 SwiftData migration test are implemented.
4. **M3 — Adaptive layout + polish — functionally complete, device QA ongoing:** compact launches in Editor with an explicit Workspace route and Results push; regular iPad retains rebalanced three-column operation. Dynamic Type, wrapping actions/tags, accessibility focus, Command-S/Command-Return/Escape, share actions, and iPhone/iPad UI smoke coverage are present. Final manual checks remain for narrow Split View/Stage Manager, VoiceOver reading order, and hardware-keyboard behavior on current physical hardware. Drag-and-drop is deferred because it is not required for the focused workbench closure.
5. **M4 — Beta — blocked:** TestFlight/App Store work requires an approved production bundle identifier, final app icons/store assets, Apple distribution access, privacy metadata, and explicit release criteria. No release upload is authorized by this plan update.

## Risks

- **Feature drift:** every enhance-contract change is a cross-surface API change. `contracts/promptlab-enhance-contract-v1.json`, Vitest, XCTest, and the checklist in `docs/PIPELINE.md` now enforce that boundary.
- **Two sources of truth for schemas:** mitigated by round-trip import/export tests against fixture exports generated by the web app's test suite.
- **App review:** BYO-key AI apps are accepted (precedent exists), but the first submission should include reviewer notes explaining the key model.
- **Maintenance load:** if v1 retention data doesn't justify the second codebase, fall back to the Tauri Mobile roadmap — nothing in this plan blocks it.
