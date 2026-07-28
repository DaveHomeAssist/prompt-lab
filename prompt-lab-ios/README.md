# Prompt Lab for iPad

Native SwiftUI prototype of the Prompt Lab workbench for iPadOS 17 and later.

This is a prototype, not a replacement for the shipped React surfaces. Native SwiftUI conflicts with the current Tauri Mobile roadmap in `prompt-lab-source/MOBILE_DEPLOYMENT_ROADMAP.md`. The repository's `prompt-lab-source/docs/DECISIONS.md` does not currently contain the brief's referenced D-011 entry, so an ADR must be recorded before this direction moves beyond prototype status.

## Build and test

Requirements:

- Xcode with an iOS 17 or later simulator runtime
- An iPad simulator named `iPad Pro (11-inch)`

```sh
xcodebuild build \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPad Pro (11-inch)'

xcodebuild test \
  -project prompt-lab-ios/PromptLab.xcodeproj \
  -scheme PromptLab \
  -destination 'platform=iOS Simulator,name=iPad Pro (11-inch)'
```

The app targets iPad only and uses landscape orientation so Sidebar, Editor, and Results remain visible together.

## Add an Anthropic key

1. Launch the app.
2. Tap the key button in the Editor header.
3. Paste an Anthropic API key and tap **Save**.
4. Enter a prompt and tap **Enhance** or press Command-Return.

The key is stored as a generic-password item using `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`. It is not written to UserDefaults, synced through iCloud Keychain, or logged.

## What works

- Three-column SwiftUI workbench using `NavigationSplitView`
- Scene-local observable editor and request state
- SwiftData persistence for library entries, scratchpads, and web-shaped run records
- Anthropic Messages API payloads and streamed SSE text deltas
- Strict enhance response contract: `enhanced`, two `variants`, `notes`, `assumptions`, and `tags`
- Cancellation without saving a partial run
- Run history that survives app and model-container relaunch
- Keychain save, update, retrieve, and delete
- Web-library JSON import and export from the Sidebar toolbar
- Byte-identical re-export of an untouched web library, including unknown metadata and empty collections
- Empty, in-flight, completed, API-error, cancelled, and no-key states

The checked-in QA suite contains 11 tests. The recorded Anthropic provider is available only in Debug builds for credential-free network-boundary proof:

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

- [Three-column scaffold](QA/phase2-three-column.png)
- [Recorded streamed enhance](QA/phase3-recorded-enhance.png)
- [Run visible after relaunch](QA/phase3-run-after-relaunch.png)

No Anthropic API key was available during prototype QA, so the real network request was not exercised. The shipping Anthropic path was built and compiled; end-to-end behavior was proven with the allowed recorded response at the provider boundary.
