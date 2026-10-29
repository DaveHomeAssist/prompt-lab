# Library storage build plan

Status: implementation in progress, acceptance incomplete, October 29, 2026. A1 and an isolated A2 reference candidate are in draft PR248. A3 and hosted implementation remain Not started. Implements the sequence in [Library storage and account sync](account-library-sync.md): chosen iCloud Drive folder first, optional hosted storage second, complete history/backups and one shared app/API library.

The October 23 request covered planning only. Dave subsequently authorized implementation of all phases and real-export verification on October 28, subject to the sequential acceptance gates and no paid provisioning without separate approval. The [former web-first instructions](https://github.com/DaveHomeAssist/prompt-lab/blob/7a1ad40/prompt-lab-source/docs/account-library-sync-slices.md) remain historical. They omitted run history and applied a 25-version cap and do not define current implementation.

## Sequence and existing work item mapping

Keep the existing five backlog records and their history. Their titles retain the former slice numbers for traceability; the new stages below define execution order. Do not create duplicate tasks or mark runtime work Done because planning is delivered.

| Stage | Existing record | Depends on | Output |
| --- | --- | --- | --- |
| Plan reconciliation | sync slice 1: decision and policy | Current request | Revised proposal, slices, D-016 and planning records only |
| A1: shared contracts | sync slice 3: shared engine | Review of reconciled plan, explicit implementation scope | Lossless repository boundary, schemas, fixtures and OpenAPI |
| A2: folder service | sync slice 2: schema/API | A1 acceptance | Durable folder adapter and local API using one command service |
| A3: app connection | sync slice 4: web shell | A2 acceptance | macOS desktop picker and explicit web pairing where qualified |
| A4: folder acceptance | sync slice 5: launch | A3 acceptance | Disposable recovery, actual iCloud concurrency and app/API parity proof |
| B1: hosted contract | sync slice 1, later follow-up | Phase A acceptance | Provider, encryption, retention, costs and policy decisions |
| B2: hosted adapter | sync slices 2 and 3, later follow-up | B1 decisions and authorized provisioning | Same object/history/command contract on hosted storage |
| B3: hosted connection and launch | sync slices 4 and 5, later follow-up | B2 acceptance and policy approval | Verified backend switch and hosted cross-device access |

## A1: shared contracts and preservation

Inspect current source again before code. Define a library repository and command service shared by UI and API; separate storage adapters from domain validation. Publish versioned schemas for immutable objects, state manifests, commit ancestry, receipts, checkpoints, pending outbox and complete transfer manifests. Keep workspace export compatibility explicit rather than relabeling its version.

Acceptance:

- Lossless round trip includes more than 25 prompt versions, variants, source metadata, usage, trash, folder IDs, packs, portable assets, runs, test cases, evaluations, Scratch and deletion markers.
- Unknown metadata and missing-reference evidence survive. Secret/settings stores are excluded. No invented missing objects.
- OpenAPI specifies read/object pagination, preview, apply, operation readback, backups and restore, identity, limits and errors.
- Preview binds libraryId, expected revision, source hash and resolutions. Stale input fails before mutation. Idempotency survives restart and response loss.
- Import and duplicate resolution reuse existing matching semantics while retaining all source histories and associations. No silent version pruning.

Files to inspect: shared `lib/workspaceImport.js`, `lib/workspaceImportPreview.js`, `lib/promptSchema.js`, `lib/libraryDeletion.js`, `lib/libraryJournal.js`, `hooks/usePromptLibrary.js` and `experimentStore.js`. New implementation paths remain proposed until A1 defines their ownership. This stage does not connect a personal folder.

## A2: folder adapter, local service and API

Build the portable file package and one local service for serialized writes. Bind the service to one chosen library, with loopback-only authenticated access, explicit pairing, origin/host restrictions and disconnect. The desktop and API must call the same validator and adapter. Never manipulate browser profile databases or serve an independent imported library.

Acceptance:

- Temp-write, flush, atomic publication and hash readback precede a committed receipt. Interrupted writes leave the old state readable.
- Immutable commit objects expose forks rather than relying on a cloud-synchronized lock or overwriting a whole snapshot.
- Full disk, denied permission, corrupt or missing objects, service restart and idempotency failure paths preserve drafts and prior commits.
- All history/checkpoints remain available. No pruning or purge route ships.
- Local auth rejects unauthenticated, expired, wrong-library, LAN and hostile-origin requests. Credential storage is outside the library.
- API can operate with the app window closed while the enabled service runs; stopped service reports unavailable.

## A3: app location and migration flow

Start with the macOS desktop's supported folder picker. Add web pairing only after supported-browser secure-context and local-network constraints pass. Other shells retain explicit import/export and capability messaging until qualified.

Acceptance:

- User chooses the folder. Existing packages open without overwrite; a different library ID requires an explicit reviewed operation.
- Migration creates a source backup and previews all data. Object/hash readback and count/reference parity pass before activation.
- App save and API save report the same libraryId and revision. API edits appear in app after reopen, and app edits appear through API reads.
- Offline pending changes are durable, scoped by libraryId and clearly pending. Failed outbox persistence never reports Saved.
- Disconnect, permission revocation and reconnect preserve pending edits and the selected library. Original browser data remains recoverable.
- UI distinguishes folder commit acknowledgement from iCloud replication and independent backup status.

## A4: folder release acceptance

Run cheap pure-contract and durability checks on a verified remote runner. Use a disposable macOS library for native picker, permissions and actual iCloud acceptance. No external-browser/mouse automation. User selection is an explicit product step.

Acceptance:

- Two actual iCloud clients edit from one base: divergent heads and conflict copies preserve both branches, versions and all related data.
- Missing cloud placeholders and delayed propagation pause safely; no local lock is treated as a cross-device transaction.
- Backup outside the live sync folder restores the complete graph. Restore creates a new commit and respects permanent-deletion markers.
- Crash during migration, apply, restore and reconnect is recoverable; stale API previews cannot overwrite newer app saves.
- Exact installed artifact, runtime behavior and human acceptance are separate receipts. No claim of Windows/iOS support from macOS proof.
- A fresh backup and separate review are required before applying the earlier repaired catalog to the then-current personal library.

## B1: hosted decisions and policy

Only after Phase A acceptance, verify feasibility and policy for the selected Neon/Clerk US East direction. D-016 records the October 28 server-readable encryption-at-rest and retained-history choices. Paid provisioning still requires separate approval. Review policy text against verified provider behavior. Do not assume counsel approval or publish drafts as effective terms.

Acceptance: full preservation contract is funded and feasible; no four-kind/latest-record-only schema or provider restore window substitutes for application history and backups. Authorize provisioning separately before executing it.

## B2: hosted adapter and complete transfer

Implement the same library identity, revision ancestry, objects, history, checkpoints and command service contract with hosted persistence. Reuse existing verified Clerk identity patterns for app requests; define narrow revocable authorization for agents. Membership checks are server-side on every operation.

Acceptance: folder-to-hosted-to-folder parity includes every object, history version and backup manifest. Write barrier and outbox handling make backend activation atomic. Failure leaves the old backend active. Concurrent/offline edits preserve both versions; cross-account access and accidental cache upload fail closed. Publish bounded transport, rate limits, kill switch and negative tests.

## B3: hosted connection and launch

Connect app and API to the same selected hosted library. Keep folder mode supported. A preserved folder checkpoint is a recovery copy after switching, not an independently writable automatic mirror. Continuous bidirectional mirroring requires a separate contract.

Acceptance: two clients converge for complete workspace data; response loss is idempotent; revoked access and kill switch stop transport without deleting data; delete/erasure has separate confirmation and honest backup retention. Approved privacy text precedes production activation. Verify preview, deployment, live behavior, native shells and human acceptance separately.

## Delivery and next action

For each later authorized slice: reverify current main and ownership, use disposable fixtures and qualified runners, run scoped tests and failure paths, deliver through required PR gates, then update existing records with the actual evidence. Provider/billing calls and infrastructure changes need their own scope. Documentation delivery is not storage implementation or data migration.

Next action: finish A1 shared contracts and lossless fixtures. The implementation request and storage direction are authorized; sequential acceptance remains required. Dave selects the actual iCloud folder through the delivered picker later.

## Implementation progress: October 28

Dave authorized all planned phases, real-export verification and the reported
save-state UX repair. Sequential acceptance still applies. Hosted decisions
are recorded in the D-016 follow-up; no paid provisioning is authorized.

| Stage | Evidence state | Remaining acceptance |
| --- | --- | --- |
| A1 | Source-bound import and reviewed checkpoint restore candidates; raw preservation and deletion suppression tested | Complete domain mapping, migration write barrier, reviewed causal conflicts and full schema/API acceptance |
| A2 | Isolated folder/API, backup transfer and reviewed restore candidate tested | Production service ownership, secure pairing, native recovery integration and complete failure matrix |
| A3 | Not started | Native picker, packaging, app connection and reviewed migration |
| A4 | Not accepted | Actual two-client iCloud, installed artifacts, independent recovery and human acceptance |
| B1 | Provider, region, encryption direction and retention decisions made | Verify provider constraints, costs and policy facts after Phase A |
| B2 | Not started | Accepted Phase A and hosted contract, authorized provisioning |
| B3 | Not started | Hosted parity, policy approval, deployment/runtime/native acceptance |

The private real export passed an isolated source-byte and full JSON round trip,
reopen and duplicate retry. Its original remained unchanged. That proves
preservation of the supplied export only, not app integration, absent source
stores, actual iCloud replication or release readiness. No private fixture is
stored in the repository or runner workspace.

The first folder reopen exposed an EEXIST error, fixed before the passing
readback. A synthetic iCloud propagation probe was not visible on either
qualified Windows SSH host during the bounded checks. This is an open cloud
qualification result; it does not establish the cause or justify changing
account settings.

The candidate and remaining limitations are described in
[library-storage-contract-candidate.md](library-storage-contract-candidate.md).
Next: complete A1 acceptance before advancing the production folder service.
