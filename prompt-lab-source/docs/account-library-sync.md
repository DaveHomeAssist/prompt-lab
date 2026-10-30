# Library storage and account sync

Status: implementation in progress, acceptance incomplete. Dave authorized all planned phases on October 28, 2026. Draft PR248 contains isolated A1/A2 candidates; no app or personal folder is connected. The October 23 reconciliation against `main` `faea576` established the folder-first sequence. The [current build status](account-library-sync-slices.md#implementation-progress-october-28) separates implementation from acceptance. No paid provisioning is authorized.

This remains the canonical proposal at its existing path. [D-016](DECISIONS.md) records the selected sequence and remaining hosted decisions. [Build slices](account-library-sync-slices.md) replace the earlier web-first instructions. The [original proposal](https://github.com/DaveHomeAssist/prompt-lab/blob/7a1ad40/prompt-lab-source/docs/account-library-sync.md) and [original slices](https://github.com/DaveHomeAssist/prompt-lab/blob/7a1ad40/prompt-lab-source/docs/account-library-sync-slices.md) remain historical evidence, not executable instructions.

## Problem and outcome

The library currently belongs to a browser profile. An export can transfer it but cannot serve as its live storage. Users need a durable location they own, automatic saves and recovery, and supported access for the app and agents without controlling a browser or editing its private storage.

Deliver one logical library with a stable `libraryId`, one revision graph and one command service. Storage adapters persist that library. The app and supported API must use the same service, validation, conflict checks, history and commit receipts. A local cache, offline pending edits and a hosted replica are never independently presented as a second authoritative library.

## Scope and preservation contract

Both phases preserve the complete workspace, not only current prompt text:

| Data | Required preservation |
| --- | --- |
| Prompts and trash | Stable IDs, original/enhanced text, variants, notes, status, tags, timestamps, usage, favorites, provenance and custom metadata |
| Version history | Every available snapshot, change note and source record; no migration or merge through the current 25-version truncation path |
| Structure and assets | Collections, stable folder IDs, packs, loaded-pack state, ordering and portable artwork or attachment references and bytes where available |
| Experiments | Runs, test cases, evaluation results and their prompt/version associations |
| Scratch | All pads, content, names and existing recovery information |
| Deletion state | Library generation, record tombstones and append-only permanent-deletion markers, including batch markers |
| Recovery | Existing backups and archives, unavailable-reference evidence, migration manifests and commit receipts |

Preserve unknown fields losslessly in the archive even when the current UI cannot render them. Missing referenced objects remain explicit gaps; never invent results or citations. Existing credentials, provider settings, billing/session tokens and telemetry state remain outside the library. Prompt content may itself be sensitive: warn and review before hosted upload, without silently rewriting it.

The current UI may show only recent versions, but the durable store retains all versions. Normal saves, imports, deduplication, restore and sync must not silently prune history or backups. Preserve pre-existing source backups in place; catalog their provenance rather than copying arbitrary neighboring files. User-requested permanent erasure is a separate confirmed operation with an honest disclosure of backup retention, not a side effect of sync or disconnect.

## Current implementation boundary

Inspected shared source still uses `pl2-library`, trash, collections and folders in browser storage; the desktop adds the IndexedDB durability journal. Runs and test cases have their own store. Import preview and application already handle conflict choices, associations and retryable stages. Reuse their semantics through a storage service rather than adding a competing raw-storage writer.

The shipped app still has no connected external-folder or account library service. Draft PR248 contains an isolated folder/API reference candidate and source inventory contract, described in [candidate boundaries](library-storage-contract-candidate.md). Unimplemented routes and app flows below remain proposed. The existing [compatibility contract](LIBRARY_COMPATIBILITY_CONTRACT.md) continues to describe shipped behavior until each phase is implemented and verified.

## Phase A: chosen iCloud Drive folder

### User flow and shell support

1. In Settings, choose Library location, then select a folder through an explicit user file picker. Do not assume a private path or choose it for Dave.
2. Inspect that folder before writing. Offer Open existing library or Create from this device. Never overwrite an existing library or auto-merge different library IDs.
3. Create an untouched source export and migration manifest, preview the full workspace transfer and any conflicts, then apply only the reviewed plan.
4. Verify object counts, IDs, history, references and content hashes after durable write and reopen. Switch the app's active library only after that readback succeeds. Keep the original browser data and source backup for rollback.
5. Display location, library identity, saved revision, pending changes, backup health and recovery actions. Distinguish Saved to folder from iCloud propagation, whose completion remains Unknown without direct evidence.

The smallest supported slice is the macOS desktop plus an opt-in local library service. The web app may connect to that service using explicit pairing and browser local-network permission. A browser cannot be assumed to retain arbitrary iCloud folder access. Unsupported browsers and shells retain current local behavior and explicit import/export; show capability limits. Qualify Windows iCloud folders and native iOS document access separately before claiming support.

### Store layout, saves and concurrency

Use a portable, versioned package of immutable content-addressed objects, commit manifests and recoverable snapshots. Keep the schema version separate from the existing workspace export version. Each commit identifies its library, parents, operation ID, complete state manifest and hashes. A mutable current-head hint is rebuildable, never the only recovery source. Avoid placing a live database with write-ahead files in an iCloud-synced folder.

One local service serializes app/API writes to the selected library. Write new objects and manifests to temporary files, flush and publish them atomically where supported, then verify readable hashes before acknowledging. Interrupted or partial writes must leave the prior commit readable. On restart, validate reachable commits and quarantine incomplete objects without deleting them. Migrations preserve the original package and write a new schema generation with rollback evidence.

A local lock does not coordinate multiple Macs through iCloud. Detect competing commit heads, divergent ancestry, iCloud conflict copies, stale file listings and missing cloud placeholders. Never use last-write-wins on the whole workspace. Preserve both branches, stop automatic reconciliation when data is unavailable, and offer a preview that retains both edits. Reconcile per record with causal revisions; clocks alone do not prove ordering. Same-ID divergent content keeps both snapshots, with explicit resolution when the intended winner is ambiguous. Trash and permanent-deletion markers prevent resurrection; recovery archives remain separate from active data.

If the folder is unavailable, permission is revoked or storage is full, show changes as Pending or Save failed. Preserve pending edits in a durable device outbox, scoped by `libraryId`, and replay against the latest revision after reconnect. Do not silently switch to a new browser library or show Saved for cache-only acknowledgement. With no acknowledged outbox, keep the draft and report failure. Reconnection and disconnect never discard pending changes.

### History and backups

Retain an append-only commit history and all available imported versions. Before migration, import, reconciliation, restore or backend switch, create a named recovery checkpoint with hashes, IDs, counts and provenance. Preserve existing backup artifacts unchanged. No automatic pruning ships in the first slice; capacity exhaustion pauses new commits honestly instead of deleting recovery data.

Restore previews a selected checkpoint and creates a new commit; it does not rewrite history. Back up before restoring. Ordinary restore respects permanent-deletion markers and reports suppressed entries. Recovery that intentionally reintroduces erased content requires a separate explicit choice. Disconnect leaves the library and backups intact. Offer a verified independent recovery export outside the live sync folder: iCloud replication alone is not an independent backup, and device-local durability does not establish cloud replication.

## Shared app and API contract

Both interfaces call the same library command service and selected adapter. There is no API-only import database, background browser-storage patching, provider execution or arbitrary filesystem/shell access. The local service remains available to API consumers while the app window is closed, if the user has enabled it. If it is stopped, return unavailable; never impersonate success from an export file.

Proposed versioned JSON surface, served only for the bound library:

| Method and route | Request | Success and evidence |
| --- | --- | --- |
| `GET /v1/library` | Authenticated read | `200`: libraryId, revision, backend, pending/conflict state, backup health; ETag |
| `GET /v1/library/snapshot` | Optional immutable revision | `200`: complete workspace manifest and paginated object references with hashes; bounded object reads |
| `POST /v1/library/previews` | Source manifest/objects, expectedRevision, explicit conflict resolutions | `201`: previewId, bound revision, source hash, counts, unresolved choices and preservation report; no active-data mutation |
| `POST /v1/library/commits` | previewId, expectedRevision; Idempotency-Key | `201`: durable receipt with operationId, libraryId, parent/result revision, backup checkpoint, counts and hashes |
| `GET /v1/library/operations/{operationId}` | Authorized operation ID | `200`: pending, failed or committed receipt, for safe retry/readback |
| `GET /v1/library/backups` | Cursor and bounded limit | `200`: checkpoint metadata and nextCursor, no unbounded bodies |
| `POST /v1/library/restores` | checkpointId and expectedRevision | `201`: restore preview; apply through the normal commit route |

Example preview request and successful commit receipt:

```json
{"sourceManifest":"sha256:source","expectedRevision":"r41","resolutions":{}}
```

```json
{"operationId":"op42","libraryId":"lib1","parentRevision":"r41","revision":"r42","state":"committed","checkpointId":"before-op42","verified":true}
```

Errors use a stable code and a readable message, for example `409 {"ok":false,"code":"REVISION_CONFLICT","error":"Library changed; preview again.","retryable":false}`. No partial import is a committed receipt. Persist operation identity with the commit so response loss/restart cannot duplicate it. Reusing a key with different input returns conflict. Exact duplicates return the original receipt. Bind previews to library identity, source hash, expected revision and resolutions; a change invalidates the preview.

| Status | Meaning |
| --- | --- |
| 400 / 422 | Malformed or unsupported input; retain the source and report fields, never drop records |
| 401 / 403 | Missing identity or denied library/scope |
| 404 | Unknown bound resource |
| 409 | Stale revision, conflicting heads, mismatched idempotency input or unresolved choices |
| 413 | Payload exceeds published limits; chunk by validated manifest without truncation |
| 429 | Limit exceeded; Retry-After |
| 503 | Disconnected, locked, unavailable store, incomplete cloud files or failed durability |

Before coding, publish OpenAPI schemas including bounded upload/object reads, limits, scopes, pagination, preview lifetime, crash recovery and error examples. A hashed complete-state revision replaces raw serialized workspace content as an external revision token.

Local access is opt-in, loopback only, with exact Host/Origin checks, narrow CORS, expiring revocable pairing and distinct scoped browser/agent credentials. Never put tokens in URLs, logs, library files or backups. Store credentials in the platform's secure credential facility. An HTTPS web app to loopback connection must pass supported-browser local-network/security testing before web support is claimed. A local API must reject LAN access and DNS rebinding attempts. No browser cookie extraction or desktop control is permitted.

## Phase B: optional hosted storage

Begin only after Phase A's folder/recovery/API acceptance passes. Add a hosted adapter using the same `libraryId`, object/history format, revisions, validation and command semantics. On October 28 Dave selected Neon with existing Clerk identity in US East, server-readable content with provider encryption at rest, retained history/backups and separately confirmed permanent erasure. No paid provisioning is authorized. Provider feasibility, limits, costs and retention facts still require verification before activation.

Hosted mode remains opt-in. Preview upload of the complete workspace, history and backup inventory, apply with revision checks, read back object/hash parity, then switch active backend. Preserve the folder package as a recovery checkpoint. The app and API must select the same backend for that library; never leave API writes pointed at the old folder while the UI edits a hosted fork. Backend switching requires a write barrier, flush or preservation of the outbox, verified transfer and one recorded activation commit. Failure keeps the previous backend active.

The first hosted slice uses hosted authority plus durable offline cache/outbox. Continuing automatic bidirectional folder mirroring is deferred until separately specified; both storage choices remain supported and explicit switches preserve identity/history. Offline records are pending descendants of the same library, not a new library. Returning to folder mode uses the same verified switch protocol and preserves hosted history.

Adapt the previous pull/push concept to complete objects, commits, backup manifests and association graphs. The former four-kind schema, 25-version merge cap, implicit first-sign-in union and immediate delete cascade cannot satisfy this plan unchanged. Server writes and external agent writes use the same command validator and optimistic concurrency. Hosted auth derives account identity server-side and checks library membership on every operation. External agents need revocable library-scoped authorization, not copied browser session tokens. Unpaired or signed-out clients issue no hosted library requests.

Retain server kill switch, strict origin checks, payload/rate limits, account isolation, bounded retries and metadata-only logging from the earlier design. Pause rather than discard rejected objects. Disable stops transport without deleting local, hosted or backup data. Account switching never auto-uploads the previous account's cache. Hosted deletion and erasure from recovery copies need a separate confirmed workflow with verified provider retention disclosures. Do not promise instant removal from provider backups.

Draft and review privacy/terms before public activation, with factual provider, region, encryption and backup details reverified then. No assumed counsel approval, paid smoke tests, production flags or provisioning is authorized by this planning update.

## Acceptance and delivery gates

| Gate | Required proof |
| --- | --- |
| A1: contracts | Lossless fixture with more than 25 versions, runs, cases, Scratch, packs, assets, trash, markers and unknown metadata; all IDs/references preserved; precise API schema |
| A2: folder durability | Save/reopen, interrupted writes, corrupt head, permission loss, full disk, missing cloud objects and schema rollback using disposable data |
| A3: shared API | App create appears in API read; API preview/apply appears in app after reopen; same libraryId/revision; stale writes rejected; response-loss/restart retry commits once |
| A4: iCloud concurrency | Two actual clients produce divergent heads; both edits and histories survive propagation/conflict copies; no stale overwrite or deletion resurrection |
| A5: recovery | Independent backup restores complete object graph; restore creates a new commit; disconnect/reconnect and pending outbox retain data; credentials never exported |
| B1: hosted parity | Complete folder-to-hosted-to-folder round trip, history/backups and references included, with atomic backend activation and offline conflict recovery |
| B2: security and release | Account/library isolation, revoked access, limits, kill switch, approved policy text, preview then production checks, separate native and human acceptance |

Use synthetic fixtures, isolated profiles and supported background tooling. Linux/Windows runner evidence cannot prove macOS file permissions or actual iCloud propagation. Record source, host and exact runtime separately. Builds and HTTP success do not establish data survival. Do not migrate Dave's real library until a fresh backup and reviewed transfer preview pass. The earlier repaired import remains a separate pending data reconciliation, to be revalidated against then-current live content.

## Next action and open decisions

Next action: complete A2 packaged macOS lifecycle, crash ownership, credential renewal and explicit pairing. The five original A1 contract criteria pass on the candidate. Mac Keychain source and actual Linux filesystem failure acceptance now pass, while installed app and macOS recovery checks remain open. The folder path will be selected by Dave through the delivered picker, not requested as a secret or hardcoded now.

Decided: folder first, hosted second; complete history/backups; shared app/API library. The October 28 hosted choices are recorded above and in D-016. The native service packages the shared JavaScript engine with Node 22; actual iCloud propagation and installed-app acceptance remain unverified. The October 23 planning-only authorization and earlier hosted questions are preserved in Git history and the existing Notion historical sections.

## Sources and prior design

- [Original proposal and source links](https://github.com/DaveHomeAssist/prompt-lab/blob/7a1ad40/prompt-lab-source/docs/account-library-sync.md#sources): historical provider comparisons, to reverify before implementation.
- [Existing import preview](../prompt-lab-extension/src/lib/workspaceImportPreview.js), [workspace import](../prompt-lab-extension/src/lib/workspaceImport.js) and [journal](../prompt-lab-extension/src/lib/libraryJournal.js): inspected implementation boundaries.
- [Compatibility contract](LIBRARY_COMPATIBILITY_CONTRACT.md): shipped behavior, not changed by this plan.
