# Prompt Lab Changelog (Plain English)

Date: 2026-09-05

## Local write recovery (unreleased)

- Permanent Library deletion and Clear Library now leave content-free markers
  so a stale tab or delayed local write cannot restore the removed prompts.
  Reload older Prompt Lab tabs before editing after a clear.
- Workspace imports keep run and test-case associations attached to the prompt
  that survives deduplication. A partial import offers **Retry import** in
  Settings, retaining the same record IDs. Missing sources are reported instead
  of being silently linked to the wrong prompt.
- Scratch keeps readable notes on screen when a storage upgrade cannot be saved,
  and offers a retry after browser storage becomes available.
- Failed run, experiment, and test-case writes now show a retry notice. Keep the
  tab open to recover unsaved records; retrying saves the same records without
  making another provider request.
- A successful Arena response stays visible if its history write fails. Repeated
  save attempts retain their record IDs to prevent duplicate local history.

Date: 2026-08-20

## Full workspace redesign (current source 1.7.1; target release 1.8.0)

1. Enhancement results now stay on screen as a verdict-first workspace with
   editable candidates, exact changes, assumptions, reasoning, run metadata,
   original/side-by-side views, and explicit commit choices.
2. Prompt Lab no longer opens the legacy save drawer automatically after an
   enhancement. Nothing is presented as saved until you choose **Save new
   version** or **Save as new prompt**, and dismissing a result leaves the
   original draft intact.
3. Library is now a full three-part workspace with smart views, collections,
   tags, bulk actions, list/tile layouts, a persistent inspector, Pack Studio,
   Prompt CI status, and a 30-day Recently Deleted recovery path.
4. Scratch now includes markdown write/preview, outline navigation, pinning,
   statuses, tags, linked prompts, and selection-aware promotion into Write.
5. Dual Pane adds a resizable Library/Editor workflow with insert, replace,
   append, open, and pane-swap controls.
6. Create, Library, Evaluate, and Scratch now have a responsive bottom
   navigation on compact screens, including safe-area spacing that keeps final
   actions reachable.
7. Provider responses now retain available provider, model, latency, and token
   usage data so saved runs and result summaries can show what actually ran.

## Stability check (2026-08-20)

- Extension tests: pass (619 Vitest + 211 Node compatibility tests)
- Extension browser workflows: pass (6/6, including 400px and 768px paths)
- Extension, hosted web, and desktop frontend production builds: pass

---

Date: 2026-08-19

## Release status

- The shared package/source version is `1.7.1`, but it is not tagged or published as a GitHub Release.
- The next feature release is `1.8.0`; release promotion waits on the tooling and validation contract in `../docs/release-versioning.md`.
- The latest source tag is `v1.7.0`.
- The latest GitHub Release is the `v1.5.0-desktop-preview` prerelease.
- The native iPhone/iPad app is version `0.1.0` build `1` and has not been distributed through TestFlight or the App Store.

## What changed after the August behavioral audit (target release 1.8.0)

An independent behavioral audit on August 11 tested 169 user paths across every
surface and found 19 confirmed defects, six of them release blockers. The release
was put on hold. All six blockers are now fixed:

1. Creating or renaming a Notebook pad no longer crashes the app in the desktop
   and side-panel shells — naming happens in a proper in-app dialog instead of a
   browser popup those shells don't support.
2. Pressing Cancel during a generation now actually stops the request on the
   server side (hosted web and extension), instead of only hiding it in the UI
   while the provider kept working and billing.
3. Saving a prompt to the Library now checks that the save really landed. If the
   browser rejects the write (storage full), you see a clear failure and your
   draft stays in the editor — no more false "Saved!".
4. The Notebook autosave indicator now tells the truth: a failed save shows
   "Save failed" and keeps retrying, instead of showing "Saved" over data that
   was never written.
5. Editing notes in two tabs no longer silently destroys one tab's work. Tabs now
   sync live, merge edits to different pads, and warn when the same pad was
   changed in both places.
6. When billing is switched off on the server, the upgrade screen now says so
   plainly instead of showing purchase buttons that lead to a dead end.

Why: these were the audit's "hold release until fixed" items — every one of them
could lose user data, waste money, or mislead the user about what actually
happened.

## Stability check (2026-08-12)

- Extension tests: pass (566 Vitest + 207 Node tests, including 12 new audit
  regression tests)
- API safety tests: pass (66/66)
- Next milestone: rerun the behavioral audit against the fixed build before
  lifting the release hold. The remaining 10 P2 and 3 P3 audit findings are
  tracked for follow-up.

---

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
