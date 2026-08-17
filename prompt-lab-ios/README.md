# Prompt Lab for iPhone & iPad

Native SwiftUI Prompt Lab workbench for iOS and iPadOS 17 and later.

This remains a focused native v1 rather than a replacement for every React feature. It implements the universal native direction recorded in `prompt-lab-source/docs/DECISIONS.md` [D-011], with `contracts/promptlab-enhance-contract-v1.json`—not shared UI code—as the compatibility boundary.

## Build and test

Requirements:

- Xcode with an iOS 17 or later simulator runtime
- An available iPhone or iPad simulator

```sh
xcodebuild build \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPad Pro (11-inch)'

xcodebuild test \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPad Pro (11-inch)'

# Also verify the compact-width target with any installed iPhone simulator.
xcodebuild build \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

The app targets both iPhone and iPad. Regular-width iPads keep a rebalanced three-column `NavigationSplitView`. Compact-width launches directly into the Editor, exposes an explicit Workspace route for Library/Pads/Runs, and pushes completed work to Results. The same compact routing is used in narrow iPad Split View and Stage Manager windows.

## Add an Anthropic key

1. Launch the app.
2. Tap the key button in the Editor header.
3. Paste an Anthropic API key and tap **Save**.
4. Enter a prompt and tap **Enhance** or press Command-Return.

The key is stored as a generic-password item using `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. It is not written to UserDefaults, synced through iCloud Keychain, or logged.

## What works

- Adaptive SwiftUI workbench using three-column `NavigationSplitView` at regular width and explicit `NavigationStack` routes at compact width
- Scene-local observable editor and request state
- SwiftData persistence for saved prompts, scratchpads, and web-shaped run records
- Saved-prompt create/open/rename/delete, scratchpad create/autosave/delete, and complete run-history/detail/reuse flows
- Anthropic Messages API payloads and streamed SSE text deltas
- Strict enhance response contract: `enhanced`, two `variants`, `notes`, `assumptions`, and `tags`
- Durable result cards with Use, Copy, Save, and Share actions
- Successful runs persist the full enhance response; canceled and failed attempts retain partial output and error notes
- Canonical run statuses `success`, `error`, `blocked`, and `canceled`, with legacy `failed` records read as `error`
- Run history that survives app and model-container relaunch and can restore input for another pass
- Keychain save, update, retrieve, and delete
- Web-library JSON choose → validate/preview → confirm → transactional replace flow, plus export from Workspace
- Byte-identical re-export of an untouched web library; edited exports retain first-class variants, notes, tags, unknown metadata, and empty collections
- Command-S save, Command-Return enhance, and Escape cancellation/close behavior where applicable
- Dynamic Type-native typography, wrapping result actions/tags, accessibility focus on completed Results, and 44-point primary controls
- Empty, in-flight, completed, API-error, cancelled, and no-key states

The checked-in QA suite contains 23 tests: 17 credential-free unit tests, one optional live Anthropic smoke test, and five credential-free UI tests. The UI suite runs on both iPhone and iPad in CI and covers compact launch/navigation (including a forced compact-width route on iPad), recorded completion, Results actions, Library reopen, run detail/reuse, and an XCTest accessibility audit. The recorded Anthropic provider is available only in Debug builds for credential-free network-boundary proof:

```sh
xcrun simctl launch booted com.davehomeassist.promptlab.prototype \
  -recordedAnthropic -runRecordedDemo
```

## Deliberately absent

- A/B compare
- Composer chains
- Billing or Pro gating
- Telemetry
- PII scanning
- Ollama
- OpenAI, Gemini, OpenRouter, or any provider other than Anthropic

## Verification evidence

- A physical M1 iPad install completed a real BYO-key Anthropic enhance on August 16, 2026. That user-observed result proves the shipping key/provider path on hardware; the API key was not shared with or exercised by automated tests.
- Historical prototype captures remain available as [three-column scaffold](QA/phase2-three-column.png), [recorded streamed enhance](QA/phase3-recorded-enhance.png), and [run visible after relaunch](QA/phase3-run-after-relaunch.png). They predate the current workbench UI and are retained as baseline evidence only.
- `contracts/promptlab-enhance-contract-v1.json` is enforced by both Vitest and XCTest so provider defaults, modes, tags, response fields, statuses, and title generation cannot silently drift.

Automated verification never transmits a paid provider request unless `ANTHROPIC_API_KEY` is explicitly supplied to the optional live smoke test. CI uses the recorded provider for deterministic end-to-end UI proof.
