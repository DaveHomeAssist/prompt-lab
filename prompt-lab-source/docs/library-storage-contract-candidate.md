# Library storage contract candidate

Status: implementation in progress. This candidate does not connect any app or
personal folder. It is not a completed A1, A2 or release acceptance receipt.

Owner: PromptLab. Source: the existing folder-first proposal and build plan.
Dave authorized all planned phases on October 28, including verification on a
preserved copy of his real workspace export and the reported save-state UX fix.
Phase acceptance remains sequential. No paid provisioning is authorized.

## Ownership and boundaries

`library-storage/contract.mjs` owns JSON encoding, integrity verification and
the reference preview/apply/operation service. The module deliberately does not
call the existing prompt normalizers. `folder-adapter.mjs` owns an isolated
filesystem reference adapter. `local-api.mjs` provides a programmatically created
loopback test service with scoped, expiring credentials. None is imported by
the shipped UI, native bootstrap or hosted production routes.

The reference memory adapter tests service reconstruction, not filesystem
durability. The folder adapter tests immutable transaction publication using
temporary writes, file sync, rename, directory sync and hash readback. It
retains incomplete pending files and rejects unexpected conflict copies,
missing ancestry, corruption and divergent heads without selecting a winner.

The current adapter retains complete immutable transaction snapshots. That
preserves all source objects but duplicates their bytes between transactions.
Size, history growth and multi-process writer ownership must be addressed
before personal-folder activation. Its process-local writer queue is not a
cross-process or cross-device transaction guarantee. No cloud lock is assumed.

## Preservation and source inventory

The archive retains the original UTF-8 source text as well as its parsed JSON
workspace. Canonical JSON sorts object keys by JavaScript string order, retains
array order, encodes finite numbers using JSON.stringify and rejects sparse
arrays, unsupported values and nesting beyond 128 levels. SHA-256 hashes the
UTF-8 canonical JSON of the complete object envelope, including schema and kind.
Limits are 64 MiB per object and request; oversized input fails without pruning.

| Source family | Existing source to inspect | Candidate handling |
| --- | --- | --- |
| Prompts, trash and versions | shared lib/storage.js and lib/promptSchema.js | Raw source retained without version cap or normalization |
| Collections, folders, packs and artwork | shared folder/presentation/pack modules | Raw fields, identifiers, references and available bytes retained |
| Runs, cases and evaluations | shared experimentStore.js | Raw records and associations retained |
| Scratch and recovery information | shared Scratch storage and revision handlers | Raw exported data retained |
| Generations and deletion markers | shared lib/libraryDeletion.js | Preserved if supplied; omitted source state is not invented |
| Backups, archives and unavailable assets | explicitly selected source manifests | Original provenance retained if supplied; neighboring files are not scanned |
| Credentials and settings stores | provider/session/billing/telemetry stores | Explicit excluded root stores rejected before transfer |

Unknown root and nested JSON fields survive. The synthetic fixture includes 41
versions, asset bytes, missing-reference evidence and unknown metadata. The
expected result is built directly from raw data, independently of UI normalizers.
The private real-export harness compares the entire parsed workspace and exact
source bytes after close/reopen and retry, then checks the original hash again.

An export cannot prove preservation of data it omitted. The read-only
`library-storage/source-inventory.mjs` contract now captures the inspected
source families described below. A full migration still needs an app-owned
reader, a cross-store write barrier, reviewed backup provenance and unavailable
references. No real export is committed as a fixture
or transferred to a runner. The private acceptance script runs locally against
an explicit input path, writes only to a new disposable directory and emits
aggregate evidence without prompt text.

### Raw source inventory

The current workspace export reads normalized Library state, Scratch, evaluation
runs and test cases. It does not export every store. The inventory contract
captures raw values independently and never chooses between conflicting replicas.
It has no browser globals or filesystem access; readers are explicitly supplied
by the caller. It is not yet called by the shipped app.

| Owning source | Captured content |
| --- | --- |
| `lib/storage.js`, `hooks/usePromptLibrary.js` | Raw Library/trash, collections/folders, pack registry, loaded-pack state and legacy experiment history |
| `lib/libraryDeletion.js` | Every individual, batch and generation marker key, including raw malformed values |
| `lib/scratchSchema.js`, `PadTab.jsx` | Current pads/schema marker and surviving legacy `pl-pad`/`pl2-pad` content and metadata |
| `experimentStore.js` | All four IndexedDB stores (`experiments`, `eval_runs`, `test_cases`, `runs`) and their local fallback stores, without the existing 1,000-row fallback write cap |
| `lib/libraryJournal.js` | Desktop durable journal plus local revision marker, retained separately from the local mirror |
| `App.jsx`, `hooks/useSessionState.js`, `lib/platform.js` | Draft reset recovery and the two explicitly named editor/dual draft session keys. Authentication sessions remain excluded |
| Explicit archive review | User-selected backup provenance and unavailable-reference evidence, retained without scanning neighboring files |

Local reads never request values of unselected keys. Their names are listed for
review rather than guessing that an unknown store is safe to copy. Known content
store strings remain byte-for-byte JavaScript strings, even if their JSON is
corrupt. IndexedDB readers must return complete raw records; unsupported non-JSON
values fail visibly instead of being coerced or dropped. Portable artwork data
embedded in those records survives; missing external bytes remain a gap.

Two differing local observations retain both and mark the source changed.
Permission failures, absent databases and unreviewed archives are distinct states.
Each capture has a content hash, and the manifest names every required source for
its shell. `sourceReadComplete` means the selected source reads were accounted
for; `activationReady` is always false because this inventory alone proves no
cross-store write barrier, semantic migration or destination readback.

October 29 verification on Dominic Node22: the complete storage suite passed
30 tests, including 41 versions, 1,002 trace records, divergent journal/mirror
content, corrupt JSON, legacy Scratch, inaccessible stores, excluded credentials,
extension draft scoping and manifest/object tampering. No private source data
was moved to the runner. Record-level import/conflict and full API schema
acceptance remain separate A1 work.

The memory adapter now serializes its own transactions, including two distinct
command-service instances sharing it. The stale writer fails instead of both
services acknowledging one overwritten state. Commit identities also reject
invalid types, timestamps and parent hashes before archiving. These checks do
not establish filesystem process ownership, which remains an A2 requirement.

## Contracts and remaining A1 proof

`library-storage/schema-v1.json` specifies package, object, commit, preview,
receipt, checkpoint and outbox envelopes. `openapi-v1.json` distinguishes
candidate routes from proposed recovery routes. These files are draft contracts,
not a declaration that every route is implemented.

Preview binds library identity, revision, exact source and resolutions for five
minutes. The candidate rejects nonempty resolution maps rather than pretending
to reconcile records. Apply persists operation identity with state; response-loss
retries return the original receipt and changed-input retries conflict.
Ordinary app import/duplicate resolution, field-level causal reconciliation,
reviewed fork resolution and permanent-deletion-aware restore remain open.

The local API rejects wrong Host/Origin, absent/expired/revoked credentials,
wrong library and insufficient scope. It binds 127.0.0.1, uses no cookies and
does not accept URL credentials. Secure pairing, keychain integration, installed
service ownership and native packaging remain open. It is not automatically
started. Recovery routes return 404 until their preservation rules are complete.

## Verification and next gates

Run `npm run test:library-storage` from the source root under Node 22.
Use `node scripts/verify-folder-export.mjs` with an explicit export path for the
private local acceptance harness. Do not put that input into CI or Git.

Initial tests found an EEXIST reopen error; recursive directory creation fixed
it and reopen was tested again. The first hostile-Host test used fetch, which
rewrote Host; the corrected test sends a real HTTP request with the hostile
header. Retain these first failures separately from subsequent passing checks.

Next: finish A1 conflict and complete-source contracts, accept A1, then finish
A2 service/recovery/ownership and native A3 connection. A4 requires actual two
client iCloud evidence and installed/native acceptance. Hosted work follows
accepted Phase A. Neon/Clerk US East, server-readable data with provider
encryption at rest, no automatic history pruning and separate confirmed erasure
were selected October 28. Verify provider limits and retention before activation.
