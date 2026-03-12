# Prompt Lab Version Report

- Date: 2026-03-11
- Project: `prompt-lab-extension`
- Baseline app version: `1.0.0` (manifest + package)
- Report scope: UX updates, debugger hardening, STRIDE/OWASP remediation, test coverage pass

## Release Summary

This update delivered a combined UX + security + reliability release:

- Added editor/library workflow improvements (save raw prompts, clear editor, rename prompts, manual reorder, editor/library focus modes).
- Added A/B transparency and race-condition guards for async request flows.
- Hardened import/share/storage normalization to prevent malformed data crashes.
- Hardened background API proxy controls (sender validation, payload validation, bounds checks, rate limiting).
- Improved key management UX with persistent/session key modes and clear-key action.
- Added utility-level automated tests and wired `npm test`.

## Key Functional Changes

### Editor and Library

- Save is no longer enhancement-gated (`raw` prompts can be saved).
- Save title auto-fills from prompt content.
- Added explicit `Save` and `Clear` buttons in editor action row.
- Added `Split`, `Focus Editor`, and `Focus Library` modes.
- Added library `Rename` and `Edit` actions.
- Added manual drag-drop reorder in library with `Sort: Manual`.
- Export button surfaced in library header.
- Destructive actions use clearer red styling + confirmation prompts.

### A/B Testing

- Added visible clarification that each variant runs as isolated prompt-only payload (no added context).
- Added stale request guards so reset/clear cannot be overwritten by late async responses.

## Security and OWASP/STRIDE Remediation

### Background Proxy (`extension/background.js`)

- Enforced sender identity check (`sender.id`).
- Added payload schema and size validation:
  - Allowed model pattern only (`claude-*`)
  - `max_tokens` bounded
  - `messages` structure/role/content checks
  - per-message and total content length limits
- Added in-memory rate limiting (`30/min`).
- Hardened upstream error handling for non-JSON and non-2xx responses.

### Secrets Handling (`extension/options.*`)

- Added persistence mode control:
  - Persistent key (`chrome.storage.local`)
  - Session-only key (`chrome.storage.session` with fallback)
- Added clear-key action.
- Added masked key placeholder refresh behavior.

### Extension Exposure (`extension/manifest.json`)

- Reduced `web_accessible_resources.matches` from `"<all_urls>"` to:
  - `https://*/*`
  - `http://*/*`

### UI Safety

- Added icon lookup guard and frozen map in `src/icons.jsx` to reduce sink misuse risk around `dangerouslySetInnerHTML`.

## Reliability and Correctness Hardening

- Added centralized normalization/validation utilities (`src/promptUtils.js`):
  - type guards for string-only operations
  - safe entry/library normalization
  - duplicate ID deconfliction
  - robust share/import parsing
  - transient error detection
- Save/update now uses `editingId` semantics to avoid title-collision overwrite issues.
- Export now revokes object URLs after use.
- Import now rejects oversized files and invalid payloads gracefully.

## New Test Coverage

- Added `tests/promptUtils.test.mjs`.
- Added `npm test` script in `package.json`.
- Current suite validates:
  - null/type guards (`scorePrompt`, `extractVars`)
  - normalization behavior (`normalizeEntry`, `normalizeLibrary`)
  - duplicate ID dedupe
  - share/payload parsing robustness
  - transient error classification
  - sensitive-string detection

## Files Added

- `src/promptUtils.js`
- `tests/promptUtils.test.mjs`
- `VERSION_REPORT.md`

## Files Updated

- `src/App.jsx`
- `src/icons.jsx`
- `extension/background.js`
- `extension/options.html`
- `extension/options.js`
- `extension/manifest.json`
- `package.json`

## Verification Results

- Test command: `npm test`
  - Result: pass (9/9)
- Build command: `npm run build`
  - Result: pass, extension assembled in `dist/`

## Notes

- App/manifest semantic version remains `1.0.0`. If publishing this bundle, recommended bump is `1.1.0` due to additive features and behavior changes.

## Companion Docs

- `BUG_PATCH_REPORT.md`
- `CHANGELOG_PLAIN_ENGLISH.md`
