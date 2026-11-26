# Prompt Lab for iPhone & iPad

Native SwiftUI Prompt Lab workbench for iOS and iPadOS 17 and later.

Bundle identifier: `com.davehomeassist.promptlab`. Marketing version and build number are both `1.9.0`, the shared `major.minor.patch` product version in `prompt-lab-source/package.json`.

This remains a focused native v1 rather than a replacement for every React feature. It implements the universal native direction recorded in `prompt-lab-source/docs/DECISIONS.md` [D-011], with shared JSON contracts for enhancement and Library transfer as the compatibility boundary.

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

The key is stored as a generic-password Keychain item with service `com.davehomeassist.promptlab` and account `anthropic-api-key`, using `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. The app looks the key up by that service and account. The key is not written to UserDefaults, synced through iCloud Keychain, or logged.

## Sensitive data before send

Enhance scans the draft with the shared patterns in `prompt-lab-source/shared/pii-patterns.json` before any network request. If it finds API keys, tokens, private keys, emails, phone numbers, card numbers, or the other built-in detectors, a sheet lists each item and the placeholder that would replace it. **Redact & Send** transmits the bracketed text (`[API_KEY]`, `[EMAIL]`, and so on). **Send Anyway** transmits the draft unchanged. **Cancel** sends nothing. The editor keeps what you typed. The steps still left for a TestFlight upload are in [TESTFLIGHT.md](TESTFLIGHT.md).

## What works

- Adaptive SwiftUI workbench using three-column `NavigationSplitView` at regular width and explicit `NavigationStack` routes at compact width
- Scene-local observable editor and request state
- Versioned SwiftData persistence for saved prompts, scratchpads, and web-shaped run records, with a tested lightweight migration from the shipped prototype schema
- Saved-prompt create/open/rename/delete, scratchpad create/autosave/delete, and complete run-history/detail/reuse flows
- Anthropic Messages API payloads and streamed SSE text deltas
- Strict enhance response contract: `enhanced`, two `variants`, `notes`, `assumptions`, and `tags`
- Durable result cards with Use, Copy, Save, and Share actions
- Successful runs persist the full enhance response; canceled and failed attempts retain partial output and error notes
- Canonical run statuses `success`, `error`, `blocked`, and `canceled`, with legacy `failed` records read as `error`
- Run history that survives app and model-container relaunch and can restore either input or output for another pass
- Keychain save, update, retrieve, and delete
- Web-library JSON choose → validate/preview → confirm → transactional replace flow, plus export from Workspace
- Byte-identical re-export of an untouched web library; edited exports retain first-class variants, notes, tags, millisecond timestamps, unknown metadata, and empty collections
- Stable native content versions preserve the original source of imported follow-up prompts after a parent edit
- Command-S save, Command-Return enhance, and Escape cancellation/close behavior where applicable
- Dynamic Type-native typography, wrapping result actions/tags, accessibility focus on completed Results, and 44-point primary controls
- Empty, in-flight, completed, API-error, cancelled, and no-key states

The checked-in QA suite contains credential-free unit tests, one optional live Anthropic smoke test, and five credential-free UI tests. The UI suite runs on both iPhone and iPad in CI and covers compact launch/navigation (including a forced compact-width route on iPad), recorded completion, Results actions, Library reopen, run detail/reuse, and an XCTest accessibility audit. The recorded Anthropic provider is available only in Debug builds for credential-free network-boundary proof:

```sh
xcrun simctl launch booted com.davehomeassist.promptlab \
  -recordedAnthropic -runRecordedDemo
```

## Deliberately absent

- A/B compare
- Composer chains
- Billing or Pro gating
- Telemetry
- Ollama
- OpenAI, Gemini, OpenRouter, or any provider other than Anthropic

## Verification evidence

- A physical M1 iPad install completed a real BYO-key Anthropic enhance on August 16, 2026. That user-observed result proves the shipping key/provider path on hardware; the API key was not shared with or exercised by automated tests.
- Historical prototype captures remain available as [three-column scaffold](QA/phase2-three-column.png), [recorded streamed enhance](QA/phase3-recorded-enhance.png), and [run visible after relaunch](QA/phase3-run-after-relaunch.png). They predate the current workbench UI and are retained as baseline evidence only.
- `contracts/promptlab-library-v2.json` exercises ordered identities, timestamps, provenance, duplicate/corrupt input and backup restoration. CI exports actual native edits, reopens the SwiftData store, and passes native-created and edited artifacts through the production JavaScript importer. Cross-version SwiftData migration remains a separate unit gate.
- `contracts/promptlab-enhance-contract-v1.json` is enforced by both Vitest and XCTest so provider defaults, modes, tags, response fields, statuses, and title generation cannot silently drift.

Automated verification never transmits a paid provider request unless `ANTHROPIC_API_KEY` is explicitly supplied to the optional live smoke test. CI uses the recorded provider for deterministic end-to-end UI proof.
