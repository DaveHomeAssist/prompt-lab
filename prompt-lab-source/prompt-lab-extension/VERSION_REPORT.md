# Prompt Lab Version Report

- Date: 2026-03-13
- Release: `v1.5.0`
- Scope: extension runtime, shared frontend architecture, desktop shell, CI, and packaging

## Release summary

`v1.5.0` is the first release where Prompt Lab is documented and maintained as a shared extension-plus-desktop product instead of only an MV3 extension.

## Technical state

- Shared frontend source lives in `prompt-lab-extension/src/`.
- The Chrome extension packages that source into an MV3 side panel build.
- The Tauri desktop app loads the same `main.jsx` entry through `prompt-lab-desktop/index.html`.
- Supported providers are Anthropic, OpenAI, Gemini, OpenRouter, and Ollama.

## Notable changes in this release

- Added hook-level coverage for `useTestCases` and `useEvalRuns`.
- Consolidated PII detection and redaction logic into `src/lib/piiEngine.js`.
- Introduced provider abstraction modules for background-side provider dispatch.
- Added a Playwright smoke test for the extension enhance flow.
- Added extension CI and desktop cross-platform CI workflows.
- Added a desktop in-app settings modal with localStorage-backed provider settings.
- Cleaned up desktop packaging inputs for macOS bundle generation.

## Verification snapshot

- `npm test` in `prompt-lab-extension/`: pass, 49 tests
- `npm run build` in `prompt-lab-extension/`: pass
- `npm run build` in `prompt-lab-desktop/`: pass
- `npx tauri build --bundles app` in `prompt-lab-desktop/`: pass on macOS
- `npx tauri build --bundles dmg` in `prompt-lab-desktop/`: pass on macOS

## CI snapshot

- Extension CI: `.github/workflows/extension-ci.yml`
- Desktop build matrix: `.github/workflows/desktop-build.yml`

## Companion docs

- `README.md`
- `VERSION_HISTORY.md`
- `CHANGELOG_PLAIN_ENGLISH.md`
- `CWS_SUBMISSION_CHECKLIST.md`
