# Prompt Lab Changelog (Plain English)

- Date: 2026-03-11

## What changed

1. You can now save prompts even if you never ran “Enhance”.
2. Prompt titles now auto-fill from your prompt text, so you don’t start with a blank title every time.
3. Prompt renaming is now built in directly from the library list.
4. You can manually reorder prompts in the library using drag-and-drop (`Sort: Manual`).
5. The editor and library can now be focused/collapsed (`Split`, `Focus Editor`, `Focus Library`).
6. Delete/trash actions are more obvious (red buttons) andd now use confirmations for destructive actions.
7. A/B Test now clearly explains exactly what gets sent to the model: one plain prompt per side, no extra hidden context.
8. The app is more resilient to bad data from imports/shared links and won’t crash on malformed prompt objects.
9. The save/update logic is safer and no longer accidentally overwrites prompts just because titles match.
10. Background API calls are now stricter and safer:
    - only valid sender/messages accepted
    - request size/model/token bounds validated
    - basic rate limiting added
11. API key settings are improved:
    - choose persistent key or session-only key
    - clear key button added
12. Export/share now warn when content looks sensitive.
13. Internal utility tests were added and the project now has a runnable `npm test` command.

## Stability check

- Tests: pass (`npm test`)
- Build: pass (`npm run build`)

## In short

This release makes Prompt Lab easier to use day-to-day, harder to break with bad input, and safer around API key/payload handling.
