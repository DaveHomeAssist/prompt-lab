# Prompt Lab Changelog (Plain English)

Date: 2026-03-17

## What changed in v1.7.0

1. Prompt Lab now has a hosted web app and a matching Tauri desktop shell in addition to the MV3 extension.
2. The web app and desktop app reuse the same React frontend as the extension, so product behavior stays aligned across all three targets.
3. Desktop users now have an in-app provider settings modal instead of the extension-only options page flow.
4. Provider-specific request logic was pulled into a shared provider layer, which makes adding or changing providers less brittle.
5. The PII scanner and the settings redaction rules now share one canonical engine instead of duplicating regex logic in two places.
6. Hook-level tests were added for test cases and eval run loading, which closes coverage gaps around editor state refresh behavior.
7. There is now a browser-level smoke test for the extension enhance flow in addition to the unit and integration suite.
8. CI now gates extension builds and tests, and desktop builds are prepared for macOS, Linux, and Windows runners.
9. Desktop packaging was cleaned up with a valid macOS bundle identifier and a 1024x1024 source icon for bundling.

## Stability check

- Extension tests: pass (`npm test`, 49 tests)
- Extension build: pass (`npm run build`)
- Desktop frontend build: pass (`cd ../prompt-lab-desktop && npm run build`)
- macOS Tauri bundles: pass locally for `.app` and `.dmg`

## In short

This release turns Prompt Lab from an extension-only tool into a shared extension-plus-web-plus-desktop codebase with better test coverage, cleaner provider plumbing, and cleaner release infrastructure.
