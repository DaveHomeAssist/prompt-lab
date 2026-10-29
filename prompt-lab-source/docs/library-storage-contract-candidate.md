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
source families described below. A full migration still needs a cross-store
write barrier, reviewed backup provenance and unavailable
references. No real export is committed as a fixture
or transferred to a runner. The private acceptance script runs locally against
an explicit input path, writes only to a new disposable directory and emits
aggregate evidence without prompt text.

### Raw source inventory

App reader implementation brief: the existing UI readers can create or upgrade
databases, normalize records or recover failures as empty lists. Preservation
capture needs a separate app-owned entry point that enumerates existing databases
before opening them, aborts any creation race, reads only approved stores in
read-only transactions and waits for completion. Capture every raw record and
primary key, including deletion markers in local storage and the desktop journal.
Read only the two named extension drafts. Unsupported APIs, blocked/aborted reads,
timeouts and non-JSON data remain explicit failures, never empty-source evidence.
Verify actual IndexedDB behavior in a disposable browser origin on a remote
runner, including more than 1,000 records and no database creation. This entry
point does not activate a folder or establish a cross-store write barrier.

The current workspace export reads normalized Library state, Scratch, evaluation
runs and test cases. It does not export every store. The inventory contract
captures raw values independently and never chooses between conflicting replicas.
It has no browser globals or filesystem access; readers are explicitly supplied
by the caller. The app-owned `lib/librarySourceCapture.js` entry point now binds
those readers to the current origin's supported APIs. It is not yet mounted in
the shipped migration UI or connected to a personal folder.

| Owning source | Captured content |
| --- | --- |
| `lib/storage.js`, `hooks/usePromptLibrary.js` | Raw Library/trash, collections/folders, pack registry, loaded-pack state and legacy experiment history |
| `lib/libraryDeletion.js` | Every individual, batch and generation marker key, including raw malformed values |
| `lib/scratchSchema.js`, `PadTab.jsx` | Current pads/schema marker and surviving legacy `pl-pad`/`pl2-pad` content and metadata |
| `experimentStore.js` | All four IndexedDB stores (`experiments`, `eval_runs`, `test_cases`, `runs`) and their local fallback stores, without the existing 1,000-row fallback write cap |
| `lib/libraryJournal.js`, `lib/scratchJournal.js` on current main | Every desktop journal record, including Library and Scratch, plus both local revision markers, retained separately from their local mirrors |
| `lib/recentArtwork.js` on current main | Raw recent artwork, including embedded images and unknown fields, without its UI reader's normalization or 12-entry cap |
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

The app reader uses `indexedDB.databases()` before opening an approved database
without a version argument. If another client deletes it between enumeration
and open, the resulting upgrade transaction is aborted; no replacement database
is committed. Existing older databases are not upgraded and missing stores are
reported separately. Each cursor reads raw values and primary keys in one
read-only transaction, preserving key path, auto-increment and database version
metadata. Success waits for both cursor exhaustion and transaction completion.
Blocked opens, changed versions, aborted reads, unsupported APIs, unsupported
structured values and the bounded deadline fail explicitly. Capacity failure
never publishes a shortened record list. The extension adapter requests only
the editor and dual-draft session keys and checks callback-time errors.

Inventory version 2 added `pl2-scratch-journal-revision` for durable Scratch.
Version 3 also captures `pl2-recent-artwork`, introduced by the delivered
workbench changes. Versions 1 and 2 remain readable against their original key
allowlists; `inspectSourceInventory` reports `currentSourceCoverage: false` for
those historical formats. No version establishes activation readiness.

October 29 app-reader verification on Dominic Node 22.23.4: 87 storage tests and
seven real Chromium 145 browser checks pass. Browser checks cover an empty
origin without database creation, all four raw history stores with 1,002 traces,
41 versions, 20 raw artwork entries, both durable journal records, malformed deletion markers, old
database inspection without upgrade, deletion during open, aborted cursor reads,
unsupported Blob preservation and the real extension session API. All data is
synthetic in disposable origins. This does not establish installed WebView
capability, current personal-profile completeness or cross-store consistency.
The initial host browser attempts failed before running tests because browser
binaries and native dependencies were absent; the existing matching Playwright
container supplied the successful browser runtime.

API references: [database enumeration](https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/databases),
[database open behavior](https://developer.mozilla.org/en-US/docs/Web/API/IDBFactory/open)
and [extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

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

### Complete portable transfer

The shared contract exports a revision-pinned archive with every immutable
object, operation receipt, checkpoint and library-owned state field. A versioned
manifest binds the exact inventory and each component hash. Inspection rejects
missing or extra components, altered receipts, missing commit ancestry,
unsupported formats and excluded credential/settings stores. Unknown content
fields and retained unreachable objects remain in the archive.

Independent backup writing uses an explicitly supplied new destination, refuses
overwrite, flushes before publication and verifies the published archive against
the expected manifest hash. Fault cases cover interruption before flush, before
publication and after publication. No backup health is inferred from iCloud.
Tests reconstruct a disposable adapter from the verified archive and compare its
complete state and operation readback. This transfer contract does not authorize
replacing an existing library; checkpoint restore still needs a new reviewed
commit with permanent-deletion suppression and a pre-restore checkpoint.

`transfer.mjs` owns the portable manifest and semantic verification.
`backup-file.mjs` writes bounded JSON records, with a manifest first and an explicit
completion record last. Each frame holds at most one 64 MiB content object plus
framing overhead. The file limit is 256 MiB, configurable downward. Oversized
archives fail without pruning; larger-library capacity remains a separate gate.
The published file is read back against both its manifest hash and whole-file
SHA-256 before acknowledgement. Original sources and incomplete pending files
are retained on failure. Existing destinations and symlink destinations are
rejected. Callers must also supply known sync roots as excluded directories;
being outside one package directory alone does not prove physical or cloud
independence. No automatic backup-health claim is made.

`GET /v1/library/backups` accepts read scope and requires the current `revision`.
`limit` is 1 to 100 and `cursor` is a nonnegative decimal offset within that pinned
revision. The response contains `libraryId`, `revision`, bounded `items` and
`nextCursor`. Items include the checkpoint hash, name, creation time and state
hash/kind, with `independentBackup: false`. Bad pagination returns 400, invalid
authorization 401/403, stale revision 409 and invalid archive state 422/503.
Checkpoint restore still returns 404 until deletion-aware apply is implemented.

For example, an authorized read of
`/v1/library/backups?revision=sha256:<current revision>&limit=1` returns the first
checkpoint and `nextCursor: "1"` when another exists. Continuing with `cursor=1`
and the same revision fails with 409 if a newer commit has been published.

October 29 verification: all 80 storage tests pass on Dominic Node 22.23.4,
including complete transfer of 84 historical versions, retained opaque objects
and unknown metadata, legacy receipt compatibility, missing receipts/checkpoints,
changed manifests, bounded checkpoint pagination, three backup-publication fault
boundaries, truncated files, unsafe destinations and capacity limits. Documentation
lint and all four consistency checks pass. These results do not establish a
public restore workflow, installed-app recovery or actual cloud replication.

The exact candidate commit `78a951a` passed a private Mac Node 22.22.1 transfer
check on the supplied export. Its 5,765,177-byte backup retained nine objects,
two commits/receipts and one checkpoint, including all 246 indexed records,
21 history rows and 60 missing-reference records. Reopening the file, comparing
the complete state, reconstructing a new disposable folder and replaying the
saved operation all passed. The original source SHA-256 remained unchanged.
No personal library was activated and no private data was transferred off-host.

### Durable import state

Import commits reference a versioned state manifest containing every original
source/workspace object pair, stable source-scoped nodes, selected prompt groups
and association evidence. Group IDs and historical members survive later imports.
Reimporting identical workspace data retains any distinct original byte encoding
without duplicating or reactivating records. An ambiguous legacy target ID requires
an explicit source-scoped target. Whole-workspace replacement cannot overwrite an
already imported graph through the snapshot reference operation.

Package verification rebuilds each import from its parent manifest, exact
incoming objects and recorded choices, then compares the plan and resulting state.
The adapter publishes that state and its operation receipt in one transaction.
Tests cover three successive imports with colliding IDs, retained histories
and associations, alternate source encodings, rehashed semantic tampering, missing
ancestry, stale writers, restart/retry and interrupted folder publication. This
changes the isolated candidate format only; no shipped app consumes it yet.

October 29 verification: all 66 storage tests pass on Dominic Node 22.23.4.
Documentation lint and all four consistency checks pass. The cases include
duplicate IDs within one source, ambiguous associations, more than 25 retained
versions, concurrent writers, rehashed semantic tampering and folder restart
after each publication fault boundary. These checks establish candidate behavior;
native app integration and real two-client iCloud acceptance remain open.

### Bound import review

The shared command boundary exposes the lossless graph through the existing preview
route with explicit `mode: import`. The service reads the existing workspace from
the expected library revision, freezes caller choices before asynchronous work,
and binds the review to the incoming bytes, choices and mode. Review readback is
ephemeral and rejects expired or stale revisions. It does not publish objects.

Import previews never fall through to the whole-workspace snapshot operation.
Unresolved choices reject apply. Resolved choices publish a verified import plan,
state manifest, retained source objects and operation receipt atomically. Snapshot
replacement of an imported graph fails explicitly. Reimporting an identical source
retains its previous selections; changing those earlier choices is not implemented
as a separate command yet.
Acceptance for this boundary covers request/response mutation, concurrent changes,
wrong mode, expired review, HTTP readback and unchanged state after rejected apply.
No app or personal folder is activated by this intermediate A1 contract.

Earlier verification at f96ff29: all 51 storage tests passed on Dominic Node 22.
The private export also passed shared command review and review readback on the
Mac: 246 raw records, 21 history rows, one unresolved choice and 60 missing source
references. Apply rejected the unresolved review, published no revision or
operation receipt, and the original file hash remained unchanged. Durable import
graph application has since been added; app view materialization remains open.

The disposable import harness now uses one explicit Keep test choice for that
export's unresolved conflict, applies the complete graph, imports an alternate
encoding of the same source, closes and reopens the folder, and replays the second
receipt. It preserves 246 indexed records, 21 history rows and all 60 missing
source references, with 213 selected groups, two retained source byte sequences,
two commits/receipts and one prior-revision checkpoint. The original remains
unchanged. This test choice applies only to its new disposable folder and is not
approval to reconcile or activate the personal library.

### Lossless import decisions

`library-storage/import-plan.mjs` separates duplicate selection from source preservation.
Matching uses the existing full canonical body, title and ID rules. It does
not pass either source through UI normalizers. Each imported prompt remains a
source-scoped member of a logical prompt group, including its complete current
record, every history row and unknown metadata. A duplicate joins a group;
Replace changes that group's selected member; Keep creates a separate group;
Skip on a nonduplicate excludes it from the active view but retains its source.
None of these decisions deletes source data.

Association identities are scoped to their source workspace. A run referring to
an unavailable prompt/version stays unresolved even if a destination happens
to contain the same ID. Group membership maps known prompt references, while
the original run, test case, Scratch and provenance fields stay untouched.
Duplicate raw IDs remain separate source-path records. Ambiguous choice aliases
and unlisted replacement targets fail before a plan is accepted; callers use the
exact reviewed source path to resolve those choices. Associations that cannot
distinguish duplicate prompt or version IDs remain explicitly unresolved.
Plans are deterministic, content hashed and suitable for preview review; they
are not activation receipts. The shared command now applies and verifies the
retained graph. Materializing app views and mapping the remaining domain references
are still required before complete import acceptance.

The planner checks every indexed raw record against its original source path.
It reports ambiguous current/history version identities and missing references
instead of selecting an arbitrary record. It also waits when a duplicate's
earlier incoming target has an unresolved choice. Unknown domains and fields
remain covered by the complete source hash; their domain-specific reference
rules are not claimed implemented by this planner.

Initial October 29 read-only verification on the private export preserved the original
hash and all 246 indexed raw records, including 216 active prompts, two trash
records and 21 history rows. Matching found three duplicate rows and one
unresolved conflict. Sixty references were absent from their source workspace. These
are review evidence, not permission to merge or discard personal records.
Only aggregate evidence is recorded here; the export and detailed receipt
remain local. At that read-only check no import was applied. Later disposable
import evidence is recorded above; no personal library location is selected.

Dominic Node 22 passed all 43 storage tests after this change. New cases cover
83 combined historical versions, colliding source IDs, incoming duplicates,
explicit Keep/Replace/Skip, legacy body aliases, unresolved dependencies,
prototype-named IDs, input mutation during hashing and review tampering.
The shared schema and OpenAPI copies are checked for drift. Repeat the bounded
private check with `node scripts/verify-import-plan.mjs` and an explicit export
path; it reads one file and emits aggregate results only.

`library-storage/schema-v1.json` specifies package, object, commit, preview,
receipt, checkpoint and outbox envelopes. `openapi-v1.json` distinguishes
candidate routes from proposed recovery routes. These files are draft contracts,
not a declaration that every route is implemented.

Preview binds library identity, revision, exact source, operation mode and
resolutions for five minutes. Snapshot operations reject nonempty resolution
maps; import operations use the shared planner. Apply persists operation identity
with state; response-loss retries return the original receipt and changed-input
retries conflict. The app is not connected to this service yet.
Ordinary app import application, field-level causal reconciliation,
reviewed fork resolution and permanent-deletion-aware restore remain open.

The local API rejects wrong Host/Origin, absent/expired/revoked credentials,
wrong library and insufficient scope. It binds 127.0.0.1, uses no cookies and
does not accept URL credentials. Secure pairing, keychain integration, installed
service ownership and native packaging remain open. It is not automatically
started. Checkpoint reads are available; restore writes return 404 until their
preservation rules are complete.

## Verification and next gates

Run `npm run test:library-storage` from the source root under Node 22.
Use `node scripts/verify-folder-export.mjs` with an explicit export path for the
private local acceptance harness. Do not put that input into CI or Git.
Use `node scripts/verify-library-import.mjs` with that explicit path for disposable
graph import, repeat, reopen and receipt acceptance. It emits aggregate evidence
and retains the disposable folder locally for inspection.
Use `node scripts/verify-library-transfer.mjs` with an explicit private export
path for complete backup-file readback and new disposable adapter reconstruction.
This harness is not a public restore command or personal-library activation.

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
