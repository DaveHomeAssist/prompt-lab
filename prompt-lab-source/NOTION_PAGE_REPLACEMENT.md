# Prompt Lab — Canonical Product Definition

> This is the replacement text for the Notion project page.
> Copy into Notion, then move old content to an "Archive / Historical Notes" child page.

---

## What Prompt Lab Is

Prompt Lab is a prompt engineering workbench for iterating, testing, and managing AI prompts across multiple providers. It ships as a Chrome extension and a desktop app sharing a single React frontend, with a zero-public-backend architecture.

**Platform status:**

| Platform | Status | Backend |
|----------|--------|---------|
| Chrome Extension | Production | None — service worker calls providers directly |
| Desktop (Tauri) | Developer Preview | None — native fetch calls providers directly |
| Hosted web app | Live (demo/eval) | CORS proxy at `/api/proxy` |
| Prompt Lab Server | Planned | Self-hosted — no public backend |
| Mobile apps | Future | TBD |

**Live surfaces:**

| Surface | URL / Location |
|---------|---------------|
| Landing page | https://promptlab.tools/ |
| Web app (demo) | https://promptlab.tools/app/ |
| Chrome extension | Chrome Web Store (submission pending) |
| Desktop app | Local build (macOS verified) |

Prompt Lab currently operates with a zero-public-backend architecture. Provider APIs are called directly from the client environment. The hosted web app is the only surface that routes through a public CORS proxy and is positioned as a convenience/demo surface, not the primary product.

**Current version:** 1.5.0

---

## Core Capabilities

- **Prompt enhancement** — structured improve/rewrite workflow with JSON response parsing
- **A/B testing** — side-by-side comparison of prompt variants across providers
- **Prompt library** — save, tag, search, organize into collections, import/export as JSON
- **Prompt versioning** — automatic version snapshots on save, timeline with restore
- **Composer** — modular block-based prompt assembly with drag-and-drop
- **Eval history** — tracked enhancement runs with provider, model, latency, and verdict
- **Test cases** — define expected traits/exclusions per prompt, run against any provider
- **Prompt linting** — real-time quality scoring (role, task, format, constraints, context)
- **PII scanning** — pre-send detection with redact-and-send or send-anyway options
- **Template variables** — `{{placeholder}}` extraction with ghost auto-fill for date, time, clipboard
- **Golden response benchmark** — pin a known-good output, compare future iterations with word diff and similarity score

---

## Provider Support

Five providers, each with shell-specific network boundaries:

| Provider | Extension | Web | Desktop |
|----------|-----------|-----|---------|
| Anthropic | background worker → API | /api/proxy → API | direct fetch → API |
| OpenAI | background worker → API | /api/proxy → API | direct fetch → API |
| Google Gemini | background worker → API | /api/proxy → API | direct fetch → API |
| OpenRouter | background worker → API | /api/proxy → API | direct fetch → API |
| Ollama | background worker → localhost | direct to localhost | direct to localhost |

- **Extension:** API calls route through the MV3 background service worker. Provider settings stored in `chrome.storage.local`.
- **Web:** API calls route through a Vercel Edge Function CORS proxy at `/api/proxy`. The proxy validates target domains against an allowlist (Anthropic, OpenAI, Gemini, OpenRouter). Ollama bypasses the proxy and connects directly to localhost. Provider settings stored in browser `localStorage`.
- **Desktop:** API calls go directly from the Tauri webview. Provider settings stored in browser `localStorage` under key `pl2-provider-settings`.

API keys are entered by the user, stored locally per shell, and never sent to any server other than the selected provider's API endpoint. There is no telemetry, no analytics, and no server-side key storage.

---

## Architecture

### Shared Frontend

All three shells render the same React application from `prompt-lab-extension/src/`. Platform-specific behavior (API routing, settings storage, session persistence) is abstracted through `src/lib/platform.js`, which switches implementations based on runtime detection.

### Repo Layout

```
prompt-lab-source/                  ← canonical working tree
├── prompt-lab-extension/           ← primary frontend package
│   ├── src/                        ← shared React UI, hooks, utilities, providers
│   │   ├── App.jsx                 ← main application component
│   │   ├── hooks/                  ← usePromptEditor, usePromptLibrary, useABTest, etc.
│   │   ├── lib/                    ← platform.js, providers.js, providerRegistry.js,
│   │   │                              promptSchema.js, storage.js, piiEngine.js
│   │   ├── promptUtils.js          ← variable extraction, word diff, similarity, share encoding
│   │   └── __tests__/              ← Vitest + RTL test suite (49 tests)
│   ├── public/                     ← static extension assets (manifest, background, icons, fonts)
│   └── dist/                       ← Vite build output for extension
├── prompt-lab-web/                 ← hosted web deploy package
│   ├── index.html                  ← landing page at /
│   ├── app/index.html              ← shared React app at /app/
│   ├── vite.config.js              ← multi-page Vite config (VITE_WEB_MODE=true)
│   └── public/                     ← static web assets
├── prompt-lab-desktop/             ← Tauri 2 shell
│   └── src-tauri/                  ← Rust config, native bundle settings
├── api/
│   └── proxy.js                    ← Vercel Edge Function CORS proxy
├── vercel.json                     ← Vercel build/deploy config
├── ARCHITECTURE.md                 ← technical architecture reference
├── ROADMAP.md                      ← shipped state and near-term priorities
├── FEATURE_SPECS.md                ← v1.6 feature specifications
└── .github/workflows/              ← Extension CI, Desktop build CI
```

### Storage Model

| Data | Mechanism | Shared Across Shells? |
|------|-----------|----------------------|
| Prompt library | `localStorage` (`pl2-library`) | No — per browser/app instance |
| Collections | `localStorage` (`pl2-collections`) | No |
| Eval runs | IndexedDB (`prompt_lab_local`) with localStorage fallback | No |
| Experiment history | IndexedDB with localStorage fallback | No |
| Test cases | IndexedDB with localStorage fallback | No |
| Session state | Extension: `chrome.storage.session` / Desktop+Web: `localStorage` | No |
| Provider settings | Extension: `chrome.storage.local` / Desktop+Web: `localStorage` | No |

All storage keys are prefixed `pl2-`. Data is local-first with no server sync.

---

## Deploy Model

### Web (Vercel)

- **Build:** `cd prompt-lab-web && npm install && npm run build`
- **Output:** `prompt-lab-web/dist/` (multi-page: `index.html` + `app/index.html`)
- **Deploy:** `vercel --prod` from `prompt-lab-source/` root
- **Domain:** `promptlab.tools` (A record → 76.76.21.21, CNAME www → cname.vercel-dns.com)
- **Rewrites:** `/app/*` → `/app/index.html` (SPA routing), `/api/*` → edge functions
- **CORS:** `Access-Control-Allow-Origin: *` on `/api/*` routes

### Extension

- **Build:** `cd prompt-lab-extension && npm run build` → `dist/`
- **Load:** chrome://extensions → Load unpacked → select `dist/`
- **CWS build:** `npm run build:cws` (unminified for review)
- **Permissions:** `storage`, `sidePanel` + host permissions for provider API domains and localhost

### Desktop

- **Prerequisites:** Node.js 22+, Rust toolchain, platform-specific Tauri dependencies
- **Dev:** `cd prompt-lab-desktop && npm install && cargo tauri dev`
- **Build:** `cargo tauri build`

---

## Near-Term Priorities

These are active work items, not shipped commitments:

1. Chrome Web Store submission — store listing copy, screenshots, promo assets, final permission review
2. Desktop release packaging — distribution strategy beyond local macOS validation
3. Documentation alignment — keep extension, desktop, and web docs in sync as architecture evolves
4. Landing page and `/app/` route maintenance — keep aligned with current product state

---

## Key Documentation

| Document | Location | Purpose |
|----------|----------|---------|
| ARCHITECTURE.md | repo root | Technical architecture, runtime model, repo layout |
| ROADMAP.md | repo root | Shipped state, near-term priorities, guardrails |
| FEATURE_SPECS.md | repo root | v1.6 feature specifications (Ghost Variables, Golden Response, etc.) |
| VERSION_HISTORY.md | prompt-lab-extension/ | Detailed release notes for all versions |
| CHANGELOG_PLAIN_ENGLISH.md | prompt-lab-extension/ | Non-technical v1.5.0 summary |
| CWS_STORE_LISTING.md | prompt-lab-extension/ | Chrome Web Store submission copy |
| CWS_SUBMISSION_CHECKLIST.md | prompt-lab-extension/ | Pre-submission task list |
| PRIVACY_POLICY.md | prompt-lab-extension/ | Privacy disclosure for CWS and public use |
| DOCS_INVENTORY.md | repo root | Meta-index of all documentation files |

---

## Design Principles

- **Privacy-first** — no telemetry, no analytics, no server-side storage. API keys stay local.
- **Local-first** — all data persists in browser/app storage. No accounts, no cloud sync.
- **Provider-agnostic** — provider logic is abstracted; the UI doesn't care which provider is active.
- **Shared frontend** — one React codebase, three runtime shells. Platform differences are behind `platform.js`.
- **Progressive complexity** — basic enhance workflow is one click; A/B testing, eval history, test cases, and composer are available but not required.

---

---

# Archive / Historical Notes

> Move the following content from the current Notion page into this section
> or a separate child page titled "Archive / Historical Notes":

- [ ] Old extension-only architecture description and "MV3 sidebar extension" framing
- [ ] GitHub Pages migration prompt and docs/ deploy instructions
- [ ] `extension/*` → `dist/` copy flow and `index.html` → `panel.html` rename instructions
- [ ] Prompt Foundry branding exploration and naming memo
- [ ] Generic reusable prompts not specific to Prompt Lab
- [ ] Old file structure block (missing web/, desktop/, api/)
- [ ] "localStorage only" as a non-negotiable rule (now nuanced by shell)
- [ ] "Single component architecture" limitation note (now partially decomposed into hooks)
- [ ] Any cross-project links using Prompt Foundry naming

Each of these items is historically useful but no longer describes the current product.
Keeping them inline with the canonical definition makes the page unreliable as a reference.
