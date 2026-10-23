# Account library sync — build slices

Status: `working`. Build plan for [account-library-sync.md](account-library-sync.md). Each slice lists the files it touches, the checks that close it, and a prompt to paste into Codex. Written 2026-10-23. Do not start slice 1 until D-016 / DEC-87 is made.

| Slice | Owner | Needs first |
|---|---|---|
| 1. Policy docs | Codex | D-016 made |
| Provision Neon | Dave | Slice 1 merged |
| 2. Migration and API | Codex | Neon provisioned |
| 3. Shared client | Codex | Slice 2 merged |
| 4. Web UI | Codex | Slice 3 merged |
| 5. Launch | Dave, then Codex | Slice 4 merged and counsel sign-off |

## Slice 1: Policy docs

Docs only. Closes when `npm run docs:check` passes and the PR merges.

| File | Change |
|---|---|
| `docs/DECISIONS.md` | Move D-016 to resolved with the date and Dave's choice |
| `docs/LIBRARY_COMPATIBILITY_CONTRACT.md` | Rewrite the sync decision paragraph and the Sync policy row only |
| `ARCHITECTURE.md` | Persistence section notes the planned opt-in server copy |
| `docs/privacy-account-sync-draft.md` | New. Draft privacy section for counsel |
| `docs/terms-account-sync-draft.md` | New. Draft terms wording for counsel |
| `DOCS_INVENTORY.md`, `docs/docs-map.md` | Register the two drafts; mark the spec Active |

Acceptance:

- [ ] D-016 reads resolved in DECISIONS.md in the existing entry format.
- [ ] Only the sync paragraph and Sync policy row changed in the compatibility contract.
- [ ] Both drafts exist; `privacy.html`, `../docs/privacy.html` and `terms.html` are untouched.
- [ ] `npm run docs:check` passes and the PR merged with required checks green.

Codex prompt:

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) on a new branch named codex/library-sync-policy-docs. Follow AGENTS.md and prompt-lab-source/CLAUDE.md and use Node 22. Change documentation only: no runtime code and no edits to deployed pages. Dave has made decision D-016: opt-in, account-backed library sync on Neon Postgres, per prompt-lab-source/docs/account-library-sync.md.

1. In prompt-lab-source/docs/DECISIONS.md, move D-016 from Open decisions to Resolved decisions, set Status resolved and Date resolved to today, and fill Decision, Rationale and Consequences from the spec. Keep the existing entry format.
2. In prompt-lab-source/docs/LIBRARY_COMPATIBILITY_CONTRACT.md, rewrite only the decision paragraph under Local persistence and synchronization and the Sync policy row of the criteria table: signed-in web users can opt in to account sync per docs/account-library-sync.md, and export and import stay for cross-account moves and for shells without sign-in.
3. In prompt-lab-source/ARCHITECTURE.md, add to the Persistence section that an opt-in server copy is planned behind LIBRARY_SYNC_ENABLED, linking docs/account-library-sync.md.
4. Create prompt-lab-source/docs/privacy-account-sync-draft.md and prompt-lab-source/docs/terms-account-sync-draft.md as draft text for counsel: what account sync stores, where (Neon, US East), that it starts only after opt-in, how Delete synced data works, and that the database provider keeps a 6-hour restore history on the Free plan. Do not edit privacy.html, docs/privacy.html or terms.html.
5. In prompt-lab-source/DOCS_INVENTORY.md, register both drafts as Draft and change docs/account-library-sync.md to Active; add both drafts to prompt-lab-source/docs/docs-map.md under Product or architecture work.
6. Run npm run docs:check from prompt-lab-source and fix everything it reports.
7. Commit, push, open a PR titled "Record account library sync decision and draft policy text", and merge it per the AGENTS.md merge policy once required checks pass. Then complete the AGENTS.md Notion Issue Backlog and project-progress updates, and report the PR link, merge commit SHA and check results.
```

## Provision Neon (Dave)

Unblocks migrations and the API integration suite.

1. Open the Neon listing on the Vercel Marketplace at `https://vercel.com/marketplace/neon/neon` and click Install.
2. In the Install Neon window, choose Create New Neon Account, then click Continue.
3. Accept the terms. Pick region US East (N. Virginia), plan Free, name the database `promptlab-library`, and click the create button at the bottom of the window.
4. On the database's Storage page, click Connect Project.
5. Choose prompt-lab and tick Development, Preview and Production.
6. Open Advanced Options, then Deployments Configuration, and turn on Preview so each preview gets its own database branch.
7. Click Connect.
8. Open the prompt-lab project's Environment Variables page and confirm `DATABASE_URL` and `DATABASE_URL_UNPOOLED` are listed.
9. On that page, add key `LIBRARY_SYNC_ENABLED` with value `false`, tick only Production, and click Save. Add it again with value `true`, ticking only Preview.

## Slice 2: Migration and API

Ships the schema and the three routes, switched off in production. Closes when `npm run test:api` passes with the new suite and production answers `syncDisabled`.

| File | Change |
|---|---|
| `db/migrations/0001_library_sync.sql` | New. The two tables and the index |
| `scripts/db-migrate.mjs` | New. Applies migrations in order and records them in `schema_migrations` |
| `api/library/pull.js`, `push.js`, `index.js` | New routes: pull, push, delete |
| `api/_lib/libraryStore.js` | New. SQL and transactions, plus an in-memory store for tests |
| `api/_lib/librarySync.js` | New. Validation, limits, rate limit, `canUseLibrarySync`, JSON responses |
| `tests/library-sync.test.mjs` | New API suite |
| `package.json` | `@neondatabase/serverless`, `db:migrate`, new suite in `test:api` |
| `vercel.json` | `api/library/*.js` with `maxDuration: 10` |

Reuse `api/_lib/allowedOrigins.js` for CORS and follow `tests/billing-auth.test.mjs` for signed test tokens.

Acceptance:

- [ ] The migration applies to the Production database and a second run is a no-op.
- [ ] `npm run test:api` passes with `library-sync.test.mjs` included.
- [ ] Production `GET /api/library/pull` returns `syncDisabled: true`.
- [ ] A preview deployment with the flag on returns an empty record list for a signed-in test account.
- [ ] No route reads `user_id` from the request body.

Codex prompt:

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) on a new branch named codex/library-sync-api. Follow AGENTS.md and prompt-lab-source/CLAUDE.md, use Node 22, and treat prompt-lab-source/docs/account-library-sync.md as the contract. Neon is already connected to the Vercel project, so DATABASE_URL and DATABASE_URL_UNPOOLED exist in Preview and Production, and LIBRARY_SYNC_ENABLED is false in Production and true in Preview.

Build the server half of account library sync. Do not touch client code.

1. Add @neondatabase/serverless to prompt-lab-source/package.json.
2. Create prompt-lab-source/db/migrations/0001_library_sync.sql:
   create table library_accounts (user_id text primary key, rev bigint not null default 0, enabled_at timestamptz not null default now(), updated_at timestamptz not null default now());
   create table library_records (user_id text not null references library_accounts(user_id) on delete cascade, kind text not null check (kind in ('prompt','folder','collection','marker')), id text not null, rev bigint not null, body jsonb, deleted_at timestamptz, tombstone_version integer not null default 0, client_clock timestamptz, device_id text, updated_at timestamptz not null default now(), primary key (user_id, kind, id));
   create index library_records_user_rev on library_records (user_id, rev);
3. Create prompt-lab-source/scripts/db-migrate.mjs that applies every file in db/migrations in name order over DATABASE_URL_UNPOOLED, records applied names in a schema_migrations table, and skips ones already applied. Add the script "db:migrate" to package.json with the existing check:node prefix.
4. Create prompt-lab-source/api/_lib/libraryStore.js. Export createLibraryStore({ connectionString }) backed by Neon over the pooled DATABASE_URL, createMemoryLibraryStore() with identical behavior for tests, and getLibraryStore() plus setLibraryStoreForTests(store). Methods: pull(userId, since, limit), push(userId, deviceId, records), deleteAccount(userId).
   - pull returns rows with rev greater than since in ascending rev order, plus nextSince, hasMore and serverRev. An account with no row returns no records and serverRev 0 and creates nothing.
   - push upserts the library_accounts row, then in one transaction holding that row's lock checks each record: a missing row expects baseRev 0, a stored row expects baseRev equal to its rev. A match writes the record with the account's next rev. A mismatch writes nothing for that record and returns the stored copy as a conflict. Marker records skip the check, insert if absent, and are always accepted. A marker with id deleted:<promptId> also sets that prompt row's body to null and deleted_at to now with a new rev. A marker with id clear:<generation> does the same for every prompt row whose body metadata.libraryGeneration compares lower as a string, treating a missing value as '0'.
   - deleteAccount deletes the library_accounts row so the cascade removes every record.
5. Create prompt-lab-source/api/_lib/librarySync.js with request validation, JSON response helpers that use corsHeadersForRequest and corsRejectionResponse from api/_lib/allowedOrigins.js, canUseLibrarySync(identity) returning true, the LIBRARY_SYNC_ENABLED check through isFeatureEnabled from api/_lib/runtimeSafety.js, and a rate limit of 120 requests per minute per user counted in Upstash Redis over KV_REST_API_URL and KV_REST_API_TOKEN with incr and expire, the same pattern api/_lib/telemetryStore.js uses. Preview has no Redis variables, so skip the limit when they are absent outside Production, and fail closed with 503 when they are absent in Production. Do not import from stripeBilling.js.
   - Limits: kind must be prompt, folder, collection or marker; id must be 1 to 200 characters; each body at most 256 KB serialized; at most 100 records and 1 MB per push; pull limit defaults to 500 with a maximum of 1000.
   - Errors return { ok: false, error, retryable }: 400 for bad JSON, an unknown kind, a missing id or an oversized record; 401 for a missing or invalid token; 403 when canUseLibrarySync is false; 405 for a wrong method; 413 for an oversized batch; 429 with Retry-After for the rate limit; 500 or 503 for store failures. Logs carry counts, status and timing, never record bodies.
6. Create the routes with the same structure as api/billing/license.js: createNodeCompatibleHandler, OPTIONS through the CORS helper, origin rejection, then the kill switch, which returns 200 { ok: true, syncDisabled: true, retryable: false } when LIBRARY_SYNC_ENABLED is off, then verifyClerkRequest, using clerkUserId as user_id and ignoring any user id in the body.
   - api/library/pull.js handles GET /api/library/pull.
   - api/library/push.js handles POST /api/library/push and returns { ok, accepted: [{ kind, id, rev }], conflicts: [{ kind, id, server }], serverRev }.
   - api/library/index.js handles DELETE /api/library and returns { ok: true, deleted: true }.
7. Add "api/library/*.js": { "maxDuration": 10 } to the functions block of prompt-lab-source/vercel.json.
8. Write prompt-lab-source/tests/library-sync.test.mjs on node:test, signing tokens with a generated key pair the way tests/billing-auth.test.mjs does, against the memory store. Cover: 401 without and with a bad token; OPTIONS 204; a disallowed origin rejected; the kill switch response; a new record accepted at baseRev 0 with an increasing rev; a stale baseRev returning the server copy and writing nothing; a mixed batch partially accepted; marker idempotence; a deleted marker nulling the prompt body; a clear marker nulling only older generations; 400 for an unknown kind, a missing id and a 257 KB body; 413 for 101 records; 429 after 120 requests in a minute; pull ordering and paging through nextSince and hasMore; pull for an unknown account creating nothing; delete cascading; a user_id field in the body never reaching another account. Add the file to the test:api script.
9. Run npm run test:api and npm run build from prompt-lab-source and fix every failure.
10. Run npm run db:migrate against the Production database, reading DATABASE_URL_UNPOOLED from vercel env pull --environment=production into an ignored local env file that is never committed. Preview database branches created after this copy the tables. Then commit, push, open a PR titled "Add account library sync schema and API behind LIBRARY_SYNC_ENABLED", and merge it per the AGENTS.md merge policy once required checks pass. After the production deploy, confirm GET https://promptlab.tools/api/library/pull with a signed-in token returns syncDisabled true. Complete the AGENTS.md Notion Issue Backlog and project-progress updates and report the PR link, merge commit SHA, migration output and check results.
```

## Slice 3: Shared client

Builds the sync engine in the shared frontend with no visible UI. Closes when the extension test suite passes and two simulated devices converge in a unit test.

| File | Change |
|---|---|
| `prompt-lab-extension/src/lib/apiBase.js` | New. `getApiBase()` moved out of billing; `getBillingApiBase` re-exports it |
| `prompt-lab-extension/src/lib/librarySync.js` | New. Transport, `mergeSyncedRecord`, shadow hashing, starter collapse, `runSyncPass` |
| `prompt-lab-extension/src/hooks/useLibrarySync.js` | New. Triggers, Web Lock, backoff, status. Not mounted until slice 4 |
| `prompt-lab-extension/src/hooks/usePromptLibrary.js` | New `applySyncedRecords` through the acknowledged writers; export the clock and reconcile helpers |
| `prompt-lab-extension/src/lib/seedTransform.js` | Fixed starter ids |
| `prompt-lab-extension/src/lib/billing.js` | `getBillingApiBase` delegates to `getApiBase` |
| `prompt-lab-extension/src/tests/librarySync.test.js` | New Vitest suite |

Acceptance:

- [ ] `npm test` passes in `prompt-lab-extension`.
- [ ] Merge tests cover tombstone order, clock order, the server-wins tie, and version preservation.
- [ ] Newly loaded starter packs get fixed ids; existing records keep theirs until a first sync collapses untouched copies.
- [ ] Two simulated devices on a fake transport converge after creates, edits, trash, restore and permanent delete.
- [ ] No visible UI change ships, and the hook is not mounted.

Codex prompt:

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) on a new branch named codex/library-sync-client. Follow AGENTS.md and prompt-lab-source/CLAUDE.md, use Node 22, and treat prompt-lab-source/docs/account-library-sync.md as the contract. The /api/library routes from the previous slice are merged. All code goes in the shared frontend under prompt-lab-source/prompt-lab-extension/src. Ship no visible UI and do not mount the new hook.

1. Move the body of getBillingApiBase from lib/billing.js into a new lib/apiBase.js exported as getApiBase, and make getBillingApiBase return getApiBase() so billing behavior is unchanged.
2. In lib/seedTransform.js, give starter records the id starter:<packId>:<seedPromptId> whenever the seed prompt has an id, keeping randomId() only when it does not. Do not rewrite ids of records already in storage.
3. In hooks/usePromptLibrary.js, export the existing recordClock and the per-record reconcile ordering as reusable helpers, and add applySyncedRecords({ prompts, folders, collections, markers }) that writes through the same acknowledged persistence path as every other library mutation and resolves only after the write is acknowledged. Prompts with deletedAt land in trash. Markers apply through markLibraryDeleted and the existing clear-generation handling in lib/libraryDeletion.js.
4. Create lib/librarySync.js with:
   - Transport functions pullLibrary(since, limit), pushLibrary(deviceId, records) and deleteSyncedLibrary(), each calling getApiBase() + /library/... with Authorization: Bearer from a getToken function passed in. Treat a syncDisabled response as terminal for the session.
   - mergeSyncedRecord(local, server) for prompts: higher tombstoneVersion wins, then the newer recordClock, then the server copy on a tie. When winner and loser content differ by arePromptSnapshotsEqual and the loser is not already in the winner's versions, append it with appendVersionSnapshot, then stamp with stampRecordMutation. Folders and collections use the newer clientClock with the server winning ties.
   - Shadow state per account in localStorage: pl2-sync:<userId>:state holds { enabled, cursor, deviceId, lastSyncAt, lastError } and pl2-sync:<userId>:shadow maps kind:id to { rev, hash }. The hash is SHA-256 through crypto.subtle over stable key-ordered JSON of the normalized record without completeness. A record is dirty when its hash differs from the shadow or it has no shadow entry; a marker is dirty when it is missing from the shadow. deviceId is a random id created once per account per browser.
   - collapseStarterDuplicates(records, shadow): for each local record with metadata.source equal to starter-library and no shadow entry, when it has no versions, a useCount of 0, and title and text equal to its seed, replace it with the fixed starter id record, merging duplicates into one. Never collapse a record that has a shadow entry.
   - runSyncPass({ getToken, userId, library }) that pulls from the cursor until hasMore is false, merges, calls applySyncedRecords, and advances shadow and cursor only after the write resolves; then pushes dirty records in batches of 100 with baseRev from the shadow or 0; updates the shadow for accepted records; merges conflicts, applies them, and pushes again, at most 3 rounds, then records lastError. When a pulled starter record carries a packId missing from pl2-loaded-packs, add it there.
5. Create hooks/useLibrarySync.js taking { clerkUser, clerkGetToken, library }. It runs passes only when the account's state has enabled true and the user is signed in. Triggers: onLocalWrite for library keys with a 2 second debounce; visibilitychange to visible, window focus and the online event immediately; every 60 seconds while visible. Each pass runs inside navigator.locks.request('pl2-library-sync'); without Web Locks, only a visible tab runs passes. Failures back off 5 s, 15 s, 60 s, then every 5 minutes, and reset on success. A 401 refreshes the token once and then pauses with status paused. Expose { status: synced | syncing | offline | paused | disabled, lastSyncAt, lastError, enable, disable, deleteSyncedData, syncNow }. enable() runs the first-enable flow: pull from 0, collapseStarterDuplicates, merge by id, push, and return the counts added, uploaded and merged.
6. Write src/tests/librarySync.test.js in Vitest covering merge ordering, ties, version preservation, starter collapse rules, dirty detection, cursor and shadow moving only after acknowledgement, conflict rounds capped at 3, the syncDisabled stop, and two simulated devices on a fake in-memory transport converging after creates, edits, trash, restore, permanent delete and clear-all. Assert no push payload contains pl2-provider-settings data or a string starting with sk-.
7. Run npm test and npm run build in prompt-lab-source/prompt-lab-extension and fix every failure.
8. Commit, push, open a PR titled "Add shared library sync engine (unmounted)", and merge it per the AGENTS.md merge policy once required checks pass. Complete the AGENTS.md Notion Issue Backlog and project-progress updates and report the PR link, merge commit SHA and test counts.
```

## Slice 4: Web UI

Mounts the engine on the web shell and adds the only visible pieces. Closes when the preview e2e suite passes and the production smoke spec exists, skipping itself while the flag is off.

| File | Change |
|---|---|
| `prompt-lab-extension/src/App.jsx` | Mount `useLibrarySync` only when `clerkUser` and `clerkGetToken` exist |
| `prompt-lab-extension/src/modals/SettingsModal.jsx` | New Account sync section |
| `prompt-lab-extension/src/LibraryWorkspace.jsx` | Status chip with Retry in the `pl-library-toolbar` header |
| `prompt-lab-extension/e2e/library-sync.spec.js` | New. Two browser contexts against a preview deployment |
| `prompt-lab-extension/e2e/production-library-sync.spec.js` | New. `@production` spec for the QA account |
| `../.github/workflows/production-free-account-smoke.yml` | New `sync` scope option |
| `docs/PRODUCTION_FREE_QA_SMOKE.md` | Document the `sync` scope |

Acceptance:

- [ ] Signed out, the web app shows no Account sync section and sends no `/api/library` requests.
- [ ] The toggle starts off; turning it on shows the merge summary.
- [ ] The status chip shows Synced, Syncing, Offline and Sync paused, and Retry runs a pass.
- [ ] Delete synced data confirms, empties the server copy, and keeps local prompts.
- [ ] The preview e2e suite passes every acceptance scenario in the spec except the production-only ones.
- [ ] Extension and desktop builds show no sync UI.

Codex prompt:

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) on a new branch named codex/library-sync-web-ui. Follow AGENTS.md and prompt-lab-source/CLAUDE.md, use Node 22, and treat prompt-lab-source/docs/account-library-sync.md as the contract. The /api/library routes and the unmounted hooks/useLibrarySync.js are merged. Production still has LIBRARY_SYNC_ENABLED false; Preview has it true.

Mount account library sync on the web shell and add its UI. Work in prompt-lab-source/prompt-lab-extension/src unless a step names another path.

1. In App.jsx, call useLibrarySync({ clerkUser, clerkGetToken, library }) only when clerkUser and clerkGetToken both exist, so the extension and desktop shells, which pass neither, get no sync behavior. Pass its result to SettingsModal and LibraryWorkspace.
2. In modals/SettingsModal.jsx, add an Account sync section, shown only when signed in and the hook status is not disabled. It holds a toggle labeled "Sync library to my account", off by default; the line "Syncs prompts, trash, collections and folders to your PromptLab account. API keys and provider settings stay on this device."; and a "Delete synced data" button. The button opens a confirm dialog built with useDialogA11y that reads "Delete your synced library from PromptLab's servers? Your prompts stay on this device." with Delete synced data and Cancel actions, then calls deleteSyncedData and turns the toggle off.
3. Turning the toggle on calls enable(). On success, show a toast through the existing notify path stating the added, uploaded and merged counts it returns. If this browser already holds an enabled pl2-sync state for a different user id, first open a confirm dialog that reads "This browser's library is synced to another account. Merge it into this account?" with Merge and Cancel; Cancel leaves the toggle off.
4. In LibraryWorkspace.jsx, add a compact status chip to the pl-library-toolbar header while sync is enabled: Synced, Syncing, Offline, or Sync paused with a Retry button that calls syncNow. Give it an aria-live polite region, keep it inside the existing toolbar layout at 400 px and 1180 px widths, and use existing theme tokens so light and dark modes both read correctly.
5. Create e2e/library-sync.spec.js for a preview deployment. Read the preview URL from PL_SYNC_PREVIEW_URL and send the x-vercel-protection-bypass header from VERCEL_AUTOMATION_BYPASS_SECRET. Sign in on the Preview Clerk instance with a +clerk_test email and its fixed test code. If the bypass secret or a working preview sign-in is unavailable, stop and report exactly which one is missing instead of weakening the suite. In two browser contexts on one account, cover: convergence after create, edit, trash, restore and permanent delete on each; a concurrent edit keeping the losing text in versions; an edit made with the network blocked syncing on reconnect without overwriting a newer remote edit; first enable merging 30 local and 12 remote prompts into 42 with no duplicate ids; one record per seed prompt after loading the same starter pack on both; zero /api/library requests while signed out; no provider settings or sk- strings in any request body; Delete synced data leaving local prompts intact. Intercept all provider requests.
6. Create e2e/production-library-sync.spec.js tagged @production, reusing e2e/production-auth.mjs and the dedicated Free QA account in two disposable profiles, covering create, edit and delete convergence and Delete synced data, and revoking both sessions at the end. When the API answers syncDisabled, skip with an annotation so the existing all scope stays green.
7. Add sync to the scope options in .github/workflows/production-free-account-smoke.yml so that scope runs only the new production spec, and document the scope in prompt-lab-source/docs/PRODUCTION_FREE_QA_SMOKE.md.
8. Run npm test, npm run build and npm run test:e2e in prompt-lab-source/prompt-lab-extension, run the preview suite against a preview deployment of this branch, and fix every failure.
9. Commit, push, open a PR titled "Add account library sync to the web shell", and merge it per the AGENTS.md merge policy once required checks pass. Complete the AGENTS.md Notion Issue Backlog and project-progress updates and report the PR link, merge commit SHA, preview URL tested and suite results.
```

## Slice 5: Launch

Turns production sync on in three steps: Codex publishes the counsel-approved policy text, Dave flips the flag, Codex runs the production smoke. Closes when `scope: sync` passes in production.

Acceptance:

- [ ] Counsel-approved text is live at `promptlab.tools/privacy` and `promptlab.tools/terms` before the flag flips.
- [ ] `LIBRARY_SYNC_ENABLED` is `true` in Production and the newest deployment was redeployed after the change.
- [ ] Production Free Account Smoke with `scope: sync` passes.
- [ ] The Notion Issue Backlog and `project-progress` carry the run link.

### Step A: publish the policy text (Codex)

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) on a new branch named codex/library-sync-policy-publish. Follow AGENTS.md and prompt-lab-source/CLAUDE.md and use Node 22. Counsel has approved prompt-lab-source/docs/privacy-account-sync-draft.md and prompt-lab-source/docs/terms-account-sync-draft.md exactly as they stand on main.

1. Add the approved Account sync section to prompt-lab-source/prompt-lab-web/public/privacy.html and docs/privacy.html with identical text, placed beside the existing section that describes what stays on the device.
2. Add the approved account sync wording to the data handling part of prompt-lab-source/prompt-lab-web/public/terms.html.
3. Leave effective and last-updated dates unchanged unless the approved drafts state new ones.
4. Set both drafts to Active in prompt-lab-source/DOCS_INVENTORY.md.
5. Run npm run test:landing and npm run docs:check from prompt-lab-source and fix every failure.
6. Commit, push, open a PR titled "Publish account sync privacy and terms text", and merge it per the AGENTS.md merge policy once required checks pass. After the production deploy, confirm https://promptlab.tools/privacy and https://promptlab.tools/terms show the new text, complete the AGENTS.md Notion Issue Backlog and project-progress updates, and report the PR link, merge commit SHA and the two live checks.
```

### Step B: turn sync on (Dave)

1. Open the prompt-lab project's Environment Variables page in Vercel.
2. Find `LIBRARY_SYNC_ENABLED` for Production, open its menu, and click Edit.
3. Change the value to `true` and click Save.
4. Open the prompt-lab Deployments page, open the menu on the newest Production deployment, and click Redeploy. Env changes apply only on a new deploy.
5. Paste the Step C prompt into Codex.

### Step C: production smoke (Codex)

```text
Work in the PromptLab repo (DaveHomeAssist/prompt-lab) and follow AGENTS.md. LIBRARY_SYNC_ENABLED is now true in Production and the newest production deployment was redeployed.

1. Confirm GET https://promptlab.tools/api/library/pull returns 401 without a token.
2. Run the Production Free Account Smoke workflow in .github/workflows/production-free-account-smoke.yml with scope sync through gh workflow run, wait for it to finish, and read the result.
3. If the run fails, rerun it once. If it fails again, stop, report the failing step with its log excerpt, and tell Dave to set LIBRARY_SYNC_ENABLED back to false in Production and redeploy.
4. On success, update the web row of the rollout in prompt-lab-source/docs/account-library-sync.md to shipped with today's date and the run link, through a PR titled "Record account library sync web launch" merged per the AGENTS.md merge policy.
5. Mark the account library sync rows Done in the Notion Issue Backlog with the run link, refresh project-progress per AGENTS.md, and report the run link, results, PR link and merge commit SHA.
```

### Rollback (Dave)

1. Open the prompt-lab project's Environment Variables page, edit `LIBRARY_SYNC_ENABLED` for Production, set it to `false`, and click Save.
2. Redeploy the newest Production deployment from the Deployments page.

Clients stop on their next pass. Server data and every local library stay as they were, so turning the flag back on resumes where sync left off.
