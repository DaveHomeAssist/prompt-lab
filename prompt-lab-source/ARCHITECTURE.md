# Prompt Lab Architecture

## Overview

Prompt Lab is currently delivered through three runtime shells that share one frontend codebase, plus a public landing page:

- Chrome / Vivaldi extension: MV3 side panel build
- Desktop app: Tauri 2 wrapper
- Hosted web app: static Vite build served at `https://promptlab.tools/app/` with a Vercel CORS proxy edge function backing provider requests
- Public landing page: static marketing entry at `https://promptlab.tools/`

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
  - Public web deploy package
  - `index.html` is the landing page served at `/`
  - `app/index.html` is the hosted app shell served at `/app/`
  - `src/main-web.jsx` wraps the shared app with hosted-web-only providers such as Clerk and entitlements
  - `public/` holds static assets copied into the deployed site root
  - Vite config sets `VITE_WEB_MODE=true` to activate proxy fetch injection in the app shell
- `api/`
  - Vercel Edge Function CORS proxy at `api/proxy.js`
- `vercel.json`
  - Root Vercel build config for the hosted web deployment
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

The hosted web deployment is split into a landing route and an app route:

- `prompt-lab-web/index.html` is the public landing page for `https://promptlab.tools/`
- `prompt-lab-web/app/index.html` imports `../src/main-web.jsx` and is published to `https://promptlab.tools/app/`
- `prompt-lab-web/public/` provides shared static assets such as fonts and social images
- `src/lib/desktopApi.js` detects web mode via `VITE_WEB_MODE` and injects a proxy-aware fetch wrapper
- `src/lib/proxyFetch.js` reroutes provider API requests through the Vercel proxy endpoint at `/api/proxy`
- `api/proxy.js` is a Vercel Edge Function that validates the target domain against an allowlist and forwards the request
- `vercel.json` rewrites `/app` and `/app/(.*)` to `/app/index.html`
- Ollama requests bypass the proxy and go direct to localhost
- hosted auth shell is wired through `prompt-lab-web/src/main-web.jsx`, `prompt-lab-web/src/AuthGate.jsx`, and `prompt-lab-web/src/useCurrentUser.js`
- current hosted entitlements client layer is wired through `prompt-lab-web/src/useEntitlements.js`

## Platform runtime model

| Platform | API path | Public backend? |
|----------|----------|-----------------|
| Extension | Service worker → provider | No |
| Desktop | Native fetch → provider | No |
| Web (hosted) | CORS proxy → provider | Yes (`api/proxy.js`) |
| Server (planned) | Server process → provider | No (self-hosted) |

The extension and desktop shells call provider APIs directly from the client with
no intermediary. The hosted web app routes through a Vercel Edge Function proxy to
bypass browser CORS restrictions — this is the only surface with a public backend
dependency. A planned "Prompt Lab Server" mode would provide browser access through
a self-hosted process, preserving the zero-public-backend property.

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

## Authentication (hosted web only)

**Decision: Clerk** (`@clerk/clerk-react`)

Auth applies only to the hosted web surface at `promptlab.tools/app/`. Extension and desktop shells remain unauthenticated and fully local.

### Rationale

- Clerk provides prebuilt React components (`<SignIn />`, `<SignUp />`, `<UserButton />`) compatible with Vite builds, minimizing custom UI work.
- Prompts stay in localStorage — auth gates billing entitlements, not data access. This avoids a full-stack migration to a server database.
- Clerk sessions are cookie-based and survive refresh and cross-device use without custom token management.
- Stripe integration stays independent: webhook → Vercel KV keyed by Clerk `userId`. Clerk handles identity, Stripe handles billing, Vercel KV stores the mapping.
- No impact on the shared-core architecture — Clerk is wrapped at the web shell level only (`prompt-lab-web/app/index.html`).

### Auth-related API routes

Current implementation state:

- hosted-web auth shell is implemented
- Stripe scaffold and entitlement endpoints are present under `api/`
- the hosted billing path still needs full end-to-end verification and production env validation

| Route | Purpose |
|-------|---------|
| `api/create-checkout-session.js` | Creates Stripe Checkout session for authenticated user |
| `api/create-portal-session.js` | Creates Stripe Customer Portal session |
| `api/webhook.js` | Handles Stripe webhook events, writes entitlements to Vercel KV |
| `api/entitlements.js` | Returns feature map for authenticated user from Vercel KV |

### Client hooks

| Hook | Purpose |
|------|---------|
| `useCurrentUser()` | Thin wrapper around Clerk's `useUser()`, returns an owned user shape for hosted web auth |
| `useEntitlements()` | Calls `/api/entitlements`, caches in React context, exposes `can(featureKey)` |

### Entitlement keys (test mode)

`unlimited_library`, `advanced_compare`, `version_history`, `import_export`, `advanced_variables`

## Safety layers

- Provider traffic is routed through controlled adapters
- PII detection and redaction use the shared `src/lib/piiEngine.js`
- The extension manifest keeps permissions narrow and host access explicit

## Testing

Current automated coverage includes:

- Vitest + React Testing Library for hooks, providers, schemas, storage, and utilities
- Playwright smoke coverage for the extension enhance flow
- CI workflows for extension verification and desktop build packaging
