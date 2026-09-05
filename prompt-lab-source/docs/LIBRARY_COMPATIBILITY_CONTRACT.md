# Library compatibility contract

This contract covers implementation-plan J and the L/N regression controls. It does not claim installer acceptance or production readiness. The canonical implementation lives in the shared extension source; shell behavior still requires separate runtime proof.

## Navigation and matching

Create → Library is the canonical prompt index. Smart views, collection/tag filters, status filters, selection, and the inspector operate on the same local Library. Composer uses that Library to add editable blocks. Dual Pane remains an authoring layout, not another database.

`matchesLibrarySearch` is the canonical case-insensitive matcher. Every whitespace-separated term must appear somewhere in title, original/enhanced content, notes, collection, tags, purpose, owner, status, or compatibility metadata. Terms may match different fields. Library and Composer use identical matching; their result presentation and smart-view filters differ.

Decision: retain the newer Library's multi-term matching and metadata fields, and apply that behavior through the shared matcher. This resolves the reproduced Library/Composer disagreement. Tradeoff: older Composer phrase searches may return additional entries when terms occur apart. Verification: identical fixtures and queries produce the same matching IDs; an absent term excludes the entry in both surfaces.

`sortLibraryEntries` owns ordinary Library sort behavior. Newest uses the latest valid `packLoadedAt`, updated, or created timestamp with deterministic ID tie-breaking. A newly loaded old starter pack therefore appears in Newest. Recent, Frequently used, and Recently Deleted retain their explicitly named specialized order. Manual order changes use the filtered visible IDs; hidden prompts retain their relative order. Keyboard move controls expose the same operation in the canonical index.

Deleting the active collection unassigns its prompts and resets the collection view to All prompts. Failed writes report the stage that failed. If prompt unassignment is acknowledged but registry removal fails, the old collection remains available for explicit retry; the UI does not report completed removal. Deleting a collection is distinct from deleting its prompts or permanently deleting Library records.

## Local persistence and synchronization

Decision: synchronization between devices or different shell storage origins is explicit export/import. There is no new account-backed, peer-to-peer, or remote synchronization service in this workstream. Shared-origin tabs reconcile local storage events; a shared login does not synchronize local prompts.

Why: this preserves the approved local-first architecture and keeps offline authoring, Library use, and export available without a public backend. Tradeoff: users explicitly transfer files and review conflicts; deletion in one installation does not automatically remove records from another. Verification: no provider or backend request is needed for local save, reload, search, reorder, deletion, or file transfer.

- Library uses normalized records in `pl2-library`; recoverable trash uses `pl2-library-trash`. Provider keys are separate from exported workspace metadata.
- Permanent deletion and clear use append-only markers and logical Library generations. Stale events and delayed writes cannot restore removed records. Explicit import joins the destination generation; deletion markers are not exported as commands to another installation.
- Shared-origin reconciliation chooses per-record mutations using existing clocks/tombstone counters. It is not character-level collaborative editing. Concurrent edits to the same prompt do not produce an automatic semantic merge.
- Scratch has its own migration, acknowledged-write, revision, and conflict contracts. A rejected migration write retains readable notes. Experiment history uses IndexedDB with acknowledged localStorage fallback and a visible session-local retry queue.
- Workspace import is staged, not atomic across all stores. Preview validates before writes; exact duplicates reuse survivors, different-body conflicts require Keep both/Replace/Skip. Replacement preserves target identity and previous versions. Confirmation re-reads the destination; changed state requires a refreshed preview. Partial failure retains stable IDs and retries only unacknowledged stages while the tab remains open.
- Required imported associations are validated; optional missing source references remain explicitly unresolved. Import never assigns follow-up provenance to a coincidentally equal local external ID.
- Current exports use an object for the pack registry. The import normalizer accepts the empty-array representation emitted by older Prompt Lab schema-2 exports, converting that known empty shape to an object; arbitrary malformed pack registries still fail validation.
- Keep exports and unsaved buffers before upgrading mixed-version tabs. Reload older clients after clear/deletion; they cannot enforce a contract absent from their code. Do not compact deletion metadata without a separately reviewed migration.

## Field and operation compatibility

| Field or operation | Extension | Hosted/local web | Tauri desktop | Native SwiftUI under D-011 |
| --- | --- | --- | --- | --- |
| Prompt ID, title, original/enhanced text, notes, variants, tags, dates | Shared normalized Library | Shared normalized Library, browser-origin storage | Shared normalized Library, webview-origin storage | Native fields imported/exported |
| Collections, metadata, versions, test definitions, golden references | Native shared-UI operations and JSON | Same shared-UI operations and JSON | Same shared-UI operations and JSON | Unknown fields retained in raw entry/document JSON; not all have native editing UI |
| Follow-up provenance | Generate, view, independent save, JSON | Same shared behavior | Same shared behavior | Retained through JSON, including after native content edits; no native follow-up-generation parity claim |
| Shared workspace runs and Scratch | Applied by staged workspace import/export | Applied by staged workspace import/export | Applied by staged workspace import/export | Imported envelope extras retained for re-export; not claimed to populate native RunRecord/Pad stores |
| Provider settings | Chrome storage and background transport | Web settings/hosted transport contract | Local settings/direct native-shell transport | Keychain, native provider contract |
| File import | Preview and merge/conflict choices | Preview and merge/conflict choices | Preview and merge/conflict choices | Validate/preview then transactional replacement of native Library |
| Same-origin tab reconciliation | Shared origin tabs | Same browser origin/profile | Separate webviews only where the runtime shares storage | Native persistence; no shared browser-event contract |
| Cross-shell/device transfer | Explicit JSON | Explicit JSON | Explicit JSON | JSON compatibility boundary only |

Native source: `prompt-lab-ios/PromptLab/LibraryInterchange.swift` stores raw entry and envelope JSON, returns an unchanged import byte-for-byte, and overlays editable native fields when content changes. The native fixture test checks unknown metadata and follow-up provenance after both paths. This is compatibility preservation, not feature parity.

## Verification and remaining gates

Reproducible shared checks, from `prompt-lab-source/prompt-lab-extension` with Node 22:

```sh
npx vitest run src/tests/LibraryWorkspace.test.jsx src/tests/libraryMatching.test.js src/tests/usePromptLibrary.sorting.test.js src/tests/usePromptLibrary.test.jsx src/tests/workspaceImportPreview.test.js src/tests/followUpProvenance.test.js
npm run build
npx playwright test e2e/library-compatibility.spec.js e2e/library-deletion.spec.js e2e/import-preview.spec.js e2e/follow-up-provenance.spec.js
```

`library-compatibility.spec.js` always checks the assembled extension. Set `PL_COMPAT_WEB_URL` to an owned local web `/app/` URL and `PL_COMPAT_DESKTOP_URL` to an owned built desktop-frontend URL to run the same fixture scenarios. The latter is explicitly frontend proof, not a Tauri native launch. Tests use disposable profiles and block provider calls.

Required scenarios: Newest with an older authored/newly loaded starter; Library/Composer metadata and multi-term search; filtered keyboard reorder; active collection deletion/unassignment/reset; follow-up parent/child source inspection; persistence after reload. The existing import/deletion/recovery suites supply negative and cross-tab controls. Native JSON compatibility is checked by the iPhone/iPad CI suite; a local Swift parse only checks syntax.

Before marking J complete, attach exact commit/test/browser/native evidence and run restart/storage checks in the actual Tauri app. Before marking I complete, execute the separate package lifecycle checklist on each supported host. Canonical signed-in production web behavior, actual native desktop lifecycle, and any unavailable host remain Unknown until their owning runtime is exercised. Do not close umbrella records from this document's presence alone.
