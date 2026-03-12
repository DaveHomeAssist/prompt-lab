# Prompt Lab — Version History

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
