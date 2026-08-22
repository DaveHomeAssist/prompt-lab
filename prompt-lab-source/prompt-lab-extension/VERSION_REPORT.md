# Prompt Lab Version Report

- Date: 2026-08-19
- Shared package/source version: `1.7.1` (unreleased)
- Latest source tag: `v1.7.0`
- Latest GitHub Release: `v1.5.0-desktop-preview` (prerelease)
- Native app version: `0.1.0` / build `1` (unreleased)
- Scope: shared React surfaces, React mobile prototype, native SwiftUI app, CI, and packaging

## Release state

The shared package manifests and desktop bundle metadata are aligned on `1.7.1`, but no `v1.7.1` tag or GitHub Release exists. Do not describe `1.7.1` as released until source tagging and the intended distribution artifacts are explicitly promoted. The native app has its own `0.1.0` version line and has not been uploaded to TestFlight or the App Store.

## Technical state

- Shared frontend source lives in `prompt-lab-extension/src/`.
- The Chrome extension packages that source into an MV3 side panel build.
- The hosted web deployment serves a landing page at `promptlab.tools/` and the shared app at `https://promptlab.tools/app/`.
- `prompt-lab-web/mobile/` builds a separate React mobile prototype at `https://promptlab.tools/mobile/`.
- The Tauri desktop app loads the same `main.jsx` entry through `prompt-lab-desktop/index.html`.
- `prompt-lab-ios/` is a focused native SwiftUI app that shares `contracts/promptlab-enhance-contract-v1.json`, not React UI code.
- Extension and desktop support Anthropic, OpenAI, Gemini, OpenRouter, and Ollama.
- Hosted web currently defaults to Anthropic and can use a shared hosted key or a user-supplied Anthropic key.

## Current source-line highlights

- Added hook-level coverage for `useTestCases` and `useEvalRuns`.
- Consolidated PII detection and redaction logic into `src/lib/piiEngine.js`.
- Introduced provider abstraction modules for background-side provider dispatch.
- Added a Playwright smoke test for the extension enhance flow.
- Added extension CI and desktop cross-platform CI workflows.
- Added a desktop in-app settings modal with localStorage-backed provider settings.
- Cleaned up desktop packaging inputs for macOS bundle generation.

## Verification entry points

- `npm test` in `prompt-lab-extension/`: shared React and extension verification under Node 22
- `npm run build` in `prompt-lab-extension/`: extension build target
- `npm run build` in `prompt-lab-web/`: landing, hosted app, and React mobile build target
- `npm run build` in `prompt-lab-desktop/`: desktop frontend validation target
- `xcodebuild test` with the `PromptLab` scheme: native unit/UI verification

## CI snapshot

- Extension CI: `.github/workflows/extension-ci.yml`
- Desktop build matrix: `.github/workflows/desktop-build.yml`
- Hosted web gates: `.github/workflows/landing-ci.yml`
- Native iPhone/iPad matrix: `.github/workflows/ipad-prototype.yml`

## Companion docs

- `README.md`
- `VERSION_HISTORY.md`
- `CHANGELOG_PLAIN_ENGLISH.md`
- `CWS_SUBMISSION_CHECKLIST.md`
