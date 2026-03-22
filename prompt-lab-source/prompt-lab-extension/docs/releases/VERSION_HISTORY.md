# Prompt Lab — Version History

## v1.5.0 — 2026-03-13

Shared frontend, hosted web target, desktop target, and release infrastructure update.

### Architecture

- Prompt Lab now ships as:
  - an MV3 Chrome/Vivaldi side panel extension
  - a hosted web app deployed at `https://prompt-lab-tawny.vercel.app/app/`
  - a Tauri 2 desktop app
- The desktop app loads the shared frontend from `prompt-lab-extension/src/` through a relative import in `prompt-lab-desktop/index.html`.
- The hosted web app loads the same shared frontend through `prompt-lab-web/app/index.html` and is currently exposed publicly at `https://prompt-lab-tawny.vercel.app/app/`.
- Desktop-specific provider settings use `localStorage` key `pl2-provider-settings`, while the extension continues to use `chrome.storage.local`.

### Runtime and platform work

- Added a desktop-only in-app provider settings modal.
- Added a hosted web shell and public landing page deployment path through Vercel.
- Extracted provider dispatch into `src/lib/providerRegistry.js` and `src/lib/providers.js`.
- Consolidated PII scanning and redaction around a single `src/lib/piiEngine.js`.
- Standardized shared utility imports away from re-export layers.

### Tests and verification

- Added hook-level tests for `useTestCases` and `useEvalRuns`.
- Added provider unit tests.
- Added unified PII engine tests.
- Added a Playwright smoke test for the extension enhance flow.
- Current maintained extension suite: 49 tests across 8 suites, all passing.

### Build and packaging

- Added extension CI workflow for `npm test` + `npm run build`.
- Added desktop CI workflow using `tauri-apps/tauri-action@v0` across macOS, Linux, and Windows.
- Fixed desktop macOS packaging hygiene:
  - bundle identifier changed to `com.promptlab.desktop`
  - source icon resized to 1024x1024 for bundling

### Notes

- Desktop currently shares the extension frontend directly rather than maintaining a separate UI fork.
- The current public website is split between a landing page on `promptlab.tools/` and the shared app at `https://prompt-lab-tawny.vercel.app/app/`.
- Test coverage was reorganized during the shared frontend / desktop transition. The current maintained extension suite is 49 tests across 8 suites.
- Chrome Web Store review materials are still incomplete; see `CWS_SUBMISSION_CHECKLIST.md`.
- A Vite warning remains about `desktopApi.js` being both dynamically and statically imported. It does not block current builds.

## v1.4.0 — 2026-03-12

Module wiring and stabilization release. All six pure-logic modules that existed as dead code since v1.3.0 are now live in the runtime.

### New runtime features

- **Prompt linting** — debounced `lintPrompt()` runs on every keystroke (300ms). Collapsible panel below the scoring section shows issues with severity badges and one-click "Fix" buttons via `applyLintQuickFix()`. Checks for: missing goal, missing role, missing constraints, missing output format, missing examples.
- **Structured error handling** — `normalizeError()` from `errorTaxonomy.js` replaces raw `e.message` strings. Error display now shows user-friendly message, categorized suggestions, and action buttons (Retry, Open Settings) based on error type (auth, quota, network, timeout, schema).
- **PII scanning before send** — `scanSensitiveData()` from `piiScanner.js` runs on the full API payload before any API call. If sensitive data is detected (API keys, emails, credit cards, secrets), a modal shows matched items with type badges and truncated previews. Three options: Redact & Send, Send Anyway, Cancel.
- **Experiment history persistence** — A/B test winner picks now persist via `experimentStore.js` (IndexedDB with localStorage fallback). Collapsible history panel at bottom of A/B tab shows past experiments with labels, dates, and winner badges.

### File renames (breaking for imports)

- `src/redactionGate.js` → `src/piiScanner.js` (contained PII scanner, not redaction gate)
- `src/sensitiveData.js` → `src/redactionEngine.js` (contained redaction engine, not sensitive data detector)
- Intent now matches filename. All test imports updated accordingly.

### Gemini model updates

- `gemini-2.5-flash-preview-04-17` → `gemini-2.5-flash` (preview retired)
- `gemini-2.5-pro-preview-05-06` → `gemini-2.5-pro` (preview retired)
- Updated in `background.js`, `options.js`, and `options.html`

### Infrastructure

- **GitHub Pages workflow** fixed to build from canonical `prompt-lab-extension/` path instead of stale outer `prompt-lab-source/`
- **Duplicate tree frozen** — added `DEPRECATED.md` to outer `prompt-lab-source/` directory
- **Test suite expanded** — 204 tests across 7 files (up from 9 tests in 1 file):
  - `promptUtils.test.mjs` (9 tests) — existing
  - `promptUtils-extended.test.mjs` (55 tests) — new
  - `errorTaxonomy.test.mjs` (23 tests) — new
  - `promptLint.test.mjs` (25 tests) — new
  - `piiScanner.test.mjs` (34 tests) — new
  - `redactionEngine.test.mjs` (33 tests) — new
  - `experimentHistory.test.mjs` (25 tests) — new

### Build

- `npm test` — 204/204 pass
- `npm run build` — 43 modules, assembled to `dist/`

### Commits

- `e954f57` — v1.4.0: Wire dead modules into runtime
- `9fc2eed` — Fix retired Gemini model IDs

---

## v1.3.1 — 2026-03-12

Architecture refactor and CWS compliance release.

### Breaking changes

- `callAnthropic()` renamed to `callModel()` in `src/api.js`
- Chrome message type changed from `ANTHROPIC_REQUEST` to `MODEL_REQUEST`
- Monolithic `App.jsx` split into multiple modules (imports changed)

### Refactors

- **App.jsx split** — reduced from ~1329 lines to ~550 lines by extracting:
  - `src/constants.js` — TAG_COLORS, ALL_TAGS, MODES, DEFAULT_LIBRARY_SEEDS, theme object T
  - `src/usePersistedState.js` — localStorage-backed React hook with serialize/deserialize/validate
  - `src/useLibrary.js` — library CRUD, persistence, filtering, sorting, export/import, sharing
  - `src/Toast.jsx` — auto-dismiss notification component
  - `src/TagChip.jsx` — tag display/selection component
  - `src/PadTab.jsx` — notepad tab with localStorage persistence
  - `src/ComposerTab.jsx` — drag-and-drop prompt composition tab
  - `src/ABTestTab.jsx` — A/B prompt testing tab with own state and request tracking

- **Unified message converters** — merged duplicate `toOllamaMessages()` and `toOpenAIMessages()` into single `toChatMessages()` in `background.js`

- **Legacy naming removed** — all references to `ANTHROPIC_REQUEST` and `callAnthropic` replaced with provider-neutral `MODEL_REQUEST` / `callModel`

### CWS compliance

- Removed `web_accessible_resources` from manifest (no page injection needed)
- Bundled Google Fonts locally (`extension/fonts/outfit.woff2`, `extension/fonts/jetbrains-mono.woff2`) — eliminates external font fetches from `options.html`
- Added `build:cws` script for unminified review build to `dist-cws/`
- Added `PERMISSIONS_JUSTIFICATION.md` documenting all host_permissions
- Added `PRIVACY_POLICY.md` (local storage, no telemetry, provider-only transmission)
- Validated: no `eval()`, no remote script loading, no `<all_urls>`

### Build

- `npm test` — 9/9 pass
- `npm run build` — 39 modules, assembled to `dist/`
- `npm run build:cws` — unminified build to `dist-cws/`

---

## v1.3.0 — 2026-03-11

Multi-provider integration release.

### New features

- **5-provider support** — Anthropic, OpenAI, Gemini, OpenRouter, and Ollama (localhost)
- Provider adapter pattern in `background.js`: Anthropic-format payloads converted to each provider's native format
- Response normalization: all providers return `{ content: [{ type: 'text', text }] }`
- Options page updated with provider selector, model configuration, and per-provider API key fields

### New modules

- `src/errorTaxonomy.js` — error classification with categories and user-facing suggestions
- `src/experimentHistory.js` — A/B test record management
- `src/experimentStore.js` — IndexedDB with localStorage fallback
- `src/promptLint.js` — rule-based prompt quality linting
- `src/redactionGate.js` — sensitive data scanning and redaction UI
- `src/sensitiveData.js` — detection patterns for API keys, emails, card numbers

### Manifest

- Expanded `host_permissions` to 6 entries:
  - `https://api.anthropic.com/*`
  - `https://api.openai.com/*`
  - `https://generativelanguage.googleapis.com/*`
  - `https://openrouter.ai/*`
  - `http://localhost:11434/*`
  - `http://127.0.0.1:11434/*`

---

## v1.1.0 — 2026-03-11

UX, security hardening, and reliability release.

### Editor and library

- Save no longer requires running Enhance first (raw prompts saveable)
- Auto-fill title from prompt content
- Added Save and Clear buttons in editor action row
- Added Split, Focus Editor, and Focus Library layout modes
- Added library Rename and Edit actions
- Added manual drag-drop reorder with Sort: Manual
- Export button surfaced in library header
- Destructive actions use red styling and confirmation prompts

### A/B testing

- Visible clarification that each variant runs as isolated prompt-only payload
- Stale request guards prevent reset/clear from being overwritten by late async responses

### Security (OWASP/STRIDE)

- **Background proxy** — sender identity check, payload schema/size validation, model pattern allowlist, message structure checks, content length limits, 30/min rate limiting, hardened non-JSON and non-2xx error handling
- **Secrets handling** — persistent vs session-only key modes, clear-key action, masked key placeholder
- **Manifest** — reduced `web_accessible_resources.matches` from `<all_urls>` to `https://*/*` and `http://*/*`
- **UI safety** — icon lookup guard and frozen map to reduce `dangerouslySetInnerHTML` risk

### Reliability

- Centralized normalization utilities in `src/promptUtils.js` (type guards, entry/library normalization, duplicate ID deconfliction, share/import parsing, transient error detection)
- Save/update uses `editingId` semantics to avoid title-collision overwrites
- Export revokes object URLs after use
- Import rejects oversized files and invalid payloads

### Tests

- Added `tests/promptUtils.test.mjs` — 9 tests covering null/type guards, normalization, dedupe, share parsing, transient error classification, sensitive-string detection
- Added `npm test` script

---

## v1.0.0 — Initial release

Single-provider (Anthropic Claude) Chrome extension.

- Prompt enhancement via Claude API
- Prompt library with tags, search, and localStorage persistence
- A/B prompt testing with side-by-side comparison
- Drag-and-drop prompt composer
- Notepad tab
- Dark/light theme with system preference detection
- Command palette with keyboard shortcuts
- Share via URL and JSON export/import
