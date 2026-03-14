# Prompt Lab

Chrome extension (MV3 side panel) for prompt engineering with A/B testing, eval runs, PII scanning, and five provider backends.

## Stack

- React 18
- Vite 8
- Tailwind CSS
- Vitest + React Testing Library
- Playwright smoke coverage

## Providers

- Anthropic
- OpenAI
- Google Gemini
- OpenRouter
- Ollama

## Getting started

```bash
nvm use
npm install
npm test
npm run build
```

Load the unpacked extension from `dist/` in `chrome://extensions` or `vivaldi://extensions`.

## Architecture

- `src/` is the shared frontend used by both the extension and the Tauri desktop shell.
- `src/hooks/` owns editor, library, eval run, A/B test, and test case state.
- `src/lib/` contains shared utilities, provider abstractions, storage helpers, platform adapters, and the unified PII engine.
- `src/__tests__/` contains Vitest + RTL coverage for hooks, providers, storage, schemas, utilities, and PII flows.
- `e2e/` contains the Playwright smoke test for the extension enhance flow.
- `extension/` contains MV3 assets copied into `dist/` during assembly.

## Commands

```bash
npm run dev
npm run build
npm run build:cws
npm test
npm run test:watch
npm run test:e2e
```

## CI

- `.github/workflows/extension-ci.yml` runs extension tests and builds on push and pull request.
- `.github/workflows/desktop-build.yml` also depends on this shared source because the desktop app imports `../prompt-lab-extension/src/main.jsx`.
