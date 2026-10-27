# Diagnostics and Reporting Implementation Plan

> Execute serially in the owned checkout. No subagents are authorized.

**Goal:** Persist useful, privacy-bounded failure evidence and let users preview and export reports, including after a desktop renderer freeze.

**Architecture:** Shared JavaScript owns the event schema, bounded browser ring and report UI. A desktop-only bridge forwards events and heartbeats to Rust, which owns rotating files, interrupted-session detection, an independent watchdog and native export. Logging failures remain isolated from application work.

**Tech stack:** Existing React/Vite/Vitest/Playwright, Tauri 2, Rust standard library and existing serde dependencies.

## 1. Shared event contract and persistence

- [ ] Add `prompt-lab-source/prompt-lab-extension/src/lib/diagnostics.js` with explicit event/metadata allowlists, frame normalization, session/operation IDs, bounded storage, failure counters, exception capture and idempotent startup.
- [ ] Add `src/tests/diagnostics.test.js`: secret and prompt canaries, arbitrary nested payload rejection, quota failures, corrupt journals, count/byte/time retention and duplicate initialization. Run `npx vitest run src/tests/diagnostics.test.js` before and after implementation.
- [ ] Update existing `lib/logger.js`, `ErrorBoundary.jsx`, startup entry points and provider operation boundaries to use the structured recorder without persisting raw errors or payloads.

## 2. Native persistence and watchdog

- [ ] Add `prompt-lab-source/prompt-lab-desktop/src-tauri/src/diagnostics.rs`. Validate incoming event fields independently; rotate fixed app-owned log filenames, retain seven days/five files, mark session lifecycle, record panic classification and detect stale visible-window heartbeats outside the renderer.
- [ ] Expose only record, heartbeat, read/report and native export commands. Export filenames are generated under the app log directory; JavaScript cannot choose an arbitrary filesystem destination.
- [ ] Add a native Help menu export item independent of React. Build a desktop bootstrap bridge importing the existing Tauri core/event APIs; shared browser builds must not require the Tauri package.
- [ ] Unit-test rotation, denied/corrupt storage behavior, schema rejection and watchdog transitions using temporary directories and explicit times. Run `cargo test` against the desktop manifest, followed by a native build.

## 3. User report UI

- [ ] Add `ReportProblemHost.jsx` outside the application's error boundary and a visible shared header trigger. Reuse `useDialogA11y` for focus containment, Escape and focus restoration.
- [ ] Collect explicit user descriptions separately from automatic evidence; show a full preview, missing-evidence warnings, report/build identifiers, local JSON export and copy actions. Open an existing GitHub issue draft only after preview, with a short summary/report ID rather than logs or prompt content in its URL.
- [ ] Add tests for keyboard behavior, report preview, failed clipboard/export, no network submission and error-boundary accessibility.

## 4. Symbolication and evidence

- [ ] Add a build helper that produces hidden source maps, moves them outside distributed output and groups them by revision/surface. Upload those files as CI artifacts in the existing extension, hosted and desktop build jobs. Test that normal distributions contain neither source maps nor source-map references.
- [ ] Document event codes, retention, log locations, report workflow, limitations and the reproduction procedure for a disposable renderer hang.

## 5. Acceptance and delivery

- [ ] Run focused JavaScript/Rust tests, full affected CI and cross-surface builds. Exercise an intentional renderer stall only in a disposable native profile; require persisted watchdog evidence and export after restart.
- [ ] Review diffs, privacy canaries, permissions and artifact contents; deliver through normal PR checks. Install the accepted Windows build and verify the Report a problem flow, diagnostics export and retained user data.
- [ ] Reconcile existing Notion records, refresh the complete progress snapshot, preserve all plan identities and report any remaining unverified platform behavior explicitly.
