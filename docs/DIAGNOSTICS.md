# Local diagnostics and problem reports

Choose **Report** in the app header or **Report a problem** on an error screen. Describe the problem, preview the complete report, then copy or export it. The GitHub link opens an issue draft containing only a report ID and build information. The user chooses what to attach and submits it. There is no automatic upload.

Desktop also provides **Help → Export diagnostics and open folder**. That native menu can export evidence while the renderer is stalled. It contains automatic evidence only; review the JSON before sharing it. If disk access fails, no saved-file confirmation is shown. The normal report form offers copy as a fallback.

## Evidence and limits

Events include build/revision, session and operation IDs, UTC timestamps, event codes, operation durations/status, error class and allowlisted application frame basename/line/column. Arbitrary error messages, prompt/output text, API keys, request bodies, headers, account identifiers and URLs are excluded automatically. The description is explicitly entered by the user and included in the preview.

Browser evidence is held in a localStorage ring capped at 1,000 events, 1 MiB and seven days. Writes and corrupt storage fail safely into memory with a visible warning. Event recording is limited to 20 events per second; dropped-event counts are included. Native evidence uses Tauri's platform app log directory (Windows: `%LOCALAPPDATA%\com.promptlab.desktop\logs`, macOS: `~/Library/Logs/com.promptlab.desktop`, Linux: the app log directory under the XDG data/cache location). The actual acknowledged export path is shown by the form. Native files are `diagnostics-0.jsonl` through `diagnostics-4.jsonl`, at most 2 MiB each; seven-day pruning runs on startup/write. Generated exports retain at most five files for seven days. User-copied exports elsewhere are under the user's control.

A native thread samples heartbeat freshness every two seconds. A visible renderer missing heartbeats for 15 seconds produces `renderer_hang_suspected`; a later heartbeat records recovery. Minimized/hidden windows are suppressed, and long native monitor gaps restart observation to avoid treating sleep as a definite hang. A hang suspicion is evidence, not a diagnosis. A leftover session marker records an interrupted session on next launch. Native panics record classification without their potentially private payload.

Renderer JavaScript heap is sampled when the WebView exposes it. Process CPU/RSS, native dumps, provider payloads and full system inventories are not collected. No logging system can reconstruct the earlier freeze before it was installed. Diagnose future incidents by matching report timestamps, operation IDs and exact build/asset identities; compare heap samples and hang/recovery/interrupted-session events.

## Source maps and verification

Builds produce hidden source maps and move them outside every distributable into `.diagnostic-source-maps/<revision>/<surface>`. CI retains separate map artifacts for 30 days with a manifest of compiled asset SHA256 hashes. Match the exact asset filename and hash before symbolication; never use maps from a different build or environment. CI web maps describe the CI build; independently built production assets may differ and require reproduction with the production build environment. Maps are not shipped to browsers or inside installers.

Unit tests cover allowlisting, correlation, retention, storage/write failure, export equivalence and watchdog timing/sleep behavior. Shared UI tests cover the crash-screen entry point, preview, keyboard focus and failed export/copy feedback. Disposable Windows/Linux CI additionally blocks the renderer for 19 seconds and checks independent hang/recovery evidence, private canary exclusion and exact saved-preview equivalence. This deliberate stall must not run against a working user profile.
