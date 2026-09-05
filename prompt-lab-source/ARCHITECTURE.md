# Prompt Lab Architecture

## Overview

Prompt Lab has five user-facing runtime surfaces plus a public landing page:

- Chrome / Vivaldi extension: MV3 side panel build using the shared React workbench
- Desktop app: Tauri 2 wrapper using the shared React workbench
- Hosted web app: the shared React workbench at `https://promptlab.tools/app/`
- React mobile prototype: a separate touch-first React UI at `https://promptlab.tools/mobile/`
- Native iPhone/iPad app: a focused SwiftUI app for iOS/iPadOS 17+
- Public landing page: marketing and onboarding at `https://promptlab.tools/`

The extension, desktop, and hosted `/app/` shells share the React application in `prompt-lab-extension/src/`. The React mobile prototype has its own UI but imports selected shared provider utilities. The native app shares versioned JSON contracts, not React UI code. Production `promptlab.tools` routes are served by Vercel; GitHub Pages builds the generated `docs/` mirror but is not the production-domain host.

## Repo layout

- `prompt-lab-extension/`
  - Primary frontend package
  - Vite build for the extension panel
  - Vitest + RTL tests
  - Playwright extension smoke test
- `prompt-lab-extension/src/`
  - Shared React UI, hooks, utilities, provider logic, storage helpers
- `prompt-lab-extension/extension/`
  - MV3 assets such as `manifest.json`, `background.js`, icons, and options page files
- `prompt-lab-desktop/`
  - Tauri shell that loads `../prompt-lab-extension/src/main.jsx`
  - Desktop packaging config and native bundle settings
- `prompt-lab-web/`
  - Public web deploy package
  - `index.html` is the landing page served at `/`
  - `app/index.html` is the shared React app shell served at `/app/`
  - `mobile/` is the separate React mobile prototype served at `/mobile/`
  - `public/` holds static assets copied into the deployed site root
  - Vite config sets `VITE_WEB_MODE=true` to activate proxy fetch injection in the app shell
- `api/`
  - Vercel Edge Function CORS proxy at `api/proxy.js`
- `vercel.json`
  - Root Vercel build config for the hosted web deployment
- `.github/workflows/`
  - Web, extension, desktop, native, docs, dependency, API, and release workflows
- `../prompt-lab-ios/`
  - Native SwiftUI iPhone/iPad app, SwiftData models, Keychain storage, and XCTest suites
- `../contracts/promptlab-enhance-contract-v1.json`
  - Versioned React/native enhance contract fixture

## Runtime model

### Shared frontend

The main React workbench is written once and reused by the extension, desktop, and hosted `/app/` targets.

- `src/App.jsx` is the primary surface
- `src/hooks/` manages editor, library, eval run, and test case state
- `src/lib/` contains utilities, provider modules, platform adapters, and the PII engine

### Extension path

The extension uses MV3 primitives:

- `chrome.storage.local` for provider settings and extension state
- `background.js` as the network boundary for provider API calls
  - `MODEL_REQUEST` messages carry a `requestId`; the worker keeps an
    `AbortController` per in-flight request and a `MODEL_ABORT` message aborts
    the underlying provider fetch, so a UI cancel terminates the real request
- `options.html` / `options.js` for provider configuration
- `panel.html` as the side panel entry point

### Desktop path

The desktop app uses Tauri plus local browser storage:

- `prompt-lab-desktop/index.html` imports `../prompt-lab-extension/src/main.jsx`
- `src/lib/desktopApi.js` stores provider settings in localStorage under `pl2-provider-settings`
- `src/lib/platform.js` switches behavior between extension and desktop flows
- Desktop settings are exposed through an in-app modal instead of the extension options page

### Web path

The hosted web deployment is split into a landing route and an app route:

- `prompt-lab-web/index.html` is the public landing page for `https://promptlab.tools/`
- `prompt-lab-web/app/index.html` loads `prompt-lab-web/app/main-web.jsx`, which mounts the shared `App` and `ErrorBoundary` and imports the shared styles; the route is currently served publicly at `https://promptlab.tools/app/`
- `prompt-lab-web/public/` provides shared static assets such as fonts and social images
- `src/lib/desktopApi.js` detects web mode via `VITE_WEB_MODE` and injects a proxy-aware fetch wrapper
- `src/lib/proxyFetch.js` reroutes provider API requests through `/api/proxy` to bypass CORS, forwarding the caller's `AbortSignal` so cancellation reaches the proxy transport
- `api/proxy.js` is a Vercel Edge Function that validates the target domain against an allowlist, injects the hosted Anthropic key only when needed, and forwards the request
- `vercel.json` rewrites `/app` and `/app/(.*)` to `/app/index.html`
- Hosted web currently defaults to Anthropic and can use either the shared server key or a user-supplied Anthropic key
- Extension and desktop continue to expose the full provider list, including direct Ollama access

### React mobile prototype path

- `prompt-lab-web/mobile/MobileApp.jsx` is a separate touch-first UI, not the shared workbench
- `mobileProvider.js` imports shared Anthropic/provider helpers from the extension source
- Vite builds `mobile/index.html` as a third web entry and Vercel rewrites `/mobile` to it
- The prototype is a public evaluation surface, not an App Store or installed mobile release
- `mobile.promptlab.tools` has a host rewrite in `vercel.json`, but the verified public route is `https://promptlab.tools/mobile/`; separate subdomain DNS is not configured

### Native iPhone/iPad path

- `prompt-lab-ios/` is a universal SwiftUI app for iOS/iPadOS 17+
- It uses SwiftData for prompts, pads, and run history and Keychain for the Anthropic key
- It currently supports Anthropic only and deliberately excludes A/B compare, composer chains, billing, telemetry, PII scanning, and other providers
- `contracts/promptlab-enhance-contract-v1.json` is the compatibility boundary enforced by Vitest and XCTest
- M0 through M3 are implemented; TestFlight/App Store distribution remains blocked on owner-supplied release inputs

## Platform runtime model

| Platform | API path | Public backend? |
|----------|----------|-----------------|
| Extension | Service worker → provider | No |
| Desktop | Native fetch → provider | No |
| Hosted web app | Vercel Edge proxy → Anthropic | Yes (`api/proxy.js`) |
| React mobile prototype | Vercel Edge proxy → Anthropic | Yes (`api/proxy.js`) |
| Native iPhone/iPad | URLSession → Anthropic | No |
| Prompt Lab Server (proposed) | Server process → provider | No (self-hosted) |

The extension and desktop shells call provider APIs directly from the client with no intermediary. The hosted web app and React mobile prototype route Anthropic traffic through a Vercel Edge Function proxy to bypass browser CORS restrictions. The native app calls Anthropic directly with a Keychain-backed BYO key. Prompt Lab Server remains a proposal, not a shipped runtime.

## Providers

Provider support is not uniform across surfaces. The extension and desktop
shells call five providers directly with a bring-your-own key; the hosted web
and React mobile surfaces reach Anthropic only, because that is the sole host
`api/proxy.js` will forward to.

| Provider | Extension · desktop | Hosted web · mobile | Native iPhone/iPad |
| --- | --- | --- | --- |
| Anthropic | Yes | Yes, via `api/proxy.js` | Yes |
| OpenAI | Yes | No | No |
| Google Gemini | Yes | No | No |
| OpenRouter | Yes | No | No |
| Ollama | Yes, local | No | No |

The proxy validates the target against `SUPPORTED_HOST` (`api.anthropic.com`)
and `SUPPORTED_PATH` (`/v1/messages`), and restricts models to
`HOSTED_ALLOWED_ANTHROPIC_MODELS`, which defaults to `claude-sonnet-4-6` alone.
A hosted client may send the `__plb_hosted_shared_key__` placeholder instead of
a real key; the proxy strips it and substitutes the server-side
`ANTHROPIC_API_KEY`, so hosted usage does not require the visitor to hold a
provider key. User-supplied keys are never persisted server-side.

Provider-specific request behavior is routed through shared provider abstraction modules rather than being inlined in the app surface.

Transport verification contracts:

- The assembled extension still copies the standalone adapters in
  `prompt-lab-extension/extension/lib/`; they predate the descriptor-based shared
  adapters and differ in response metadata/error normalization. Cancellation is
  patched at that dispatch boundary to preserve its existing nonstreaming
  behavior. `packagedProviderCancellation.test.js` imports a fresh assembled
  artifact and runs the same five-provider abort contract against both adapters.
  Consolidating their other behavior requires explicit parity work.
- Shared streaming adapters require Anthropic `message_stop` or OpenAI-compatible
  `[DONE]` completion. Error events, malformed complete frames, and EOF without
  completion fail the attempt. Partial text remains available as an incomplete
  preview and failed history output; it is never committed as a successful
  enhancement or silently retried. User cancellation remains nonretryable.
- Protocol references: [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
  [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create),
  [OpenRouter streaming](https://openrouter.ai/docs/api_reference/streaming).

## Persistence

- Prompt library and app state use local browser persistence in the shared app
- Experiment and eval data use the experiment store layer
- Extension provider settings use `chrome.storage.local`
- Desktop provider settings use localStorage
- The React mobile prototype stores its local workspace in browser storage
- The native app uses SwiftData and stores its provider key in Keychain

Persistence contracts (post 2026-08 behavioral-audit remediation):

- Permanent Library deletion uses append-only `pl2-library-deleted:<id>` keys
  with value `1`; the marker contains no title or body. Clear Library appends a
  `pl2-library-clear:<counter>:<uuid>` key. A logical counter and deterministic
  UUID tie-break order concurrent clears without trusting wall-clock time.
  Live/trash records carry `metadata.libraryGeneration`; missing values mean
  the original generation. Readers, storage-event adoption, and delayed writes
  exclude deleted IDs and records from earlier clear generations.
- Deletion metadata is not compacted. Older clients can still write legacy
  arrays, but updated clients reject stale generations and scrub those arrays.
  Reload older tabs before editing after a clear; mixed-version clients cannot
  be made to honor a contract absent from their code. Explicit new imports are
  a separate operation from replaying an old replica. Workspace exports do not
  transfer one installation's permanent-deletion log to another installation.
- Workspace import prepares stable IDs before writes. Prompt deduplication maps
  runs and test cases to the surviving prompt; version references resolve only
  to a matching stored snapshot. Scratch links and imported result/golden run
  references follow the same ID maps. Missing source references are reported in
  import feedback and retained as unresolved notes/metadata rather than linked
  to an unrelated record. Conflicting IDs allocate new identities.
- An explicit backup import joins the current clear generation and allocates a
  fresh ID for a permanently deleted prompt. Multi-store import is not atomic:
  failures retain the prepared file/IDs for **Retry import** in Settings, and
  completion is reported only after every write is acknowledged. Recovery is
  session-local; keep the tab open until it completes.
- Experiment-store writes reject on fallback storage failure. A session-local
  recovery queue retains the normalized record and its ID; retrying only repeats
  persistence, never provider execution. Same-record writes are serialized and
  newer edits supersede failed older writes. A visible retry notice and unload
  warning remain while records are unsaved; this queue does not survive tab close.
- Scratch migration keeps readable notes in memory when saving the upgrade fails.
  Unreadable storage is preserved and blocks editing until loading succeeds.
- Writes are acknowledged: Library saves and Notebook autosaves attempt the
  storage write first and only report success when it lands. Rejected writes
  (e.g. `QuotaExceededError`) surface a visible failure and keep the unsaved
  buffer recoverable.
- Notebook pads (`pl2-pads`) carry a revision counter. Writes re-read the stored
  payload and merge per pad (newest timestamp wins, except the pad being
  mutated), and a `storage`-event listener adopts other tabs' writes live, so
  concurrent tabs merge instead of last-writer-wins. Same-pad conflicts warn.

## Safety layers

- Provider traffic is routed through controlled adapters
- PII detection and redaction use the shared `src/lib/piiEngine.js`
- The extension manifest keeps permissions narrow and host access explicit
- `api/_lib/allowedOrigins.js` is the single request-origin allow-list shared by
  `/api/proxy` and `/api/telemetry`. It admits the production web origin, the
  mobile web origin, `PROMPTLAB_WEB_ORIGIN` / `VITE_PROMPTLAB_WEB_ORIGIN`, the
  comma-separated `PROMPTLAB_PROXY_ALLOWED_ORIGINS` list (including exact
  `chrome-extension://<32 a-p>` ids), and localhost outside production. A
  request with a missing or unlisted origin is rejected with 403 and never
  receives an `Access-Control-Allow-Origin` header — the allowed origin is
  echoed explicitly and a wildcard is never emitted

## Testing

Current automated coverage includes:

- Vitest + React Testing Library for hooks, providers, schemas, storage, and utilities
- Playwright smoke coverage for the extension enhance flow
- CI workflows for extension verification and desktop build packaging
- Hosted web/mobile build and browser coverage
- Native XCTest unit/UI coverage on iPhone and iPad simulator families
- Cross-surface enhance-contract parity tests

## Sensitive preflight and request ownership

Shared Enhance (including mode-specific and supplied payloads) and Arena use
`useSensitivePreflight` with the existing `piiScanner` policy. Each warning owns
an immutable payload, its editor/variant context, and a private one-use dispatch
continuation. Run All queues warnings per variant. Send Anyway and Redact & Send
consume only the displayed ticket; cancellation, source edits, provider selection
changes, provider settings changes, and unmount revoke stale approval. Provider
credentials never enter tickets or run metadata. Test cases retain their existing
block-without-override policy. Native policy scope is unchanged.

Arena uses object lifetime tokens and an AbortController per attempt. Editing,
reloading, removing, or resetting a variant invalidates its attempt; recreating a
label cannot revive an older token. History uses the captured source and actual
sent input, including redaction. Enhance invalidates active work when its source
input, prompt identity, or mode changes and releases its synchronous dispatch guard.

The native `WorkbenchStore` captures input, prompt ID/title, and mode before task
suspension. Each attempt accumulates its own partial stream. Navigation and edits
cancel and invalidate ownership; late cancellation/error history retains the old
source, while only the current owner can update the editor or clear its task handle.

## Workspace import preview and acknowledged stages

Raw Library import normalizes its source once and prepares a read-only preview.
Exact full-body duplicates default to Skip; title/ID conflicts require an explicit
Keep both, Replace existing, or Skip incoming choice. Matching uses the canonical
Library normalization. Replace retains the target ID, creation date, restore
counter, and previous versions; incoming history is mapped to matching snapshots.
Skip on a different-body conflict excludes that source's incoming test cases and
runs. Exact-body Skip instead maps associated history to the surviving prompt.

Apply rereads the Library, deletion markers/generation, related records, and
workspace extras. A changed revision rebuilds the preview and requires renewed
confirmation. Cancel before writes has no import side effects. Successful storage
stages and individual history writes are acknowledged separately; retries retain
prepared IDs and skip completed stages. Closing a partially applied import retains
its pending operation in the tab and does not imply rollback. Scratch and pack
registry replacement are disclosed explicitly before Apply. Preview rows paginate
so large files do not mount an unbounded list of conflict controls.
