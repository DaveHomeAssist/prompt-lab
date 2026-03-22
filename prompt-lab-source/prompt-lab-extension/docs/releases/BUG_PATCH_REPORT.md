# Prompt Lab Bug/Patch Report

- Date: 2026-03-11
- Project: `prompt-lab-extension`
- Scope: correctness, crash prevention, security hardening, UX reliability

## Summary

This report documents the concrete bugs identified, the applied patch strategy, and current verification status.

## Bug-to-Patch Matrix

| ID | Severity | Bug | Root Cause | Patch Applied | Verification |
|---|---|---|---|---|---|
| B-001 | High | App crash on malformed imported/shared entries | String-only operations (`matchAll`, `trim`) used on non-strings | Added defensive typing + normalization pipeline (`normalizeEntry`, `normalizeLibrary`, guards in utility functions) | Covered by `npm test` (`extractVars`, `normalizeEntry`, `normalizeLibrary`) |
| B-002 | High | Prompt overwrite/collision when saving by same title | Save/upsert keyed by `title` instead of stable identity | Switched update flow to `editingId`-based writes; title now editable without implicit merge | Manual workflow validation + build pass |
| B-003 | Medium | Late Enhance response overwrote cleared editor | Async race without stale request rejection | Added request sequencing token (`enhanceReqRef`) and stale-response ignore logic | Manual race test + build pass |
| B-004 | Medium | A/B reset followed by stale response reappearing | Async race without per-side request invalidation | Added per-side request tokens (`abReqRef`) and invalidation on reset | Manual race test + build pass |
| B-005 | Medium | Duplicate IDs from import caused coupled delete/update effects | Raw import merge accepted IDs as-is | Import now normalizes and de-duplicates IDs | Covered by `npm test` (`normalizeLibrary` duplicate ID case) |
| B-006 | Low | Blob URL leak on repeated export | Object URLs created but not revoked | Added `URL.revokeObjectURL` after export click | Code-path verification |
| B-007 | Medium | Option-page action could fail in non-extension runtime | Direct runtime API call without guard | Added `openOptions()` runtime guard and fallback toast | Manual dev-mode validation |
| B-008 | High | Background API proxy lacked strong validation controls | Trusted incoming message payload/sender too broadly | Added sender check, schema validation, payload size bounds, response hardening | Build pass + code review verification |
| B-009 | Medium | API abuse potential via rapid request spam | No request throttling in proxy layer | Added in-memory rate limiting (`30/min`) in service worker | Code-path verification |
| B-010 | Medium | Secret handling lacked session-only mode and explicit key clear | Single persistent storage path only | Added persistent/session key mode + clear-key control in options UI | Manual options-flow validation + build pass |
| B-011 | Medium | Share/export could expose sensitive strings without warning | No pre-share/pre-export risk prompt | Added sensitive-content heuristics + confirmation prompts | Manual share/export validation |
| B-012 | Low | Risky sink usage pattern for icons | `dangerouslySetInnerHTML` without strict runtime guard | Frozen icon map + unknown-icon bailout | Code-path verification |

## Files Patched

- `src/App.jsx`
- `src/promptUtils.js`
- `src/icons.jsx`
- `extension/background.js`
- `extension/options.html`
- `extension/options.js`
- `extension/manifest.json`
- `tests/promptUtils.test.mjs`
- `package.json`

## Regression Controls Added

- Utility-level automated tests (`node --test`) for:
  - null and type guards
  - normalization and ID dedupe
  - payload parsing resilience
  - transient error classification
  - sensitive string detection

## Current Verification Status

- `npm test`: pass (`9/9`)
- `npm run build`: pass (extension assembled in `dist/`)

## Residual Risk Notes

- No end-to-end browser automation is included yet for UI race paths; those checks are manual.
- Rate limiter is in-memory per service-worker lifetime, not cross-device/account policy.
- Sensitive-content detection is heuristic and can produce false positives/negatives.
