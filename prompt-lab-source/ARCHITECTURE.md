# Prompt Lab Architecture

## Overview

Prompt Lab is currently delivered through three shells that share one frontend codebase:

- Chrome / Vivaldi extension: MV3 side panel build
- Desktop app: Tauri 2 wrapper
- Hosted web app: Vite build deployed to Vercel with a CORS proxy edge function

The shared React application lives in `prompt-lab-extension/src/`.

## Repo layout

- `prompt-lab-extension/`
  - Primary frontend package
  - Vite build for the extension panel
  - Vitest + RTL tests
  - Playwright extension smoke test
- `prompt-lab-extension/src/`
  - Shared React UI, hooks, utilities, provider logic, storage helpers
- `prompt-lab-extension/extension/`
  - MV3 assets such as `manifest.json`, `background.js`, icons, and options page files
- `prompt-lab-desktop/`
  - Tauri shell that loads `../prompt-lab-extension/src/main.jsx`
  - Desktop packaging config and native bundle settings
- `prompt-lab-web/`
  - Hosted web shell that loads `../prompt-lab-extension/src/main.jsx`
  - Vercel Edge Function CORS proxy at `api/proxy.js`
  - Vite config sets `VITE_WEB_MODE=true` to activate proxy fetch injection
- `.github/workflows/`
  - Extension CI
  - Desktop cross-platform build workflow

## Runtime model

### Shared frontend

The main application UI is written once and reused in both targets.

- `src/App.jsx` is the primary surface
- `src/hooks/` manages editor, library, eval run, and test case state
- `src/lib/` contains utilities, provider modules, platform adapters, and the PII engine

### Extension path

The extension uses MV3 primitives:

- `chrome.storage.local` for provider settings and extension state
- `background.js` as the network boundary for provider API calls
- `options.html` / `options.js` for provider configuration
- `panel.html` as the side panel entry point

### Desktop path

The desktop app uses Tauri plus local browser storage:

- `prompt-lab-desktop/index.html` imports `../prompt-lab-extension/src/main.jsx`
- `src/lib/desktopApi.js` stores provider settings in localStorage under `pl2-provider-settings`
- `src/lib/platform.js` switches behavior between extension and desktop flows
- Desktop settings are exposed through an in-app modal instead of the extension options page

### Web path

The hosted web app runs as a standard Vite SPA deployed to Vercel:

- `prompt-lab-web/index.html` imports `../prompt-lab-extension/src/main.jsx`
- `src/lib/desktopApi.js` detects web mode via `VITE_WEB_MODE` and injects a proxy-aware fetch wrapper
- `src/lib/proxyFetch.js` reroutes provider API requests through `/api/proxy` to bypass CORS
- `prompt-lab-web/api/proxy.js` is a Vercel Edge Function that validates the target domain against an allowlist and forwards the request
- Ollama requests bypass the proxy and go direct to localhost
- API keys are entered by the user and never stored server-side

## Providers

Prompt Lab currently supports:

- Anthropic
- OpenAI
- Google Gemini
- OpenRouter
- Ollama

Provider-specific request behavior is routed through shared provider abstraction modules rather than being inlined in the app surface.

## Persistence

- Prompt library and app state use local browser persistence in the shared app
- Experiment and eval data use the experiment store layer
- Extension provider settings use `chrome.storage.local`
- Desktop provider settings use localStorage

## Safety layers

- Provider traffic is routed through controlled adapters
- PII detection and redaction use the shared `src/lib/piiEngine.js`
- The extension manifest keeps permissions narrow and host access explicit

## Testing

Current automated coverage includes:

- Vitest + React Testing Library for hooks, providers, schemas, storage, and utilities
- Playwright smoke coverage for the extension enhance flow
- CI workflows for extension verification and desktop build packaging
