# Prompt Lab Version Report

- Date: 2026-03-17
- Release: `v1.7.0`
- Scope: extension runtime, shared frontend architecture, hosted web shell, desktop shell, CI, and packaging

## Release summary

`v1.7.0` is the current maintained Prompt Lab release across the extension, hosted web shell, and desktop shell.

## Technical state

- Shared frontend source lives in `prompt-lab-extension/src/`.
- The Chrome extension packages that source into an MV3 side panel build.
- The hosted web deployment serves a landing page at `promptlab.tools/` and the shared app at `https://promptlab.tools/app/`.
- The Tauri desktop app loads the same `main.jsx` entry through `prompt-lab-desktop/index.html`.
- Extension and desktop support Anthropic, OpenAI, Gemini, OpenRouter, and Ollama.
- Hosted web currently defaults to Anthropic and can use a shared hosted key or a user-supplied Anthropic key.

## Notable changes in this release

- Added hook-level coverage for `useTestCases` and `useEvalRuns`.
- Consolidated PII detection and redaction logic into `src/lib/piiEngine.js`.
- Introduced provider abstraction modules for background-side provider dispatch.
- Added a Playwright smoke test for the extension enhance flow.
- Added extension CI and desktop cross-platform CI workflows.
- Added a desktop in-app settings modal with localStorage-backed provider settings.
- Cleaned up desktop packaging inputs for macOS bundle generation.

## Verification snapshot

- `npm test` in `prompt-lab-extension/`: run with Node 22 using the Vitest `threads` pool
- `npm run build` in `prompt-lab-extension/`: current release target
- `npm run build` in `prompt-lab-web/`: current release target
- `npm run build` in `prompt-lab-desktop/`: shared frontend validation target

## CI snapshot

- Extension CI: `.github/workflows/extension-ci.yml`
- Desktop build matrix: `.github/workflows/desktop-build.yml`

## Companion docs

- `README.md`
- `VERSION_HISTORY.md`
- `CHANGELOG_PLAIN_ENGLISH.md`
- `CWS_SUBMISSION_CHECKLIST.md`
