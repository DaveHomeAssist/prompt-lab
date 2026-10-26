# AGENTS.md

Inherits root rules from `/Users/daverobertson/Desktop/Code/AGENTS.md`.

## Workspace contract

Read `~/Code/ops-hub/90-governance/WORKSPACE_OPERATING_RULES.md` before project rules, including COMMS (one entry on the shared Agent Communications Page per session).

## Project Overview

Prompt Lab is a multi surface prompt engineering tool with extension, desktop, and web oriented shells. It focuses on authoring, saving, testing, comparing, and reusing prompts across multiple providers.

## Stack

- React
- Vite
- Chrome extension surface plus desktop and web shells
- Local storage and Chrome storage persistence
- Vitest for targeted tests

## Key Decisions

- Keep provider support abstracted so UI and execution flows are not hard wired to one model vendor
- Separate authoring, library, experiments, and notebook concerns even when they share one shell
- Persist prompt, run, and settings state locally to keep the tool fast and offline tolerant where possible

## Session naming

Follow [Status Naming](https://github.com/DaveHomeAssist/skills/blob/master/status-naming.md), the canonical authority for the format, parent/subproject emoji map, phases, date semantics and exceptions.

`<emoji(s)> <Project> | <PHASE> | <Title> <MM-DD>`

Preserve Dave's manual titles and protected or uncertain sessions. Status belongs in the body; status changes do not authorize renames or Notion writes. Local instructions extend this rule only through a named, purposeful exception; they do not maintain a competing format.

Before closeout, read the current title through supported task tools. Preserve manual titles; if readback is unavailable, report the gap rather than claiming verification.

## Merge policy

For PromptLab pull requests, once all required checks pass, mark the PR ready and merge it into main using a merge commit. If required checks are still running, enable auto-merge. Never merge when a required check fails. Do not delete source branches unless requested.

## Status reports

Verify current Git, files, relevant test/build output, CI/deployment and user
behavior before reporting status. Put status and verification in the report body;
retain the existing task title, including Dave's manual name. Use the
canonical session naming convention only when generating a title, not a status-light or
timestamp naming format. A title is never evidence of completion.

## Required Notion and visual progress updates

After meaningful implementation, verification, merge, release, blocker, or scope updates, reconcile the affected rows in the canonical Notion Issue Backlog and refresh `project-progress/index.html` before closeout. Explicit read-only or no-write requests take precedence; unchanged polling needs no new status note.

Follow `project-progress/README.md`. Fetch the live schema and rows, patch existing records without duplicates, attach evidence and one next action, and read back writes. A row becomes Done only after its full acceptance contract passes. Refresh `project-progress/status.json` from the complete issue-table snapshot and current Git/CI/runtime evidence, then run `node prompt-lab-source/scripts/render-project-progress.mjs` and the same command with `--check` under Node 22. Verify the HTML at mobile and desktop widths after presentation changes. Keep unavailable sources visibly Unknown and do not claim synchronization when a write/readback failed.

This is an operator-maintained snapshot, not a background sync service. Never put credentials or private provider payloads in the snapshot or HTML. Keep it outside public deployment output unless Dave explicitly requests publication. Do not replace historical notes, change database schemas, or archive issues as part of routine progress updates.

## Issue Tracker

| ID | Severity | Status | Title | Notes |
|----|----------|--------|-------|-------|
| 001 | P2 | resolved | Composer still teaches drag first interaction | Fixed all help text strings; empty state and block hints now lead with Add/Move controls |
| 002 | P2 | resolved | Create workflow remains too vertically stacked | Phase 1 complete: extracted CreateEditorPane, collapsed scoring+lint strip, inline quick inject chips, merged status bar, compact context breadcrumb |
| 003 | P2 | in-progress | Experiments and run history are still split | Unified under Evaluate with persistent timeline filters; compare-model toggle no longer traps active state on filtered timelines, and broader QA under Node 22 is still pending |
| 004 | P2 | resolved | Accessibility parity remains incomplete | Added aria-labels to theme/shortcuts/settings buttons; ThemeProvider now syncs body bg |
| 005 | P2 | resolved | Privacy policy page missing, all nav links dead | Created docs/privacy.html, fixed all nav/footer links to relative paths |
| 006 | P2 | resolved | No diff viewer for A/B test outputs | Added DiffEngine.js, DiffPane.jsx, and Sync View button in ABTestTab |
| 007 | P2 | resolved | Selected pad title unreadable in light theme | Threaded colorMode into PadTab; theme-aware active title, fixed dead theme sniff, stable row width |
| 008 | P2 | resolved | GitHub-login entitlement persistence diverges from email login | Clerk-id-first Stripe lookup, checkout clerkUserId binding, revalidate guard parity, billing state reset on account switch |
| 009 | P2 | resolved | Failed/cancelled enhance runs missing from run history | Error and cancelled enhance attempts now recorded with enhanceMode tag and timeline status filters |
| 010 | P2 | resolved | Library auto-naming produced prefix-slice titles | Heading/role-aware title suggestion; enhance no longer clobbers user-typed titles |
| 011 | P1 | resolved | iOS prototype dropped failed/cancelled enhance runs (regression vs 009) | Native store now writes RunRecord with status failed/canceled; attempts that never reach the provider (no API key) still record nothing |
| 012 | P1 | resolved | iOS enhance parser rejected fenced or preambled contract JSON | Recover outermost JSON object before decoding; fences and short preambles no longer fail an otherwise-valid run |
| 013 | P2 | resolved | iOS provider discarded Anthropic error bodies | Non-2xx responses drained (8KB cap) and decoded so invalid-key/rate-limit reasons surface instead of a bare status code |
| 014 | P1 | resolved | Notebook New/Rename crashed embedded browsers (PLB-001) | window.prompt() replaced with a controlled React naming dialog in PadTab |
| 015 | P1 | resolved | Cancel left hosted/extension provider requests running (PLB-002) | AbortSignal forwarded through proxyFetch; MODEL_ABORT + requestId contract added to extension messaging and background worker; abort-aware retry backoff; late success discarded |
| 016 | P1 | resolved | Library save reported "Saved!" after rejected storage write (PLB-003) | doSave writes before success feedback; quota failure surfaces visibly and keeps draft + save panel; deleted-target update fails honestly |
| 017 | P1 | resolved | Notebook autosave reported Saved on quota failure (PLB-004) | persistPadsState returns acknowledged result; failures show "Save failed" and keep the buffer dirty for retry |
| 018 | P1 | resolved | Notebook multi-tab edits silently overwrote each other (PLB-005) | pl2-pads revision counter, read-merge-write per pad, storage-event adoption with same-pad conflict warning |
| 019 | P1 | resolved | Billing-disabled production still showed live purchase controls (PLB-006) | billingDisabled propagated into billing state; checkout/portal surface server message; billing modal shows maintenance notice |
| 020 | P2 | resolved | Hosted proxy limits were reported as Anthropic rate limits with wrong recovery advice | Proxy 429s carry `code`/`limit`/`reset_at`; client shows Prompt Lab-attributed copy with reset time, offers Provider Settings for daily caps, and never auto-retries hosted limits |
| 021 | P2 | resolved | Hosted quota was invisible and spent by retries and rejected requests | Provider 429s no longer auto-retry (manual Try Again kept); demo/global counters move only after body validation and key check; proxy sends `X-Demo-Limit`/`X-Global-Limit`; `HostedQuotaBadge` shows remaining daily requests under Create actions and in Provider Settings |
| 022 | P1 | resolved | Send-time PII redaction leaked secret tails, missed bare Bearer tokens, and split parenthesized phones | `secret_value` and `api_key` values are captured whole (greedy, uncapped, dot-joined JWTs and `=` padding included); new `bearer_token` detector (`BEARER_TOKEN`) for `Authorization: Bearer` values; phone spans start at a leading `(` or `+`; findings that overlap across types resolve to one span so redaction no longer double-applies or corrupts text. Known limits: values with characters outside the token alphabet (such as `!`) and quoted values containing spaces are only partly matched, and the landing "PII Scanner" card still claims name detection the engine does not provide |
| 023 | P2 | in-progress | OpenRouter default model was a dated Sonnet 4 slug that OpenRouter does not list | Default is now `anthropic/claude-sonnet-4.6` in both registries (desktop shares `src/` via symlink), the Options placeholder, and the setup/guide pages; a stored value that exactly equals the old default is read as the new default (nothing rewritten until Save), custom models untouched. Open: no live OpenRouter call was made (no key), so the runtime gate is unverified |
| 024 | P1 | resolved | Batch test-case runs had no reachable way to create a case | The only Add Case form lived in `LibraryPanel`, which App never mounts, and the Library Tests tab was read-only and pointed users at Evaluate (no case form there either), so Run Cases stayed disabled. Tests tab now hosts `TestCasesPanel` (add/edit/run/delete; Use starts a clean draft with undo); corrected empty-state copy; Run disabled while a run is in flight. Runner semantics and the `batchRuns` gate unchanged. Confirmed in a browser before the fix; regression guarded by component, App-wiring and Playwright (`e2e/library-test-cases.spec.js`, wired into CI) tests |
| 025 | P2 | resolved | Dependency audit gate failed every PR on an advisory with no fixed release | GitHub withdrew GHSA-vfj7-8cjw-p6xm on 2026-10-23. PR214 removes its November 5 waiver; all high/critical findings block under the default policy. Dominic tooling25/25 and four-root audit pass with zero high/critical. The undici7.30.1 repair from PR212 is preserved; no dependency migration or expiry extension. |
| 026 | P1 | in-progress | Windows desktop Library saves lost on clean close; Enhance clicks intermittently never reach the provider | WebView2 batches localStorage commits and dropped every Library write from one launch at a clean close (run 37440976807). The desktop shell now journals Library state (rows, trash, collections, packs, deletion and clear markers) to IndexedDB with `durability: "strict"` after each write and restores the newer copy into localStorage before first render; localStorage stays the mirror for existing readers. Saved now waits for the strict journal commit; failed or pending writes keep drafts and save panels available, and an identical retry reuses its identity/version. Native acceptance records journal state at boot and checks aborted commit, visible failure and acknowledged retry, plus Enhance diagnostics. PR #132 merged as `ea874b8` after all 16 current checks passed. Windows MSI and NSIS aborted-commit/retry, relaunch, export and reinstall acceptance passed on `e177ee8` (run 37638638561). Both packages are unsigned. All main workflows, including exact-merge MSI/NSIS and DEB/AppImage acceptance, passed in run 37641072421 attempt 2 after GitHub recovered from an internal server error; the original failure is retained. Open: the independent Enhance timeout cause and broader platform/human acceptance |
| 027 | P2 | in-progress | Concurrent first billing requests created duplicate Stripe customers | Since PR #143, checkout creates the Clerk-bound customer too. The first license check, a Go Pro click and a second tab could all miss a customer Stripe Search had not indexed and each create one, so a subscription could land on a customer that license refresh never reads (`limit=1`) and a paid account could show Free. `createStripeCustomer` now sends `Idempotency-Key: promptlab-customer:<clerkUserId>:<sha256(email) prefix>` and retries a 409 in-flight conflict with backoff (250, 500, 1000, 2000ms; about 3.75s); a scratch probe reproduced two customers before the fix and the new tests fail without it. Open: not exercised against live Stripe; a customer deleted within 24h of creation would replay its deleted ID |
| 028 | P3 | resolved | Checkout's webhook/KV fail-closed switched off all billing controls | Checkout answered a missing `STRIPE_WEBHOOK_SECRET` or KV store with `billingDisabled`, so the client disabled Manage Purchases, Sync and Refresh and `refreshLicense` returned early until reload, against PR #143's intent. Checkout now returns `checkoutDisabled` (terminal, non-retryable) for that case and keeps `billingDisabled` for missing Clerk/Stripe keys; the client records `checkoutDisabled`, which the next license validation clears. Production has both configured, so the path is not live today |
| 029 | P2 | resolved | Library tile cards drew their date and use count under the Editor/Copy/Favorite buttons | Tile view pinned `.pl-library-card-actions` with `position: absolute` to the card's bottom-right corner, outside the layout, while `.pl-library-card-meta` stayed a right-aligned column; any card whose tags or excerpt filled it drew `ver`/`uses`/date under the buttons (seen on most of a 170-prompt production Library). Two stale `grid-column: 2 / -1` rules from an older card structure also pushed short cards' text into a narrow right column, and at phone width the metadata sat beside the title. Tiles now keep the action row in flow as the card's last grid row, give the card text one full-width column and lay the metadata out as one wrapping line under the text. `e2e/library-layout-overlap.spec.js` (wired into desktop-build CI) measures rendered boxes at 400/768/1180/1440 px and at 2000 px with the inspector open; it failed at every width before the fix |
| 030 | P2 | resolved | Library inspector was see-through when it floated over the list (701-1100 px) | At 1100 px and below the inspector becomes an absolutely positioned overlay but kept the column's `color-mix(currentColor 2%, transparent)` background (alpha 5/255), so its fields and the prompt cards behind it overlapped; only the 700 px and smaller layouts set an opaque surface. The overlay now uses `--pl-brand-ink`, the theme's page colour. The same spec asserts an opaque background at 900 px in dark and light mode; both failed before the fix |
| 031 | P2 | resolved | Library import review hid which page held pending conflict choices | Importing an 82-prompt library left Apply import disabled with only "1 conflict choices required" at the bottom of page 5, while the pending prompt was on page 1 and the dialog gave no way to find it. `WorkspaceImportModal` now shows a banner naming the page or pages that hold pending choices with a Jump to unresolved button that pages to the next pending prompt (wrapping) and focuses its action picker, outlines pending rows in amber with a "choice required" label, and pluralises the count correctly. Guarded by a `WorkspaceImportModal.test.jsx` case (pending row on page 1, viewer on page 2). PR #154 merged as `d2dc37a`; the production bundle carries the control. The 3 local `workspaceImportRecovery.test.jsx` failures seen on 2026-10-15 do not reproduce in CI under Node 22 (9/9 pass). Open: no signed-in production import with a pending conflict beyond page 1 |
| 032 | P2 | resolved | Chain substitution read prompt text as replacement syntax | `fillTemplate` in `chainRunner.js` passed chain input, previous output and mapped values to `String.replace` as replacement strings, so `$$`, `$&`, `` $` `` and `$'` in that text were expanded, and placeholders were replaced one after another, so inserted text containing `{{input}}` or another `{{NAME}}` was filled again. Each template is now filled in one pass with a replacement callback (inline: one pattern for `{{prev}}` and `{{input}}`; mapped: the exact escaped `{{NAME}}` tokens, longest first). Four new `chainRunner.test.js` cases cover every special sequence in input, previous output and all three `varMap` sources plus no rescanning; all four fail on `80a1070`. PR #215 merged as `f27bd17` after all 15 checks passed on the identical tree; production `dpl_Dr7UaVavfboRB1FxWLV7QJ8ZcmMZ` READY and the live `/app` bundle carries the fix. Open: no live chain run against a provider; the same `replaceAll(token, value)` pattern remains in `buildResolvedEntry` (`usePersistenceFlow.js`, Library template fill) |
| 033 | P2 | resolved | Failed enhance runs became the draft title and golden comparison text | Failed, canceled and blocked enhance runs are saved with their error message as `output`. With no enhanced result in the editor, `App.jsx` fell back to the newest eval run whatever its status, so a failed Enhance put the error text (for example a hosted quota message) in the Create breadcrumb, the suggested save title and the golden comparison, which then reported a false fail. The fallback now takes the newest successful run, or a legacy row with no status, through one `isSuccessfulRun` helper shared with the follow-up run list. With no successful run the title comes from the draft and no golden verdict is computed. Guarded by `App.failedRunComparison.test.jsx`, which mounts the real App and Create breadcrumb: 4/4 fail on `f27bd17` and pass with the fix (Dominic, Node 22; full extension suite 111 files and 1,278 tests pass). PR #217 merged as `f2a33d9`. It merged while 4 checks were still running because `gh pr merge --auto` merges at once when no check is required; at 07:31 UTC 7 of 11 PR checks and post-merge Extension CI, API Safety, Version Consistency and Landing CI had passed, with desktop packaging still running; the production deployment succeeded and the live bundle carries the fix. Open: no signed-in production check of a forced Enhance failure |
| 034 | P2 | resolved | New drafts borrowed another prompt's run for their title and comparison | For a new, unsaved draft the editor's run history lists recent enhance runs from every prompt, and `App.jsx` fell back to the newest successful one for the suggested save title and the comparison text. Dual Pane Enhance and the save handlers then stored it, so a "Rename the chat" prompt was saved on 2026-10-26 as "An image has been provided", the previous prompt's output. The fallback now uses only the current prompt's runs: for a saved prompt, runs tagged with its id; for an unsaved draft, its own latest run (`resultMeta.runId`, cleared by New Prompt and linked to the entry on save). Two new `App.failedRunComparison.test.jsx` cases fail on `e6a880f` and pass; the four PR #217 cases still pass; full extension suite 111 files and 1,280 tests (Dominic, Node 22). PR #222 merged as `6ea5f6f` after all 15 checks passed; the production bundle carries revision `6ea5f6f` and the fix. Open: no signed-in production run of two enhances in a row |
| 035 | P2 | resolved | Library template fill read variable values as replacement syntax | `buildResolvedEntry` in `usePersistenceFlow.js` filled each `{{name}}` with `replaceAll` and a string value, so `$$`, `$&`, `` $` `` and `$'` in typed values or a pasted `{{clipboard}}` were expanded (a copied `sed` command's `$&` became `{{clipboard}}`), and filling one name at a time refilled `{{...}}` text inside another value. New `fillTemplateVars` in `promptUtils.js` fills the exact escaped `{{name}}` tokens in one pass with a replacement callback; placeholders without a value stay as written; editor and A/B routes both use it. Three hook tests in `usePersistenceFlow.share.test.jsx` fail on `5572cf3` and pass, plus six helper unit tests; `vitest related` 37 files / 550 tests. PR #220 merged as `e9e6fa3` after all 15 checks passed on the identical tree (Landing CI needed one rerun after its known Chromium-install timeout); production `dpl_CsSXFzW8QPhmTsDpGXKrei9h7cDF` READY and the live `/app` bundle carries the fix. Open: no manual browser run of the variable form |
| 036 | P2 | resolved | Scratch notes could not be seen while writing a prompt | Dave asked on 2026-10-21 and 2026-10-23 to see Scratch notes in Write, with a one-line note list and resizable panels; Write had no side column because Create hides the Library pane. PR #223 (October intake Slice 1) adds a Scratch panel beside the editor, opened from the editing context bar or Cmd/Ctrl+\: notes autosave through the same revision-checked Scratch storage; Insert note or selection at the prompt cursor (a new paragraph at the end); New note; Open in Scratch. It is a resizable column at 1100 px and wider and a floating panel below that, above the phone navigation bar. A shared `PanelResizer` also resizes the Scratch note index, and Scratch rows default to one line with a Detailed option. Fixed before merge: the panel keeps its own note when another tab changes the selection (Codex P1); text that fails to save as the panel closes is kept and restored on reopen (Codex P2); the toggle hides below 720 px wide and 500 px tall, where Landing CI's 320x256 gate found the editor squeezed to 70 px. CI on `fdc80f4`: extension suite 115 files and 1,332 tests, hosted browser gates 53 passed and 1 skipped. PR #223 merged as `ee9916c` after all 15 checks passed on `e8e76b7`. Production deployment succeeded; the live /app bundle carries revision ee9916c with the panel, both review fixes and the short-window toggle rule. Open: no signed-in production check of the panel. |
| 037 | P2 | in-progress | Favorites and Recent were not reachable from Write, and the Library inspector stopped at 640 px | Dave asked on 2026-10-23 for Favorites and Recent in the sidebar from Write and a wider inspector (October intake Slice 2, T01 T22 T23). PR #228: the panel beside Write gets Scratch and Prompts tabs and a Prompts toggle in the editing bar; Prompts lists All, Recent and Favorites with the Library's smart-view rules, now shared in `lib/librarySmartViews.js` and `lib/librarySort.js`; rows open the prompt in Write (recorded for Recent), insert its text at the cursor, or toggle Favorite. The Library folder drawer uses the shared `PanelResizer` (160 to 384 px; double-click returns to the layout width). The inspector cap rises from 640 px or 55 percent to 960 px or 70 percent, never leaving the results list under 320 px while the inspector is a column; its handle is the shared resizer, whose grip brightens on hover and focus. New keys `pl2-write-side-view` and `pl2-library-drawer-width`; no schema change. Tests: `PromptsSidePanel.test.jsx` checks the three lists against the real `LibraryWorkspace` under three sort orders; `LibraryWorkspace.resizers.test.jsx`; `WriteSidePanel.test.jsx`; hosted gate `write-side-panel.spec.js`. Open: merge, live /app bundle check, signed-in production check |

## Session Log

[2026-03-18] [PLB] [docs] Add AGENTS baseline
[2026-03-18] [PLB] [fix] Create privacy page and fix dead nav links across all docs pages
[2026-03-18] [PLB] [fix] Prevent create pane action rows and diff output from overflowing at narrow widths
[2026-03-24] [PLB] [docs] Add Create and Evaluate Phase 0 implementation brief and docs inventory entries
[2026-03-24] [PLB] [fix] Persist Evaluate timeline filters and stabilize re-enhance mode imports
[2026-03-24] [PLB] [test] Add hook coverage for library filters, quick-inject ranking, and collection cleanup
[2026-03-24] [PLB] [test] Harden Evaluate navigation semantics with hook and header regression coverage
[2026-03-24] [PLB] [refactor] Extract CreateEditorPane, compress Create vertical stack (Phase 1 complete)
[2026-03-31] [PLB] [fix] Keep Evaluate model-compare toggle visible when persisted state stays active on filtered timelines
[2026-03-31] [PLB] [test] Expand Evaluate hook coverage for filters, pagination, and run patch updates
[2026-06-06] [PLB] [ops] Create latest-main route/CI greenline worktree from origin/main b61f254
[2026-06-06] [PLB] [fix] Add privatepolicy redirect, publish static mobile fallbacks, and prevent mobile canvas state 404s
[2026-06-06] [PLB] [fix] Restore docs lint pass and desktop isolated build dependency resolution
[2026-06-06] [PLB] [test] Verify docs check, web build, isolated desktop build, and local static route smoke
[2026-06-06] [PLB] [ci] Include macOS universal Tauri bundle paths in artifact uploads
[2026-06-06] [PLB] [build] Verify local Windows Tauri MSI/NSIS packaging and sync Cargo lock version
[2026-06-08] [PLB] [fix] Broaden preset importer to load library exports and starter library JSON
[2026-06-08] [PLB] [ops] Extend local preflight command timeout for current Vitest suite duration
[2026-06-09] [PLB] [feature] Add server-side owner Pro entitlement for verified Clerk accounts
[2026-06-09] [PLB] [landing] Refresh landing page around import packs, portable libraries, and current Pro gates
[2026-06-09] [PLB] [fix] Surface preset import failures and expand Library import regression coverage
[2026-07-26] [PLB] [fix] Make selected pad sidebar title theme-aware and stabilize row layout
[2026-07-26] [PLB] [fix] Align GitHub-social and email Clerk login entitlement persistence
[2026-07-26] [PLB] [feature] Record failed and cancelled enhance runs with enhance-mode tags in run history
[2026-07-26] [PLB] [feature] Smarter library auto-naming (headings, role preambles, no title clobbering)
[2026-07-26] [PLB] [feature] Add on-demand follow-up prompt suggestions with editor/composer chaining
[2026-07-26] [PLB] [docs] Add native Swift iPad app plan (IPAD_NATIVE_APP_PLAN.md)
[2026-07-28] [PLB] [feature] Add Recent Surface Sweep maintenance prompt to Workspace Cleanup seed library
[2026-08-02] [PLB] [review] Audit native iPad prototype branch; 3 P1/P2 issues found (011-013)
[2026-08-02] [PLB] [fix] Record failed and canceled enhance runs in native run history (011)
[2026-08-02] [PLB] [fix] Tolerate Markdown-fenced and preambled enhance contract JSON on iOS (012)
[2026-08-02] [PLB] [fix] Surface Anthropic error bodies instead of bare HTTP status codes (013)
[2026-08-02] [PLB] [test] Verify native suite on iPad Pro simulator, 14/14 passing
[2026-08-08] [PLB] [feature] Add Dave's project-specific verify-only prompt instruments starter library
[2026-08-09] [PLB] [build] Complete Node 22 remediation: engines/guards/CI to 22.x, four pinned upgrades, lockfiles regenerated, dependency-health workflow, audit gate zero high/critical
[2026-08-09] [PLB] [landing] Reconcile the landing redesign with Node 22 and the shared dependency health gate
[2026-08-09] [PLB] [ios] Reconcile the universal native prototype with the verified landing and Node 22 release baseline
[2026-08-09] [PLB] [feature] Prompt CI: automated trait/exclusion verdicts, suite badges, golden regression guard, verdict/regression timeline filters
[2026-08-11] [PLB] [review] Behavioral path & failure audit across all surfaces; 19 confirmed defects (6 P1 / 10 P2 / 3 P3), release recommendation Hold
[2026-08-12] [PLB] [fix] Repair all six P1 audit defects (PLB-001…006): pad naming dialog, transport-level cancellation, acknowledged Library/Notebook persistence, multi-tab pad merge, truthful billing-disabled UI (issues 014-019)
[2026-08-12] [PLB] [test] Add plbAuditFixes regression suite (12 tests); extension 566+207 passing, API safety 66/66
[2026-08-12] [PLB] [docs] Record the behavioral audit and remediation status; update changelogs and architecture contracts (PR #35)
[2026-08-09] [PLB] [feature] Model Arena: per-side provider/model selection in A/B via getConfiguredProviders; arena runs land in prompt-scoped history
[2026-08-09] [PLB] [feature] Pack Studio: pl2-packs registry, publish selected prompts as schema-valid packs, pack uninstall
[2026-08-09] [PLB] [feature] Prompt Chains: chain runner wired into the trace layer (runs store v4), Composer Save-as-Chain + Chain Lab
[2026-08-09] [PLB] [feature] Capture Page: activeTab selection into {{context}} with PII gate (extension surface)
[2026-08-10] [PLB] [security] Add persistent service-wide hosted-provider budget cap and input-size ceiling
[2026-08-10] [PLB] [test] Restore legacy and desktop smoke coverage, add hosted web/mobile E2E, and prevent stale mobile outputs across Composer handoffs
[2026-08-10] [PLB] [fix] Extend bounded hosted Anthropic streaming window and classify interrupted streams as retryable network failures
[2026-08-10] [PLB] [fix] Recover complete enhanced prompts from max-token-truncated hosted JSON without increasing paid output limits
[2026-08-12] [PLB] [ops] Standardize and operationalize user-facing Codex session naming across local, worktree, and cloud tasks
[2026-09-22] [PLB] [fix] Attribute hosted proxy 429s to Prompt Lab with cause-specific reset time and recovery (020)
[2026-09-23] [PLB] [fix] Stop auto-retrying 429s, count hosted daily quota only after validation, and show remaining hosted quota in the UI (021)
[2026-10-05] [PLB] [fix] Capture whole secret values, detect bare Bearer tokens, redact parenthesized phones as one span, and resolve overlapping findings in the PII engine (022)
[2026-10-05] [PLB] [test] Add PII engine regression coverage across the engine, payload and Redact & Send paths
[2026-10-05] [PLB] [fix] Replace the unlisted OpenRouter default model slug with anthropic/claude-sonnet-4.6 and read a stored copy of the old default as the new one (023)
[2026-10-05] [PLB] [build] Unblock the dependency audit gate: bump undici to 7.30.0 and accept the unfixable braces advisory only while dev-only, until 2026-11-05 (025)
[2026-10-07] [PLB] [fix] Journal desktop Library state to strict IndexedDB to recover dropped WebView2 localStorage batches; writes still in flight at close remain at risk. Add Enhance timeout diagnostics to native acceptance (026)
[2026-10-05] [PLB] [fix] Make the Library Tests tab create, edit, run and delete test cases so Run Cases has cases to run; guard Use with an undo draft and disable Run while a run is in flight (024)
[2026-10-05] [PLB] [test] Add TestCasesPanel, Library case-workflow and App-wiring Vitest suites plus a Playwright spec wired into desktop-build CI so an unreachable Add Case control fails the build (024)
[2026-10-06] [PLB] [build] Add scripts/eval-davellm.mjs: Library Test cases through DaveLLM's stateless /eval/chat, scored with the app's Enhance payload, PII gate, parser and checkTraits; node --test suite wired into Extension CI (DaveLLM DL-EVAL-01 milestone 2)
[2026-10-06] [PLB] [build] Clear the audit gate again: bump source-map-js to 1.2.2 in extension, web and desktop lockfiles (GHSA-68fv-2mgg-jv7q, high)
[2026-10-06] [PLB] [docs] Mark DECISIONS.md D-003 and the EXECUTION_PRD DaveLLM integration (DLM-1 to DLM-4) superseded: Tailscale-resolved nodes, no Ollama dialect, eval through /eval/chat

[2026-10-07] [PLB] [fix] Apply PL-DUR-1A: gate desktop save receipts on durable commits, retain visible failure and draft state, coalesce/retry without duplicate entries or versions; extend interrupted-write and installed fixture acceptance (026)

[2026-10-07] [PLB] [release] Merge PR #132 after strict-save acknowledgement and both Windows installer acceptance passed; retain independent Enhance/signing/platform gaps

[2026-10-14] [PLB] [fix] Send one Stripe Idempotency-Key per Clerk identity on customer creation and retry in-flight 409s so concurrent first billing requests share one customer (027)

[2026-10-14] [PLB] [fix] Return checkoutDisabled instead of billingDisabled from checkout when webhook signing or durable storage is missing, keeping purchase management available (028)

[2026-10-14] [PLB] [release] Merge PR #148 as b913eb7 after all 14 checks passed and the Codex backoff finding was fixed; production READY. Live/test-mode Stripe concurrency (027) and a preview run without the webhook secret (028) remain open

[2026-10-15] [PLB] [fix] Keep Library tile actions in flow so card metadata no longer draws under Editor/Copy/Favorite, and give the floating inspector an opaque surface between 701 and 1100 px (029, 030)

[2026-10-15] [PLB] [test] Add e2e/library-layout-overlap.spec.js to desktop-build CI: rendered-box overlap checks at five widths and inspector opacity in both themes

[2026-10-15] [PLB] [release] Merge PR #151 as 8eceda5 after all 14 checks passed; production READY with both CSS fixes live. A signed-in visual check of the production Library (029, 030) remains open

[2026-10-15] [PLB] [fix] Name the page that holds pending import conflict choices and add Jump to unresolved, which pages to and focuses the next pending prompt, in the Library import review (031)

[2026-10-17] [PLB] [release] Merge PR #154 as d2dc37a after all 13 checks passed; the production bundle carries Jump to unresolved. A signed-in production import with a pending conflict beyond page 1 (031) remains open

[2026-10-17] [PLB] [docs] Record DEC-01 as D-013: the refinement workspace mockup folds into Create as the slice 2 reference; add slice 2 acceptance to the Enhance brief and open D-ENH-5 and D-ENH-6 (D-014)

[2026-10-17] [PLB] [docs] Plan Dave's Create annotations C1 to C7 and M1 into Enhance slices 2, 2A and 3 with code evidence, record the full 16-item annotation table, and open D-ENH-7 and D-ENH-8 (D-015)

[2026-10-18] [PLB] [docs] Record D-ENH-5 to D-ENH-8 (B, A, A, B): graphite Create held until the Library palette work lands, two panes, slice 2A first, hosted web in both layouts

[2026-10-18] [PLB] [feature] Build Enhance slice 2A on hosted web: collapsible Prompt shortcuts (C6) and a persistent editing context bar (C7), plus an explicit Save label in the stacked candidate toolbar

[2026-10-18] [PLB] [ops] Adopt emoji/project, uppercase phase, concise title and MM-DD naming; preserve manual task names and remove conflicting status-title rules

[2026-10-18] [PLB] [feature] Implement Library L1 to L8: drawer, inspector resizing, unified navigation, palettes, portable artwork and stable folders, compact/gallery views, and synchronized 1.8.0 development identity

[2026-10-18] [PLB] [release] Deliver Library L1–L8 through PR170/171: drawer, inspector sizing, unified navigation, palettes, portable artwork and nested folder IDs, four views and version guards. All 16 PR171 checks and four production Library scenarios pass; MSI/NSIS/DEB/AppImage acceptance and macOS packaging pass. Retain physical/human/macOS-interaction and tagged-release gates.

[2026-10-23] [PLB] [docs] Open D-016 (account library sync backend, mirrors DEC-87) and add docs/account-library-sync.md plus docs/account-library-sync-slices.md: Neon Postgres behind /api/library, opt-in, client-side merge, five Codex slices. No runtime change; nothing ships until D-016 is made

[2026-10-26] [PLB] [build] Remove the withdrawn braces audit exception with Dave approval; preserve generic exception safeguards and add four default-policy regressions before and after its former expiry (025).

[2026-10-26] [PLB] [fix] Keep chain substitutions literal: one-pass callback fill for `{{prev}}`, `{{input}}` and mapped variables so dollar sequences and inserted placeholder text survive between steps; four regression tests (032, PR #215). The progress renderer now embeds the snapshot with split/join, because `String.replace` had copied the page script into the JSON when issue text contained `$'`.

[2026-10-26] [PLB] [fix] Merge PR #217 as f2a33d9: failed, canceled and blocked runs no longer become the Create draft title or the golden comparison text (033). A signed-in production check of a forced Enhance failure remains open

[2026-10-26] [PLB] [docs] Triage the October Scratch intake list (PR #221, merge `e6a880f`): 23 requests rated, slices 0 to 7 specified in `docs/OCTOBER_INTAKE_BRIEF.md`, D-017 opened; Dave approved every recommended option the same day (recorded in PR #222). Eight Issue Backlog rows created and three updated with the decisions.

[2026-10-26] [PLB] [fix] Merge PR #222 as `6ea5f6f`: a new draft's title and comparison text come only from its own runs (034). Production bundle verified; a signed-in production run remains open.

[2026-10-26] [PLB] [fix] Keep Library template values literal: `fillTemplateVars` fills `{{name}}` placeholders in one pass with a callback, so dollar sequences in typed or `{{clipboard}}` values and inserted placeholder text survive; nine regression tests (035, PR #220).

[2026-10-26] [PLB] [feature] Merge PR #223 as `ee9916c`: Scratch notes beside Write, with compact one-line note rows and resizable panels (036, October intake Slice 1). Two Codex save findings and a 320x256 layout gate failure were fixed before merge. A signed-in production check remains open.
