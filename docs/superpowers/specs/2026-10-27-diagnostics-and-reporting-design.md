# Prompt Lab diagnostics and user reporting

Date: October 27, 2026. Status: approved by Dave in this chat on October 27, 2026.

## Outcome

Make failures diagnosable across desktop, extension and hosted web, including the observed native renderer freeze. Give users a visible way to describe a problem, review diagnostic information, save a report, and open a GitHub issue draft. Keep the Quick-row repair in PR233 separate.

## Recommended approach

Use local structured diagnostics with a native desktop watchdog and user-controlled report export. Console-only logging cannot explain a frozen renderer after restart. A hosted monitoring service could centralize incidents, but adds data transmission, service configuration and retention obligations; it is not needed for this first delivery.

## Diagnostic contract

- Each event has a schema version, UTC timestamp, monotonic duration where relevant, application version, exact source revision, surface, random session ID, operation ID, event code, severity and allowlisted metadata.
- Record startup/shutdown, renderer readiness, React boundary failures, uncaught JavaScript errors, rejected promises, storage failures, operation start/end/cancel/error, and classified network failures. Provider/model, status code and duration are allowed; prompt titles, text, outputs, keys, headers, request/response bodies, account identifiers and URL query strings are excluded.
- Stack evidence contains normalized application asset/frame references and line/column information. Remove user filesystem paths and omit uncontrolled error values. The logger accepts structured allowlisted fields rather than serializing arbitrary objects or console arguments.
- Desktop writes bounded JSONL files under the OS application log directory. Rotate at 2 MiB, retain at most five files, and prune entries older than seven days. Browser surfaces retain a bounded local ring, capped at 1,000 events and 1 MiB. Logging is best-effort and cannot cause an application failure or a recursive logging loop. Report export makes write/read failures visible rather than claiming completeness.
- Preserve exact-build symbolication information in restricted CI artifacts; exclude source maps from deployed/distributed application output. Reports identify the revision needed to retrieve those artifacts.

## Desktop freeze evidence

- A Rust-side monitor runs independently of the renderer. The renderer sends a small heartbeat with UI visibility and the current allowlisted operation code.
- A visible-window heartbeat gap of at least 15 seconds records a suspected renderer hang, once per episode, and records recovery if heartbeats resume. Sleep/resume or background throttling must not be presented as proof of a hang.
- Where supported, capture resource measurements for the app and its own WebView processes only. Do not inventory unrelated running applications. Record the source and limitations of each measurement.
- A session marker distinguishes orderly shutdown from an interrupted session. An unclean marker is evidence of interruption, not a definitive crash classification.
- Native Help offers an Export diagnostics action independent of the renderer; after restart the report can include the previous session. No automatic process termination, data reset or hidden restart.

## User reporting

- Add an accessible Report a problem entry in the shared Help surface, a desktop native menu entry, and an action on the error boundary. Keep report controls outside the failing application subtree where practical.
- The form asks what happened, expected behavior and optional reproduction steps. It displays the report ID, build and summary of included diagnostic metadata. Users can preview the complete export before saving or copying it.
- Save a readable summary plus machine-readable JSON bundle locally. Include only the relevant bounded event window and explicit user-entered report text. Screenshots and prompt/output content are never collected automatically.
- Offer Open GitHub issue draft using the existing repository issue destination. Prefill a short reviewed summary and report ID, not diagnostic logs or sensitive data in URL parameters. The user submits the issue and chooses any attachment themselves. No new backend, automatic issue creation or automatic upload.

## Validation and delivery

- Test schema allowlisting and adversarial secret/prompt canaries, including nested objects, URLs, error messages and stacks.
- Test retention/rotation, quota exhaustion, denied writes, corrupt prior logs, repeated logger initialization, and non-recursive failure handling.
- Test heartbeat loss/recovery, background state and sleep/resume classification with deterministic clocks.
- Exercise a deliberate renderer stall only in a disposable installed Windows test profile. Verify native evidence survives restart and can be exported without using the renderer.
- Test report keyboard navigation, preview, export, clipboard failure and the error-boundary route across the supported shells. Verify reports contain no test secrets or prompt canaries.
- Require normal CI, relevant native acceptance, reviewed diffs and current build identity. Install the accepted Windows package and verify logging/report export. Record any unsupported platform evidence explicitly.

## Scope boundaries

This work adds evidence and a reporting path. It does not claim to identify the root cause of the earlier freeze. It does not change analytics consent, authentication, billing, saved prompt formats or existing user data.

