# Library storage contract candidate

## App owned migration copy

The app's migration boundary must capture its actual stores and every cooperating
editor together, derive prompt and Trash input from that same capture, and retain
a strict durable source backup before reviewing or publishing a destination copy.
Never replace source arrays with the UI's normalized arrays or combine conflicting
replicas. Archive selection remains an explicit review. Keep the source backup
and original app stores after failed review, interrupted copy or lost response.
An initial copy into an empty library keeps every source occurrence, including
matching IDs, titles and bodies. Generic import deduplication cannot silently
collapse the existing catalog. Copying into an existing library retains the
shared explicit conflict review.

Use the existing shared import command and durable outbox. Restart resumes the
same operation. Complete destination readback must verify its receipt, source
binding, exact raw captures and object hashes, including retained histories,
unknown fields and references. A later destination commit must not force another
copy of the source. This proves a recoverable copy only. Activation still needs
fresh source comparison, the app reader/writer switch, selected-folder ownership,
secure native service and actual device acceptance. No migration helper may
activate a personal library merely because the copy verified.

The implemented boundary uses actual app source capture, a separate strict
IndexedDB migration backup, the shared import/outbox and complete transfer
readback. The retained backup survives browser restart. Failed backup writes
prevent destination publication; a lost copy response resumes one operation.
The backup is same-origin storage, not an independent off-device backup.

Dominic Node 22.23.4 passed 345 storage tests and 46 browser checks, including
two-window capture, restart, lost response and aborted backup transactions.
The final initial-copy duplicate rule then passed 35 affected tests. Schema
validation accepted both runtime records, rejected 13 malformed variants and
confirmed OpenAPI parity. The extension build passed from its package directory.
The final browser rerun is assigned to CI because Dominic subsequently lost AC
power. Earlier fixture, module-server and build-command failures are retained.
After charging resumed, the three final migration browser scenarios passed in
6.9 seconds on Dominic. Runtime-commit documentation CI also passed. Current-head
CI remains a separate gate.

On Mac Node 22.22.1, the full export was seeded into a disposable Chrome profile
and captured through the app's real localStorage and IndexedDB readers. The
backup survived browser restart; copy, full readback and folder reopening passed.
All 216 prompt occurrences remain selected, with two Trash entries, three runs,
four Scratch notes and the exact original export retained. The source stores and
original file remain unchanged. Initial private harness failures exposed an
object-key-order assertion, an origin mismatch and unresolved duplicate matches;
the retained backup was recovered without recapture or duplicate publication.
The successful copy/readback and reopen run took about ten seconds. This does
not prove personal-profile migration, interactive performance, native activation
or actual iCloud propagation.

## Lossless pack installation

Installation must publish the selected prompts, registry and loaded marker as
one command. Preserve the exact input text and every preset, including skipped
presets, unknown fields and unlimited history. Review every preset by index:
add with an explicit new prompt identity, replace a pinned active prompt, or
skip while retaining its source. Never guess an identity collision or revive a
deleted identity. Replacement preserves previous history and unmentioned fields
alongside all incoming history. Pin the library revision and source binding.

The command uses the existing pack preview, API, outbox and immutable receipt.
Verify whole-operation interruption, restart, idempotent recovery, source
isolation, stale choices, checkpoint restore and complete transfer using
disposable fixtures. This slice does not activate personal storage or close
app migration, native ownership, performance or actual iCloud acceptance.

The implementation preserves an exact `pack-source` object, including whitespace,
and publishes additions, pinned replacements, registry and loaded marker together.
Each preset has an explicit indexed choice; duplicate identities and replacement
targets, foreign sources, stale hashes and permanently deleted identities fail
before publication. Replacement retains all prior versions, its complete previous
value and every incoming version. The pack registry also retains skipped presets.
Existing workspace source validation remains intact; pack archives receive their
own validation and the same exclusion of credential/settings stores.

Verification found two issues before delivery: raw packs initially used the
workspace source kind, which prevented folder publication and transfer; the
reviewed-command schema initially omitted installation. Both failures are retained
and their corrected runtime/schema checks pass. No existing assertions were
removed. The interruption tests now require the exact injected failure.

Dominic Node 22.23.4 passed the 334-test storage suite, the subsequently added
credential-store/raw-pack regression, all 43 browser source-capture/outbox checks,
the extension build, Markdown lint and four documentation contracts. Schema
validation accepted 38 pack and 168 earlier fixtures and rejected 34 malformed
requests. The first browser attempt could not write an existing result directory;
the fresh disposable result directory passed without changing its permissions.

On Mac Node 22.22.1, a disposable copy of the full 216-prompt export passed
installation, readback, checkpoint restore, selection and complete transfer.
The review replaced one prompt, added one and retained one skipped preset.
All original objects/receipts remain, with exact restored selected values,
origins and identities and every original reference target preserved. An initial
readback assertion wrongly required replaced children to keep their old selected
addresses; its retained failure was followed by archived-child and selected-value
checks. No write was repeated to repair that assertion. Original export bytes
remain unchanged, with no private upload or personal activation. These harness
phases took approximately 13 to 41 seconds including repeated verification;
interactive performance, app migration and native/iCloud acceptance remain open.

## Atomic pack publication and removal

Pack Studio currently assigns prompt membership, saves the registry and moves
removed prompts to Trash through separate writes. The shared command must publish
those related changes together, or publish none. Pin the source identity and
library revision, retain every prompt version and unknown field, and use one
operation receipt for recovery after a lost response. Removal keeps recovery
content and clears the selected registry and loaded marker without permanent
erasure. Publication requires reviewed prompt identities and hashes, preserves
unmentioned registry metadata and rejects permanently deleted identities.

The earlier publication/removal increment covered shared commands, with pack-file
installation and the app migration switch left open. Installation now adds its
separate lossless review described above:
keep its raw source, imported history and conflict choices before installation.
Native activation, performance and actual two-client iCloud acceptance remain
open. Verify source isolation, complete history, restore, competing branches,
interrupted publication, restart, API and outbox parity using disposable data.

Dominic Node 22.23.4 passed all 326 storage tests, 42 browser capture and outbox
checks, the extension build, Markdown lint and four documentation contracts.
Schema checks accepted 26 new runtime fixtures and 168 earlier fixtures, rejected
23 malformed requests, and confirmed OpenAPI parity. Interrupted publication and
lost acknowledgements preserve one atomic operation across restart and transfer.

On an isolated copy of the complete 216-prompt export, publication, removal and
checkpoint restoration passed. Final readback matched every selected value,
origin and identity, retained every original reference target, object and receipt,
and verified a complete backup transfer. The first comparison incorrectly
required the archive's reference candidates to remain unchanged after adding
history. The retained failure is followed by exact data and original-target
checks that allow additional archived candidates. The original export remained
byte identical. No private data was uploaded or personal storage activated.
The private harness phases took 40 to 80 seconds, including repeated verification;
interactive performance and native/app acceptance remain open.

## Shared draft, asset, recovery and loaded pack records

Extend the shared record command to the remaining captured value shapes: draft
objects and buffers, standalone artwork, recovery values and loaded-pack IDs.
Updates pin the selected group and exact value hash. Object field changes retain
unmentioned metadata; an explicit replacement is available for scalar or array
values only. Creation supplies a separate stable record ID without inserting it
into the user's value. Loaded-pack IDs support creation and confirmed deletion;
changing a marker must not silently change the pack identity.

Derived values carry their original group identity in verified command metadata.
Legacy anonymous records keep their existing groups through edits, restore and
reconciliation. Ordinary imports cannot supply this metadata or override a
selection. Every original source, raw capture, previous value and deletion stays
retained. Artwork nested in another record remains owned by that record.

Acceptance covers all four domains and legacy scalar, array and anonymous-object
shapes, unknown fields, stale inputs, forged metadata, source isolation, causal
merge and conflicts, checkpoint restore, deletion, interrupted publication,
response loss, API/outbox replay and complete transfer. Remote checks use only
synthetic fixtures. Real-export checks use an isolated local copy and never upload
private content. Atomic pack installation, app writer migration and activation,
native ownership and actual two-client iCloud acceptance remain separate gates.

Dominic Node 22.23.4 passed the full 313-test storage suite, then 116 affected
tests after the final anonymous-identity collision guard. Schema validation
accepted 168 new runtime fixtures plus 91 earlier command fixtures and rejected
170 malformed requests. The extension build passed. All 40 source-capture and
durable-outbox browser checks passed in the existing Playwright 1.58.2 container,
including four new value-command cases across separate browser processes.

The previous head's CI browser failure was reproduced: its disposable server
did not serve the folder-request module now imported by the outbox. Adding that
module repairs the fixture; the original failed CI and reproduction are retained.
The first value-record test run also retained a fixture-selection failure that
mistook nested prompt artwork for standalone artwork. The corrected root-record
selector passed. No failed assertion was disabled or skipped.

An isolated local copy of the complete 216-prompt export passed creation of a
draft containing one entire original prompt, exact checkpoint restoration of all
selected records, retention of every original object and operation receipt, and
complete backup transfer. The original export remained byte identical. These
checks use synthetic capture coverage around the real export, not actual app
store capture. Creation, restore and selection harness phases each took about
81 to 88 seconds, including repeated verification; interactive performance is
still an open acceptance gate. The disposable copy remains available locally.

## Per tab draft recovery preservation

The app keeps its previous-draft recovery copy in session storage, while the
existing inventory reads the same key from local storage. Preserve the raw
session value from every participating app window and its current in-memory
recovery state through the coordinated editor-buffer capture. Keep these as
separate, client-scoped records: either can contain data absent from the other.
Do not parse away malformed saved values or capture unrelated session keys.
Unreadable session storage must fail capture, and recovery writes or dismissal
during capture must invalidate the barrier rather than silently change its input.
Register the raw reader before startup announces a participating window. Reject
coordinated app capture if an older participant lacks that recovery record.

Acceptance covers mounting the real app, recovery after reload, a failed session
write with a recoverable in-memory draft, raw malformed content, per-client
isolation, changes during capture, immutable import and backup readback. Earlier
captures without these buffers remain retained but cannot prove this new
coverage. This fixes source preservation only; shared draft commands, app
migration activation and native/iCloud acceptance remain required.

Dominic Node 22.23.4 passed 1,553 app tests and 74 affected storage/capture tests.
After tightening malformed-participant validation, seven source-reader tests,
16 focused app/buffer tests, the extension build and documentation checks passed.
All 21 source-capture browser checks passed in the existing Playwright 1.58.2
container, including different session recovery in two windows, changes during
capture, startup before editor mounting and participant restart. The two new
app regressions fail against the previous App implementation and pass here.
The new retention fixture covers interrupted publication, response loss, reopen
and complete transfer of both clients' raw and live recovery copies. Initial
test-fixture and runner setup failures remain recorded in private evidence.
No personal browser state was read, and this increment does not repeat the
earlier full real-export scenario. Its original file remains byte identical.

## Shared Scratch note commands

Scratch creation, field updates and confirmed deletion must use the shared
record command, authenticated API, durable outbox and receipt. Own each note
identity separately so independent edits reconcile and competing edits require
review. Preserve every previous note, unknown field, prompt link, container
metadata and deletion marker. Never select a winner by its timestamp.

The first note command adopts the already reviewed container's note selections.
Later current reads project those note selections into that same container;
archival reads retain its exact original bytes. Note deletion remains effective
after an older import or checkpoint restore. Deleted identities cannot be reused.
An empty current note list is valid and does not manufacture a replacement note.
Native UI activation must explicitly handle that state before connection.

Acceptance covers creation, rename/content/metadata updates, independent and
conflicting branches, source isolation, tombstones, stale input, restore,
interrupted publication, response loss, reopen, complete transfer and API/outbox
parity. Synthetic checks run on the remote runner; any private-export scenario
uses isolated local storage and preserves its original. This does not activate
the app, choose a native runtime or satisfy actual iCloud acceptance.

The shared `record` route now accepts `scratch-notes`. Current note reads return
their `commandGroupId`; updates pin that ID and the exact note hash. Current
containers identify their projected values separately from `sourceValueHash`,
and their active-note references follow the selected notes. Creation and update
times come from the reviewed command; original creation times remain intact.
Old clients reject these commands instead of dropping their data.

Dominic Node 22.23.4 passed all 290 storage tests. Final review corrected the
projected active-note reference and made an unresolved checkpoint fail closed;
42 current-view/import/Scratch checks and then 63 record/restore/reconciliation/
Scratch checks passed after those respective changes. All nine changed
source/test/schema files match the runner. The extension build, Markdown lint
and four documentation contracts pass. Existing Vite configuration and chunk-size
warnings remain.

An isolated copy of the complete private export passed a Scratch edit and exact
checkpoint restore of all four original notes, unchanged selected related data,
retention of every original object and receipt, and complete backup transfer.
The original export remained byte identical and was never uploaded. The first
readback harness started before selection finished and failed on the absent
view; its failed evidence is retained. Waiting for that same selection process
and rerunning readback passed without repeating any write. The edit and restore
checks took about 60 and 48 seconds respectively; scale/performance acceptance
is still open. This uses the earlier synthetic source-coverage fixture, not a
capture of the actual app's stores. The disposable folder remains available for
inspection. Full app writer migration, other writable domains, native ownership,
actual iCloud replication and human acceptance remain required.

## Catalog preservation and pack commands

Ordinary folder reconciliation, rename and artwork changes must retain unknown
folder and artwork metadata. Updating a pack must retain its existing metadata,
creation time, version and source unless the caller supplies a change. Importing
folder metadata into a matching path must preserve unrelated destination fields.
Known artwork display fields still use the existing safe rendering rules.

Pack registry creation, field updates and confirmed deletion use the shared
record command, verified source scope, revision and exact selected record hash.
Registry keys own pack identity; reject conflicting embedded IDs. A pack registry
write does not rewrite prompt membership or uninstall prompts. Preserve the whole
registry record, prior values, loaded-pack state and every associated prompt.
Dictionary storage must survive checkpoint restore, concurrent reconciliation,
source-scoped deletion, folder reopen, API retries and browser queue recovery.

Acceptance uses synthetic runner fixtures and the complete private export on its
Mac. Shared folder move/rename transactions, collections, Scratch, assets, drafts,
app activation and native/iCloud acceptance remain required. Catalog preservation
and one registry command family do not complete those remaining gates.

## Shared related record commands

Evaluations, test cases, execution traces and experiments need ordinary create,
field-update and confirmed deletion commands before the app can use the shared
library. Bind each command to the library revision and verified source identity.
Updates and deletion also name the exact selected record hash. Preserve every
prior source object, nested value and unknown field; retain history as immutable
source ancestry instead of pruning or rewriting earlier records.

Each changed record has a source-scoped selection in the shared manifest.
Checkpoint restore and branch reconciliation compare individual records with
their common ancestor. Independent changes merge; concurrent changes to the same
record need explicit review. Confirmed deletion excludes future current selection
without erasing archived data, including after older imports and restores.
Existing imports retain command-owned selections; their other source occurrences
remain available in the complete archive. Other domain families keep their
existing review behavior until their commands are implemented.

Use the existing preview, authenticated API, durable outbox and receipt path.
Acceptance covers all four domains, unknown values, invalid/stale input, source
isolation, independent/conflicting edits, checkpoints, deletion, interrupted
publication, response loss, restart and complete transfer. Use synthetic runner
fixtures and isolated real-export data on its Mac. Scratch, collections, packs,
assets, drafts, native ownership and full application activation remain required
subsequent work; this increment does not complete those gates.

## Complete chain output history

Chain execution passed complete output to the next step but saved only its first
4,000 characters in the execution trace. Preserve the complete successful output
through the existing event and persistence path, including when a later step
fails or is canceled. Keep display limits separate from stored history. This
changes no provider request, input capture, storage schema or activation policy.

Acceptance compares long Unicode outputs with both trace reads and serialized
storage, checks later success/failure/cancellation, and imports an isolated trace
derived from the real export into the shared folder service. Existing private
records and the original export must remain unchanged. Earlier truncated traces
cannot recover missing content from this change alone.

## Shared prompt lifecycle

Move to Trash, restore from Trash and permanent deletion must use the same
reviewed command service and durable outbox as prompt creation and editing.
Each request pins the library revision, selected logical group, exact record
hash, action and time. This applies both to newly trashed prompts and existing
Trash records in an imported workspace. Keep every original object, complete
version history, unknown field, related record, backup and operation receipt.

Lifecycle state belongs to the logical prompt group. Current reads project its
selected record into Prompts or Trash; archival reads continue to describe the
original source location. An explicit restore derives a successor without
reusing a stale imported Trash selection. Conflicting identities require review.
Permanent deletion adds verified, source-scoped evidence to immutable ancestry.
Checkpoint restores, later imports and branch reconciliation must honor that
evidence even when another branch selected older content. It removes active and
Trash visibility but does not erase retained recovery content or backups.
Physical erasure remains the separately confirmed workflow in the specification.

Acceptance covers lifecycle round trips, imported Trash, complete history and
unknown-field retention, edit rejection while trashed, stale requests, explicit
confirmation, interrupted publication, response-loss retries, concurrent edits
and lifecycle changes, deletion across restores/imports/branches, full transfer
and the same direct/API/browser queue behavior. Run synthetic acceptance on
Dominic and the complete private export only in disposable storage on its Mac.
Native activation, installed-app acceptance and actual iCloud propagation remain
separate gates; these commands do not change an existing personal library.

## Shared prompt creation

Creating a prompt must use the same reviewed command, durable queue and receipt
as editing one. Bind creation to the current library revision and an existing
verified source identity, including a reviewed empty app capture. A stable
creation identity determines the new prompt ID. Reject reuse across retained
records or deletion evidence; identical content with a distinct identity remains
a distinct prompt. Do not fabricate a browser capture or infer a destination
from whichever source happens to be first.

Retain all supplied draft fields and unknown metadata. Identity, timestamps,
deletion generation and initial history are service-owned. Reject caller-supplied
values for these fields instead of silently discarding them. Keep every existing
prompt, related domain selection, source object, backup and receipt unchanged.
Create a recovery checkpoint before publication. Later edits, branch merges,
restore and transfer must understand the newly derived source ancestry.

Acceptance covers creation in an empty reviewed library, intentional duplicate
content, identity collisions, stale or unreviewed input, concurrent creations,
clear/deletion evidence, interrupted publication, restart/idempotency and actual
browser queue recovery. Test a disposable copy of the complete private export on
its Mac and synthetic fixtures on Dominic. Trash, permanent deletion and their
restore semantics remain the next ordinary command work; native activation,
app writer integration and actual iCloud acceptance remain separate gates.

## Shared prompt edit command

The app currently writes prompts directly to its legacy stores. The shared
service has no ordinary edit command, so connecting those stores as writable
mirrors would introduce another source of truth. Add an explicit prompt edit
to the existing command service before native activation.

An edit names the library revision, stable prompt group and exact selected
record hash. Field updates preserve unspecified and unknown values. Identity,
generation and history are service-owned: retain every previous version and
append the previous complete record before publishing its successor. The new
source object records the edit provenance and inherits the selected source's
deletion scope, without fabricating a browser capture. Keep other reviewed
domain selections unchanged. Import, restore, branch reconciliation, complete
transfer and current reads must understand this ancestry.

Use the same preview, durable outbox, commit and receipt through direct and
authenticated API transports. Reject stale revisions, changed records,
inactive targets, unreviewed source coverage, invalid updates and publication
failures without reporting Saved. Retry after response loss returns the same
receipt and creates no additional version. Native packaging remains a separate
pending decision; this command does not activate any personal library.

Acceptance covers repeated edits and more than 25 versions, nested unknown
fields, unchanged related records, source-scoped deletion after edits, actual
edit forks and explicit reconciliation, restore, reopen, interrupted folder
publication, transfer and API/outbox parity. Run synthetic checks on Dominic
and use the private export only on its original Mac with disposable storage.
Prompt creation, Trash/deletion commands and the complete app writer migration
remain required subsequent work; an edit command alone does not complete A1/A3.

The first direct/API tests and actual-edit fork tests pass. Browser request
validation lives in a small shared module so loading the durable queue does not
load the domain engine. Older runtimes reject the new edit operation; preserve
the complete folder and use a compatible runtime rather than removing history.
No native runtime choice or personal activation is implied.

## Folder branch recovery

The folder reader previously rejected divergent transaction heads before a
review could reach either retained branch. Bounded inspection and explicitly
selected recovery reads now use the existing command service.
Normal reads and saves remain unavailable while multiple heads exist. Recovery
writes permit only a reviewed reconciliation that retains the consumed branches'
objects, receipts and checkpoints. A third branch remains visible for another
review; neither timestamps nor a local lock choose its winner.

Publish new journal transactions with explicit parent lists, retaining every
legacy transaction unchanged. Verify ancestry and preserved state before and
after publication. Stale head sets, partial cloud copies, corrupt metadata,
missing objects and interrupted publication must fail without deleting inputs.
Expose the same scoped branch inspection and transfer through the authenticated
loopback API; branch selection is explicit and is never a second active library.

New writes use journal version 2; existing version 1 bytes remain readable and
unchanged. An older runtime may reject new transactions. Preserve the complete
folder during rollback rather than removing newer history. Unexpected cloud
conflict-copy names still stop safely and require a separate explicit repair.

Acceptance covers two and three branches, conflicting edits, stale reviews,
ordinary-save rejection, complete history/receipt retention, restart and lost
response retry, existing schema reads, wrong-library and hostile-origin checks,
and each publication interruption point. Use disposable folders on Dominic and
an isolated copy of the private export on its Mac. Actual iCloud, native service
ownership, app activation and human acceptance remain separate required gates.

## Durable reviewed commands

App integration needs a durable pending-command boundary before any transport.
Store complete reviewed command inputs, library identity, base revision,
operation identity and review hashes in an app-owned IndexedDB outbox. A strict
transaction must complete before acknowledging Pending. No fallback to memory
or another library is permitted. Credentials stay outside this store.

The same client calls the existing shared service directly or through its
authenticated loopback API. Reconnect checks the bound library, reads the
operation receipt first, and recreates only the exact reviewed preview when
necessary. Changed revisions or review results require a fresh user review;
never silently rebase queued input. Persist a verified receipt before reporting
Committed. Response loss, revocation, disconnect, write rejection and restart
retain the command for recovery. Retain completed receipts without auto-pruning.

Acceptance includes real IndexedDB close/reopen, transaction abort and denied
write, concurrent queue instances, operation-key collisions, stale revisions,
review expiry/recreation, response loss and wrong-library or revoked transport.
Exercise full real-export input on its original Mac using isolated storage.
This boundary supports later activation; native ownership, picker migration and
complete app mutation wiring remain separate required work.

## App history retention

Before activation, current app saves and reads must obey the preservation
contract. Remove age-based Trash deletion and fallback record-count pruning.
Persist complete experiment, evaluation and case text, candidate lists and
extension metadata. Display pagination remains independent of storage retention.
Explicit permanent deletion and existing stale-write checks remain available.

Acceptance exercises the actual stores past their former count limits, long
content and metadata through save/read/patch/reopen, quota failure without
discarding old records, and old Trash through startup, import and restore.
Existing real-export records are checked on their original host using isolated
storage. This repair does not by itself activate the shared backend or complete
the pending native service and durable outbox integration.

Known-field validation and canonical candidate roles still apply in app records;
the raw source archive remains the lossless record of unsupported shapes. Other
capture boundaries, including shortened chain trace previews and transient forms,
still require their own acceptance before claiming complete app preservation.

## Reviewed current domain view

The preserved record index exposes every source occurrence. A separate immutable
selection review identifies the current records used by shared app/API reads.
It does not create another store: the review names verified source addresses,
is committed through the existing command service and is pinned to a revision.
Prompt choices remain owned by import/reconciliation, including their deletion
policy. Other domains group source-scoped identities; unequal replicas and
records absent from another retained capture require explicit choices. An
inactive choice keeps every source object and historical occurrence.

Acceptance includes all captured domain families, nested history and metadata,
explicit missing-reference evidence, deletion constraints, stale and expired
reviews, restart/idempotency, complete transfers and folder publication failure.
Unknown source coverage or malformed records prevent committing a current view.
Later imports, restore or reconciliation require a fresh selection review.
This contract enables shared reads; native activation, app mutation wiring,
outbox, pairing and real two-client acceptance remain separate required work.

## App prompt save preservation

The existing app save normalizer still trimmed changed prompts to 25 historical
versions and rebuilt records from a fixed field list. Before connecting the
shared library, remove that implicit retention cap and retain extension fields
on valid prompt records, historical versions, variants, embedded cases, inputs
and golden responses. A new historical snapshot must preserve the previous
record without recursively embedding its older history. Existing invalid-input
validation and explicit deletion semantics remain separate contracts.

Acceptance covers saving and reopening a prompt with more than 25 versions,
restoring an old version without pruning either history, preservation of unknown
fields and complete golden text, and the actual app save hook. Test an isolated
copy of the real export on the Mac. This is a prerequisite repair, not proof of
complete active projection, native activation or preservation of every legacy
store's retention policy.

## Reviewed branch reconciliation

The next contract increment combines two verified branches of the same logical
library. It compares each prompt selection with their common ancestor, accepts
independent changes, and requires a reviewed choice when both branches changed
the same selection. Creation timestamps never decide a winner. Both branches,
their raw sources, unknown fields, operation receipts and checkpoints remain
available after the merge. Permanent deletion evidence from either branch still
suppresses a selected prompt. The preview is pinned to both branch revisions;
commit and retry use the existing atomic command and idempotency boundary.

This increment covers imported selection graphs. Whole-workspace snapshots must
first pass the existing import review so matching and Keep choices establish
stable group identities. Other preserved domains remain available through the
record inventory; this increment does not establish an active app projection,
native folder activation, cross-process folder publication, or real iCloud
convergence. Those acceptance gates remain required by the full plan.

Acceptance includes independent and conflicting branch edits, deletion versus
edit, stale reviews, response-loss retry, transfer reconstruction, restore after
merge, and preservation of every original object. Invalid ancestry, conflicting
operation IDs and incomplete deletion evidence must leave the current head
unchanged. Tests run on Dominic with synthetic data. A bounded local check may
use the private export without transferring it off the Mac.

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

### Coordinated origin capture brief

The next increment registers participating app windows before startup writes.
A Web Locks membership gate prevents new participants from starting during a
capture. The capture owner requests each existing participant to pause its
content writers and autosave timers, wait for actual outstanding writes, and
retain its named in-memory editor buffers separately. A missing response,
participant exit, changed buffer, failed write or deadline aborts the capture.
No window's unsaved draft is flushed over another window's shared draft.

The new source inventory version retains per-client buffers as immutable source
evidence and exposes them through shared domain reads. Existing inventory
versions remain readable. No schema migration modifies original app stores.
Browser capabilities are checked explicitly. Unsupported clients retain their
existing app behavior, but cannot claim coordinated capture. Web Locks and
BroadcastChannel cover cooperating contexts in one storage partition, not older
unregistered apps, another browser profile, native processes or iCloud clients.
The capture receipt therefore retains activationReady=false. Final native
ownership, migration activation and lossless active projection remain required.

Verification uses disposable two-window Chromium fixtures, including late joins,
missing clients, owner closure, changed buffers, delayed writes, timeout and
retry, plus actual editor/component debounce coverage. Private export checks
remain local and retain the original unchanged.

### Current context write coordination brief

Migration capture must wait for actual asynchronous writes, including queued
record saves and strict desktop journal commits, and reject new content writes
while its reader is running. Add a shared app write coordinator at the existing
store boundaries. Track completion rather than the first request or an outer
UI timeout. Preserve write retry behavior and all source bytes. A failed drain,
new write attempt, unavailable source or deadline must never become a successful
migration receipt. Keep the pause until an active reader has settled, even when
its deadline expires. Resume existing save behavior after every outcome.

This first layer coordinates the current JavaScript context. It does not fence
other tabs, workers, legacy app versions, native processes or iCloud clients.
Expose an explicit locally drained capture separately from the observational
reader; its receipt states that limited scope and remains activationReady false.
Do not connect a personal folder or activate migration on this evidence. The
next layer must coordinate every participating client and verify ownership,
flush unsaved editor buffers and pending draft timers, then perform destination
readback before switching. Real browser tests must exercise actual store APIs,
queued writes, strict journal completion, failure, interference and recovery.

The shared `lib/libraryWriteCoordinator.js` now tracks record save queues,
whole workspace import attempts, extension draft callbacks, database opens and
both strict desktop journals. Existing local content writers use the same key
authority as raw capture; settings remain outside the pause. Nested operations
use live permits whose synchronous scope never crosses an await. Paused record
writes enter the existing retry queue. Failed keyed writes prevent capture until
a successful retry, and any write attempt during a reader invalidates that
capture even if the UI catches the error. Journal work is registered before its
microtask; transaction tracking waits for abort or completion, not an earlier
error event. A blocked database open remains tracked after an outer UI timeout.

`captureAppLibrarySourcesWithLocalDrain` waits for that tracked work, reads the
current context's actual stores and rejects incomplete inventories. Its separate
coordination receipt identifies only `current-context` scope and always reports
`activationReady: false`. A reader timeout keeps the pause until the reader has
settled. Other clients, queued editor debounce timers, unsaved React buffers and
native process ownership remain outside this first layer and must be addressed
before a complete migration barrier or personal activation can be claimed.

October 29 verification on Dominic Node 22.23.4: all 141 storage tests,
1,517 app tests in 135 files, 231 legacy tests, 14 real Chromium/extension storage
checks and the extension build pass. Coverage includes pending record queues,
whole imports with later stages, both journal records, rejected scheduling and
retry, failed IndexedDB writes, late upgrades after a drain timeout and extension
draft acknowledgement. Final review reproduced a cached first-open rejection
after capture refused a database read. The repair clears that temporary rejected
open so subsequent saves use IndexedDB again. All 14 browser cases, four focused
record/recovery/import tests and the extension build passed after this narrow
repair; the full app suite was run before it. The first broad run passed all
1,516 then-existing tests
but also tried to parse two pre-existing AppleDouble metadata files. Their bytes
were preserved outside the isolated runner's test directory before the successful
final run; no repository test was removed or disabled. The private export recheck
on Mac Node 22.22.1 still matches all 353 occurrences over four pages after folder
reopen, with its original SHA-256 unchanged and 60 unresolved run references.
That export check is not a capture of the user's live app stores.

## Contracts and remaining A1 proof

### Shared domain read brief

App and agent reads need the same addressable records, not only a raw backup.
Map every captured content store and workspace section into a versioned domain
index. Each occurrence retains its original value, object hash, source binding,
replica, path and source ID. Identical workspace bytes from different origins
remain different occurrences. Prompt versions are scoped to their parent prompt;
IndexedDB primary keys remain separate from embedded IDs. Never normalize, cap,
rewrite IDs, choose a newer replica, fetch external assets or invent references.

The shared command service and read-scoped local API expose this preserved-data
view at a pinned revision with bounded pagination. It is not the active app
projection: local mirrors, journal records, fallbacks, exports and historical
bindings remain identifiable copies. Relationships report missing or ambiguous
targets. Malformed and absent stores remain distinct, and unknown fields remain
on their original container records. The migration UI must review conflicting
copies before activation. Existing import selections remain authoritative for
that graph and are not replaced by this read index.

Verify every captured family, more than 25 versions and 1,000 traces, origin and
ID collisions, missing relationships, malformed stores, prototype-named keys,
revision races, API authorization and complete pagination. Compare values with
independently built fixtures and the original private export on the Mac. This
stage changes no existing app writer. The cross-store write barrier, reviewed
causal conflict resolution and app activation remain required subsequent work.

`domain-map.mjs` now derives this view from verified retained commit ancestry.
`createCommandService().records()` and `GET /v1/library/records` use that same
mapping. Each occurrence includes its raw value, value hash and address in an
immutable source object, including the decoding path for JSON stored as text.
The index includes current/history variants, embedded legacy cases, evaluation
candidates, Scratch notes/tombstones, folders, packs, assets, recovery drafts,
all run stores, journal copies, deletion markers and selected backup evidence.
Unknown fields remain on their complete owning values. IndexedDB primary keys
are retained separately from record IDs.

Identities are scoped by source binding; version and candidate IDs also include
their parent identity. Equal IDs never attach a run to another origin. Current
version references may target the original prompt itself. Follow-up, golden,
candidate, Scratch, folder and trace parent/fork references expose every eligible
target, or an explicit missing/invalid state. Multiple copies remain ambiguous
even when their value hashes agree. No preferred replica or active selection is
inferred. The existing import/restore selection graph is unchanged.

Pages require the current revision, recheck it after preparation, allow at most
100 occurrences and reject responses over 64 MiB without truncation. The complete
index rejects over 100,000 occurrences. These bounds are explicit capacity
failures, not history retention limits. Raw reads do not mutate source objects.

October 29 verification on Dominic Node 22.23.4: all 133 storage tests pass,
including 12 domain-read checks, 1,002 indexed traces, 41 versions, unrelated
origins with identical workspace bytes, divergent replicas, malformed stores,
missing references, restored selections, restart, revision races and scoped HTTP
reads. All 63 runtime schema fixtures validate; six malformed responses reject;
shared and OpenAPI schemas match. Documentation lint and four consistency checks
pass. The private export check on Mac Node 22.22.1 enumerates all 353 occurrences
over four pages after folder reopen, with every value matching its original
address and the source file hash unchanged. Its 60 unresolved evaluation-run
references are retained: 45 current prompt results, 12 historical results, two
golden responses and one trash result. They refer to runs absent from that export;
this check does not establish whether other app stores contain those runs.
Personal app-store capture, migration consistency and activation remain open.

### Reviewed checkpoint restore brief

Restore must publish a new commit and a checkpoint of the current head, keeping
every source object, receipt and history object. A bound preview names the current
revision and selected ancestor checkpoint. Applying it after another write fails;
retry after response loss returns the original operation receipt.

Deletion evidence comes from a captured source inventory bound to the exact raw
Library/trash workspace it describes. Store that binding and every capture as
immutable objects on snapshot/import commits. A source identity scopes legacy
prompt IDs; identical IDs from unrelated sources must not share tombstones.
Accumulate append-only markers from the local mirror and Library journal across
retained ancestry. Unknown or malformed deletion evidence never means empty.
Historical snapshots without the required source binding remain readable, but
ordinary restore cannot infer their deletion scope.

The restore graph selects the checkpoint's prompt groups while retaining newer
source records and histories. Current permanent-deletion IDs and generation
markers suppress affected selections, with a reviewable reason. Import after
restore must retain those constraints. No ordinary restore option bypasses them;
intentional reintroduction remains a separate unimplemented confirmed workflow.
Unknown domains remain archived without fabricated materialization. Full domain
mapping, the migration write barrier and native activation are separate A1/A3
gates. Verify restart/idempotency, stale previews, source-ID collisions, malformed
markers, rehashed semantic tampering and publication interruption. Use the real
export only in a new local disposable fixture with test-only deletion markers;
never infer that its omitted metadata proves the personal library has no markers.

### Reviewed restore implementation

`restore-plan.mjs` now builds a review from an earlier retained ancestor
checkpoint and the pinned current revision. `POST /v1/library/restores` requires
write scope and returns the normal expiring preview envelope. Apply uses
`POST /v1/library/commits` and its idempotency key. The receipt distinguishes the
checkpoint made immediately before restore from `restoredCheckpointId`.
Restore appends a commit; it retains every previous object, operation receipt,
checkpoint, raw source and history record. Backup reconstruction verifies and
replays restore receipts through the same contract.

`selection-policy.mjs` evaluates all retained source bindings. Permanent IDs and
clear generations suppress affected groups while retaining a recovery selection
and all members. Inactive groups remain indexed for later imports, preventing a
replacement or old alias from silently reviving an erased prompt. References to
suppressed groups remain recorded with `prompt-not-selected`. The review names
each suppression and reports incomplete, unbound or ambiguous source evidence.
Such a review cannot commit. Bound imports enforce the same policy, including
after restore. Malformed generations cannot be interpreted as absent metadata.

Identical workspace objects bound to different source identities currently produce
an ambiguous-source review. This prevents guessing a deletion scope; explicit
origin-qualified domain mapping remains open. Legacy unbound archives stay
readable but cannot supply the evidence required for ordinary restore. No
option reintroduces permanently deleted content. Full app-domain restoration,
native activation, independent-backup destination selection and an intentional
erasure recovery workflow remain separate gates.

Dominic Node 22.23.4 passes 121 storage tests, including 18 restore cases covering
scope isolation, alias suppression, generation markers, missing evidence, stale
and expired previews, unrelated checkpoints, rehashed tampering, restart/replay,
HTTP scope enforcement and three publication interruption boundaries. The shared
Draft 2020-12 schema validates 41 generated runtime records and rejects six
malformed variants. The private verifier `scripts/verify-library-restore.mjs`
uses a disposable copy of an explicit export and clearly synthetic deletion
metadata. It checks an actual selected edit before restore, original selection
after restore, deletion suppression, complete backup reconstruction and replay.

The October 29 private Mac Node 22.22.1 check passed against the supplied
1,666,421-byte export. Its original SHA-256 stayed unchanged. The disposable
restore retained both raw source versions, 491 indexed records and 42 historical
version records across those sources, 24 objects, three commits/receipts and two
checkpoints. It selected 212 prompt groups and suppressed the single test-deleted
group. The 10,748,670-byte backup reconstructed the complete state and replayed
the restore receipt. These counts include retained records from both sources;
they are not counts of distinct personal prompts or new versions. No personal
app store, real deletion state or iCloud propagation was accepted by this check.

### Bound source evidence

The first restore prerequisite is implemented in `source-binding.mjs`. Snapshot
and import previews accept an optional `sourceInventory`. A binding requires
the current inventory format, a stable local observation, exact raw Library and
trash equality, and exactly the declared capture objects. It retains every
capture and unavailable-source report as immutable objects alongside the raw
workspace. Preview fingerprints include the supplied inventory; receipts name
the binding. Inspection and portable transfer reconstruct and verify that input.
Legacy unbound receipts retain their original fingerprints and stay readable.

`collectDeletionEvidence` unions permanent IDs and clear generations across
retained bindings by explicit source identity. It also reads the desktop Library
journal without selecting it over the local mirror. Malformed markers, unknown
journal shapes and unavailable journals produce incomplete evidence with stable
codes. They never become empty deletion sets. A workspace without a binding has
no inferred deletion scope; equal prompt IDs alone do not join source identities.

The reviewed restore and bound-import policy above consume this evidence.
A stable local capture does not prove a cross-store write barrier or
complete domain materialization. The real-export verifier
`scripts/verify-library-source-binding.mjs` exercises full transfer, reconstruction
and replay in fresh disposable folders, with clearly synthetic capture/deletion
metadata. It does not read the user's actual app stores or establish their
deletion state.

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
replacing an existing library. The reviewed checkpoint restore above publishes
a separate commit with deletion suppression and a pre-restore checkpoint.

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
Checkpoint restore is available through the separate reviewed write route above.

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
receipt, checkpoint, deletion review, restore plan and outbox envelopes.
`openapi-v1.json` labels available candidate routes. These files are draft
contracts, not evidence of installed service or app acceptance.

Preview binds library identity, revision, exact source, operation mode and
resolutions for five minutes. Snapshot operations reject nonempty resolution
maps; import operations use the shared planner. Apply persists operation identity
with state; response-loss retries return the original receipt and changed-input
retries conflict. The app is not connected to this service yet.
Ordinary app import application, complete domain restoration, field-level causal
reconciliation and reviewed fork resolution remain open.

The local API rejects wrong Host/Origin, absent/expired/revoked credentials,
wrong library and insufficient scope. It binds 127.0.0.1, uses no cookies and
does not accept URL credentials. Secure pairing, keychain integration, installed
service ownership and native packaging remain open. It is not automatically
started. Checkpoint reads and reviewed restore writes are available in this
unconnected service candidate.

## Verification and next gates

### Atomic folder command brief

Folder changes must publish their folder records, collection paths and affected
prompt assignments together. Reuse the current app rules: stable folder IDs,
descendant path updates on rename or move, no cycles or duplicate sibling names,
and removal only after child folders have moved. Removing a leaf folder keeps its
prompts in All prompts. Legacy collection names containing slashes remain literal
root names until explicitly changed.

The shared planner takes a reviewed folder/collection/prompt projection and a
single explicit create, change or remove request. It pins the complete input by
hash and, for existing folders, pins the target record. It returns one complete
successor projection and a reviewable list of changed identities and paths.
Unknown fields and unrelated records remain unchanged. Existing history is never
trimmed; malformed or contradictory folder references fail before mutation.

Acceptance covers nested rename/move, leaf removal, literal legacy paths, ID
and path collisions, stale input, unknown metadata, large histories, and the real
export on an isolated copy. This pure planning boundary does not acknowledge a
save. The service implementation below supplies publication and recovery;
app integration and activation remain required before the folder command ships.

The shared service boundary publishes changed folder identities and affected prompt
revisions in one immutable commit. Collection strings become a compatibility
projection of selected folder identities after the first folder command for that
source. This avoids resurrecting old paths during concurrent renames. The service
requires complete source evidence, retains removed folders for checkpoint restore,
and rejects mixed branch choices with inconsistent parent paths or assignments.
The existing preview, receipt, backup and durable outbox contracts also apply to
folder commands. Acceptance includes interrupted publication, restart,
idempotent retries, concurrent independent and conflicting changes, checkpoint
restore, authenticated API parity and the private export. No dependency, automatic
service startup or personal-library activation is introduced by this boundary.

The [folder service planner](../library-storage/folder-plan.mjs), authenticated
`/v1/library/folder-mutations` route and durable outbox now support creation,
rename, move and confirmed removal. Removed folders remain retained for restore;
their IDs cannot be reused. Current collection paths follow selected folder
identities. Conflicting parent paths, duplicate sibling names and dangling prompt
assignments block reconciliation. Every affected prompt gains a prior revision;
existing history and unknown fields remain intact.

Dominic Node 22.23.4 passes all 274 storage tests, including
[ten service cases](../library-storage/folder-command.test.mjs), documentation
lint and four documentation contracts. Shared and OpenAPI schemas agree: 36 new
and 55 earlier runtime fixtures validate; 42 malformed folder requests reject.
The real export on the Mac passes atomic rename of 116 assigned prompts,
reopen and receipt replay, retention of all prior objects and receipts, and
preservation of unrelated selected domains. It retains all 216 prompts, 18
folders, two Trash records and three runs, adding 116 prior prompt revisions.
The original 1,666,421 bytes remain unchanged and no private data was uploaded.

Earlier real-data performance and restore acceptance were incomplete. The initial
combined check reached its 55-second bound after rename publication; the
read-only resume and receipt replay passed in 8.839 seconds. A separate restore
published its checkpoint but reached its 45-second bound before selection and
complete transfer verification finished. The disposable state and initial logs
are retained. Synthetic checkpoint and transfer cases pass; they do not close
the unfinished private-data restore or scale gates.

Restore performance follow-up: a synthetic 216-prompt profile on Dominic spent
most CPU time serializing and hashing the same retained objects. Verification now
owns and freezes each input object before awaiting work, then reuses only that
immutable copy's serialization and digest. Mutable caller values and new disk
reads never inherit a previous verification result. Returned values remain
independent copies. Five regression cases cover changed input, wrong hashes and
kinds, retained corruption, asynchronous mutation, changing accessors, depth
limits and unchanged wire serialization. This changes neither the journal format
nor the preservation/acceptance gates.

The same synthetic fixture on Dominic Node 22.23.4 improved restore apply from
10.204 to 7.775 seconds and restored-state inspection from 4.560 to 3.258 seconds.
These are single CPU-profile observations, not a latency or scale guarantee.
The retained private restore was resumed without another import, rename or
restore publication: its missing selection completed in 22.975 seconds, and
subsequent exact selected-domain readback plus complete transfer verification
passed in 10.576 seconds on Mac Node 22.22.1. All 216 prompts, 18 folders, 18
collections, 21 original history records, two Trash records and three runs match
the pre-rename view. Every prior object and operation receipt remains retained;
the original export bytes/hash are unchanged. Initial timeout evidence above is
preserved. This closes that interrupted disposable restore check only. Actual
app capture, native activation, two-client iCloud, scale and human acceptance
remain separate requirements.

The final candidate passes all 279 storage tests on Dominic Node 22.23.4,
including the five immutable-snapshot regressions. The extension build,
documentation lint and four documentation contracts pass. The three changed
implementation/test files match the runner by SHA-256. Earlier timeout receipts
and synthetic profile logs remain available separately from these passing checks.

The [shared planner](../library-storage/folder-transaction.mjs) and its
[ten focused cases](../library-storage/folder-transaction.test.mjs) are implemented.
Dominic Node 22 passes all 264 storage tests and documentation checks. The private
Mac export check renamed each of its 18 folders independently, covering 170
assigned prompts while retaining all 216 prompts, 21 history records, two Trash
records, three runs and every other source field. Disposable creation/removal
also passes. Original bytes and hash remain unchanged; no private data was
uploaded. These are pure planner results, not publication or activation receipts.

Run `npm run test:library-storage` from the source root under Node 22.
Use `node scripts/verify-folder-export.mjs` with an explicit export path for the
private local acceptance harness. Do not put that input into CI or Git.
Use `node scripts/verify-library-import.mjs` with that explicit path for disposable
graph import, repeat, reopen and receipt acceptance. It emits aggregate evidence
and retains the disposable folder locally for inspection.
Use `node scripts/verify-library-transfer.mjs` with an explicit private export
path for complete backup-file readback and new disposable adapter reconstruction.
This harness is not a public restore command or personal-library activation.
Use `node scripts/verify-library-restore.mjs` with the same explicit private
export path for reviewed checkpoint restore and subsequent independent backup
reconstruction. Its deletion markers and app-store inventory are synthetic;
the original file stays unchanged and no personal app library is activated.

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
