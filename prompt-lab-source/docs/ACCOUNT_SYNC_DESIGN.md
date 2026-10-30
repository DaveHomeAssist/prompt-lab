# Account sync design (hosted, Supabase + Clerk)

Status: built on local branch `labbot/account-sync-2026-10-30`, behind a flag that is off by default. Updated after Fire Watch's re-review (R-01 to R-07); see [section 15](#15-review-status). Nothing is provisioned. No remote Supabase project, Clerk setting, Vercel env var or Chrome Web Store listing has been created or changed. Written Fri Oct 30 2026, ET.

Request: Dave, relayed 6:09 AM ET: real sync for every user. That is, every promptlab.tools user signs in on web, the extension and desktop, their Library follows them across devices automatically, and clearing site data loses nothing.

Relation to [D-016](DECISIONS.md) and [account-library-sync.md](account-library-sync.md): D-016 sequenced an iCloud folder first and hosted storage second, with hosted mode opt-in. This request puts hosted sync first and on for every signed-in user. That is a change of direction only Dave can record. A draft decision is under [Decision record draft](#decision-record-draft) below. This design keeps the parts of that contract it can meet today and lists the parts it does not meet (runs, evals, Scratch, full history beyond what each entry already carries).

## 1. Storage decision

**Supabase Free (Postgres + PostgREST) with Clerk's native third-party auth integration.**

| Need | Why Supabase + Clerk fits |
| --- | --- |
| One identity everywhere | Clerk already signs users in on web. Supabase accepts Clerk session tokens directly (native third-party auth), so there is no second account system and no shared JWT secret. |
| Per-user isolation | Postgres row-level security keyed on the token's `sub` (the Clerk user id), forced on every table, plus SECURITY DEFINER functions that take the id only from the verified token. |
| Conflict handling | Row versions and a server-side transaction per push give per-item optimistic concurrency and a place to keep the losing copy. |
| Cost | $0. Free tier: 50,000 third-party MAU, matching Clerk Hobby's 50,000 monthly retained users. `get_cost` for a new project on Dave's free org: $0/month (read-only check, Oct 30). |
| No new client dependency for data | The client calls PostgREST with `fetch`. No supabase-js. |

Rejected for now:
- **iCloud folder (#248)**: macOS-only in practice, not per-user, cannot serve "every user" on web or Windows. See section 13.
- **JWT-template integration**: deprecated by Supabase since Apr 1 2025 because it shares the project JWT secret.
- **Supabase Auth as the identity**: it would split users from Clerk billing. Supabase Auth sign-ups and anonymous sign-ins must be turned off (rollout step R3) and the database rejects those tokens anyway.
- **Realtime**: not needed. Pull-on-trigger is enough and keeps us off the 200-connection Realtime cap.

## 2. Data model

Migration: [`supabase/migrations/20261030090000_account_sync.sql`](../supabase/migrations/20261030090000_account_sync.sql).

`public.sync_items`, one row per synced item, primary key `(user_id, kind, item_id)`:

| Column | Meaning |
| --- | --- |
| `user_id` | Clerk user id (`user_...`), from the verified token, never from the client |
| `kind`, `item_id` | `prompt:<entry id>` or `structure:main` |
| `payload` | `prompt`: `{ state: 'active' or 'trash', entry }`. `structure`: `{ collections, folders, loadedPacks }`. At most 256 KiB. |
| `deleted` | tombstone (payload is null) |
| `version` | server row version, +1 per accepted write |
| `lamport` | Lamport clock from the writing device (max seen + 1), capped at 2^53 |
| `device_id` | random per-browser-profile id (`pl2-sync-device-id`) |
| `change_seq` | global monotonic sequence; pull cursor position. Set by trigger, never by clients. |
| `write_xid` | writing transaction id, for the pull visibility guard |

Folders, collections and loaded packs sync as one `structure` record because the app validates the folder tree as a whole (unique ids, unique paths, acyclic parents).

`public.sync_conflicts` keeps the losing side of each conflict (payload, device, clock, winning version). Kept: the newest 5 per item, 200 per user and **2 MiB of payload per user**; older copies are evicted first. Conflict bytes also count against the 10 MiB per-user quota (re-review R-01).

`sync.settings` holds the kill switch, accepted issuer, quotas, rate limits and download budgets. `sync.rate` holds per-user, per-minute call counters. `sync.egress` holds per-user and project-wide daily download counters. None is reachable from the Data API.

Reuse of the existing storage layer:
- Reads and writes the same `pl2-library`, `pl2-library-trash`, `pl2-collections`, `pl2-collection-folders` and `pl2-loaded-packs` keys.
- Applies remote deletions with the existing append-only deletion markers, so the open Library hides them through its normal path. Local deletion markers are authoritative: a remote live copy of a permanently deleted prompt is answered with a tombstone, not resurrected.
- Strips and re-stamps the device-local `libraryGeneration` (Clear Library) stamp.
- Engine writes call `notifyLocalWrite`, so the desktop IndexedDB journal records them like any other write.
- Every key the engine writes is announced with a synthetic `storage` event, so `usePromptLibrary` adopts it through its existing reconcile path and the #251 stale-write guard stays in force. A remote winner applied over a newer local copy gets `updatedAt` bumped by 1 ms so the reconcile keeps it.

Not synced in v1 (stated in the UI copy and the privacy note): runs and evaluations (separate IndexedDB store), Scratch pads, provider keys and settings, telemetry and billing state, artwork bytes not inside an entry.

## 3. Protocol

All calls are PostgREST RPCs with `apikey: <publishable key>` and `Authorization: Bearer <Clerk session token>`. Clients hold **no table privileges at all**, not even SELECT, so `GET /rest/v1/sync_items` is refused (re-review R-01b). Every read is one of the RPCs below, each rate limited, subject to the kill switch, capped at 2 MiB of payload per response and charged against a daily download budget.

| RPC | Purpose |
| --- | --- |
| `sync_pull(cursor, limit)` | rows with `change_seq > cursor`, oldest first, up to 1,000 rows or 2 MiB; a page cut by the byte cap marks its last row `page_truncated` and the client keeps paging |
| `sync_push(device_id, changes[])` | up to 200 changes and 2 MiB per call |
| `sync_manifest()` | `(kind, item_id, version, deleted)` for every row, no payloads |
| `sync_fetch(keys[])` | full rows for up to 500 named items, up to 2 MiB; the client asks again for the rest |
| `sync_list_conflicts(limit)` | the caller's unresolved conflict copies, newest first, up to 200 rows or 2 MiB |
| `sync_status()` | usage (including conflict bytes and today's download bytes), limits, kill-switch state; works while paused |
| `sync_delete_my_data()` | erase the caller's rows, conflict copies and counters |
| `sync_admin_delete_user(user_id)` | service role only, for the Clerk `user.deleted` webhook |

One sync cycle ([`syncEngine.js`](../prompt-lab-extension/src/lib/sync/syncEngine.js)):

1. Once a day, a manifest check: compare server versions with the local shadow, fetch only rows that are newer, and re-upload anything the server no longer has or has at an older version (for example after a restore from backup). This replaced the daily full re-pull (review F-06).
2. Capture: diff local items against the shadow (`{key: {version, hash}}`) and enqueue changed items. Missing prompts become tombstones.
3. Pull since the cursor and apply. Rows for items with a pending local edit are deferred until the push result.
4. Push the outbox in batches of 100.
5. Results: `applied`, `conflict_won` and `unchanged` update the shadow. `conflict_lost` applies the server copy, from the deferred pull or a `sync_fetch`.
6. If anything was pushed, pull again to advance the cursor past our own rows.

Cursor safety (review F-05): `sync_push` takes `pg_advisory_xact_lock` on the user, so one user's pushes commit in sequence order, and `sync_pull` only returns rows whose writing transaction is older than the snapshot's xmin. The concurrency test reproduces the skip without the lock (2 to 3 skipped changes in 300) and shows none with it.

## 4. Conflict rule

Per item, last writer wins, and the loser is always kept:
- A change applies if its `base_version` equals the stored version.
- Otherwise it is a conflict decided by `(lamport, device_id)`, higher wins. The losing payload goes to `sync_conflicts`.
- Identical content is `unchanged`, not a conflict.

Both devices converge on the winner (tested). Restoring a conflict copy is a normal edit. The restore UI is not built yet (section 12).

## 5. Offline queue

[`syncQueue.js`](../prompt-lab-extension/src/lib/sync/syncQueue.js), persisted in `pl2-sync-queue:<user>`:
- One entry per item; a newer local edit replaces the queued one but keeps the original `base_version`, so a concurrent remote edit is still detected.
- An entry is removed only when the server acknowledges that exact edit (matching Lamport value).
- Backoff on failure: `min(5 min, 2 s × 2^(n-1))` with ±20% jitter, for network, 5xx, 429 and paused (503) errors.
- Status mapping: 401/403 `auth`, 413/507 `quota`, 429 `throttled`, 503 `paused`, other 4xx `error`, network and 5xx `offline`.
- Prompts over 256 KiB stay local and are counted as `tooLarge` instead of blocking the batch.

Triggers ([`useAccountSync.js`](../prompt-lab-extension/src/hooks/useAccountSync.js)): local write (2 s debounce), focus, visibility, `online`, and a 5-minute poll while visible. A `navigator.locks` lock (`pl-sync`) keeps two tabs from syncing at once.

## 6. First sign-in on a device

1. Pull everything.
2. **Snapshot first** (review F-07): copy the raw Library keys to `pl2-sync-snapshot:<user>`. If the snapshot cannot be written (storage full), skip de-duplication entirely and upload duplicates instead of dropping anything.
3. Same id, same content: adopt the server version. Same id, different content: the newer `updatedAt` stays live, and the other copy is sent so the server keeps it in `sync_conflicts` (lamport `max seen + 1` to win, or 0 to lose).
4. Local-only prompts whose content matches an account prompt (same title, original, enhanced and collection, or the same starter-pack prompt) are removed locally, not uploaded. The removal uses one batch deletion marker whose key is recorded in the snapshot.
5. Other local-only prompts upload with `base_version` 0.
6. Collections, folders and loaded packs merge as a union. Folders whose id or path collides, or whose parent did not survive, are dropped from the merge.

Restore ([`syncBackup.js`](../prompt-lab-extension/src/lib/sync/syncBackup.js)) merges the snapshot back: missing prompts return, a snapshot copy wins only if it is newer, nothing current is removed, and the recorded dedupe marker is deleted. An early version replaced the Library wholesale. The e2e test caught that this tombstoned every prompt added since the snapshot, and it was fixed.

## 7. Sign-in per surface

### Web (`/app`)
Already on Clerk (`@clerk/clerk-react`). `App` passes `clerkUser` and `clerkGetToken` to `useAccountSync`. The flag adds the project Supabase origin, and only that, to `/app`'s meta CSP `connect-src` at build time. Nothing else in any CSP changes.

### Extension (MV3 side panel)
- [`extensionAccountAuth.js`](../prompt-lab-extension/src/extensionAccountAuth.js) uses `@clerk/chrome-extension` 3.1.102 with Sync Host `https://clerk.promptlab.tools`. The user signs in on promptlab.tools, and the extension reads that session.
- That file is injected into `panel.html` only by sync builds (`accountSyncExtensionEntry`), so normal builds do not bundle the SDK.
- Manifest, sync builds only (`patchExtensionManifest` in `assemble.js`): adds the `cookies` permission and host permissions `https://clerk.promptlab.tools/*` and `https://<ref>.supabase.co/*`. These raise a new Chrome permission warning, which needs a CWS listing and justification update (rollout R9).
- Token storage (re-review, low): the SDK's client token cache is `chrome.storage.session` (memory only, and by default readable only by trusted extension pages, not content scripts), passed as Clerk's `storageCache` option, instead of the SDK default `chrome.storage.local`. With Sync Host the token is re-read from the promptlab.tools cookie on load, so nothing is lost when the browser closes. See [`clerkSessionStorage.js`](../prompt-lab-extension/src/lib/sync/clerkSessionStorage.js).
- Side panel: Clerk documents Sync Host as not fully supported in side panels. Handling: the SDK's cookie listener (`__experimental_syncHostListener`) reloads when the promptlab.tools session changes; the panel re-checks the session whenever it becomes visible; if there is still no session it publishes `needsReopen`, so the UI can say "close and reopen the panel". This has not been tested in a real Chrome profile.
- The published extension id must be added to Clerk `allowed_origins` (Backend API, Dave) and, if the extension will call `/api`, to `PROMPTLAB_PROXY_ALLOWED_ORIGINS`, which `api/_lib/allowedOrigins.js` already supports.

### Desktop (Tauri)
- Browser sign-in with OAuth 2.0 authorization code + PKCE (S256) through a loopback listener on `127.0.0.1` (RFC 8252). The whole flow runs in Rust, `src-tauri/src/account_auth.rs` (re-review R-04):
  - `account_oauth_begin(clientId)` makes the verifier and state, opens the listener, and returns only the authorize URL. The webview opens it with the shell plugin.
  - `account_oauth_finish(timeoutSeconds)` waits for the redirect, exchanges the code in Rust, puts the refresh token in the OS keychain (`keyring`: macOS Keychain, Windows Credential Manager, Secret Service) and returns only `{access_token, expires_in}`.
  - `account_access_token(clientId)` refreshes from the keychain (rotating the stored token, one refresh at a time) and returns only a short-lived access token; a refused refresh deletes the stored token and returns null.
  - `account_sign_out()` deletes the keychain entry.
  - There is no command that reads the keychain, and the verifier, code and refresh token never reach JavaScript. JS side: [`desktopAuth.js`](../prompt-lab-extension/src/lib/sync/desktopAuth.js).
  - The app has a single window, `main`, and its only capability file grants core defaults, zoom and `shell:allow-open` to that window. No remote URL capability exists. Gating the new app commands per window through a Tauri app manifest was not done, because it cannot be build-verified on this box (no webkit2gtk); with the keychain read removed, the commands expose nothing beyond a short-lived access token.
- Loopback listener (re-review R-05): requests on any path other than `/callback`, or with a missing or wrong `state`, get 404 or 400 and are ignored; the listener keeps waiting until the real redirect or the timeout (30 to 900 s). `state` is compared in constant time. An `error=` redirect with the right state ends the sign-in as cancelled.
- Clerk OAuth access tokens are not Clerk session tokens, and Supabase's Clerk integration needs session tokens (with `role: authenticated`). So [`api/sync/desktop-token.js`](../api/sync/desktop-token.js) checks the access token with Clerk's Backend API (`POST /v1/oauth_applications/access_tokens/verify`, the call behind `@clerk/backend`'s `idPOAuthAccessToken.verify`) and returns a 5-minute Clerk sign-in ticket only if (re-review R-02):
  - `client_id` equals `PL_DESKTOP_OAUTH_CLIENT_ID`, so a token minted for any other OAuth app on the instance is refused;
  - its scopes include `PL_DESKTOP_OAUTH_SCOPES` (default `profile email`);
  - it is not revoked or expired, and `subject` is a Clerk user id.
  It is rate limited per IP (10 a minute) and per user (5 tickets per 10 minutes), through Vercel KV / Upstash REST when configured and per-instance memory otherwise. Off (503) unless `PL_ACCOUNT_SYNC_DESKTOP=on`, `CLERK_SECRET_KEY` and `PL_DESKTOP_OAUTH_CLIENT_ID` are all set; CORS limited to Tauri origins.
- **Not built** (open, R-03): turning the ticket into a session inside the webview (clerk-js in non-browser mode, `standardBrowser: false`). Its client token must also stay in Rust, like the refresh token. This needs Clerk's Native API setting and a Clerk OAuth application for the desktop (Dave, R8) and a real desktop test. Whether Clerk matches a loopback redirect URI with a random port exactly or by prefix is also unverified (R-03).
- CSP and shell scope: `npm run tauri:build:sync` writes a `--config` overlay that adds `https://clerk.promptlab.tools` and the project Supabase origin to `connect-src` and allows the shell to open only `https://clerk.promptlab.tools/oauth/authorize?...` besides promptlab.tools. Normal `tauri build` is unchanged.

## 8. Authentication rules in the database (review F-02)

`sync.current_user_id()` returns null, which means "not signed in", unless every one of these holds:
- `role` is `authenticated`;
- `iss` equals `sync.settings.issuer` (`https://clerk.promptlab.tools`);
- `sts` is absent or `active` (Clerk pending sessions are refused);
- `is_anonymous` is absent or false;
- `sub` matches `^user_[A-Za-z0-9]{1,64}$` (Clerk ids; Supabase Auth uuids are refused).

## 9. Sign-out, account switch, delete and export

- **Sign-out** stops sync and keeps all local data. Queue, shadow and cursor stay scoped to that user id.
- **Different account on the same device:** `pl2-sync-owner` records the account the local Library was merged with. Another account gets status `owner-mismatch` and nothing is uploaded or merged. The choice UI (keep separate, merge or start empty) is not built.
- **Delete my synced data:** `sync_delete_my_data()` erases the caller's rows, conflict copies and counters, even while sync is paused. Local data stays. UI not built.
- **Account deletion** (review F-09): [`api/sync/clerk-webhook.js`](../api/sync/clerk-webhook.js) handles Clerk `user.deleted`. It verifies the Svix signature (HMAC-SHA256, 5-minute tolerance, constant-time compare) before parsing, then calls `sync_admin_delete_user` with the server-only secret key. Non-2xx responses make Clerk retry, and the delete is idempotent. Off (503) until its env vars exist.
  - Raw body (re-review R-07): the deployed Node entry point reads the raw request stream itself and verifies the HMAC over those exact bytes. If a runtime has already drained the stream it accepts only an unparsed Buffer or string body; a framework-parsed object is refused (400), never re-serialized. It also exports `config = { api: { bodyParser: false } }` for runtimes that honor it.
  - `sync_admin_delete_user` takes the same per-user advisory lock as `sync_push`, so a push in flight cannot land after the erase (re-review, low).
- **Export:** `exportAccountData()` (account rows plus conflict copies, as JSON) and the device snapshot file (`snapshotFileText`). Buttons not built.

## 10. Security summary

- Clients hold no table privileges (no SELECT either, re-review R-01b). Every read and write goes through SECURITY DEFINER functions owned by `sync_owner`, a non-superuser role without BYPASSRLS, with `search_path = ''`. Those functions are still subject to owner-only RLS. Clients cannot set `change_seq`, `version`, `lamport` or `write_xid` (review F-04).
- RLS is enabled and forced on both tables, and the only policies are owner-only policies for `sync_owner`. The guard test fails on any `using (true)` policy, any policy reaching a role other than `sync_owner`, any non-owner predicate, any table grant to `anon`, `authenticated` or `PUBLIC`, or any executable function beyond the seven client RPCs (review F-08, R-01b). Mutation check: an open SELECT policy plus an INSERT grant failed 9 tests.
- Quotas (review F-01), enforced in the push transaction, so the whole batch rolls back:

| Limit | Default |
| --- | --- |
| Rows per user, including tombstones | 10,000 |
| Live items per user | 5,000 |
| Payload bytes per user | 10 MiB |
| Bytes per push | 2 MiB |
| Bytes per item | 256 KiB |
| Conflict copies | 5 per item, 200 per user, 2 MiB of payload per user (oldest evicted); conflict bytes also count toward the 10 MiB |
| Whole-project size guard | refuses growth above 400 MiB (`PT507`), on item writes and conflict-only writes |
| Bytes per read response | 2 MiB (client pages) |
| Downloads per user | 32 MiB per UTC day (`PT429`) |
| Downloads, whole project | 150 MiB per UTC day, about 4.4 GiB per 30 days, under Free's 5 GB egress (`PT429`) |

  A batch that shrinks usage, for example deletes, is always allowed.
- Rate limits (review F-10, R-01b): per user per minute, 30 pushes, 12 reads (pull, manifest, fetch and list-conflicts share one counter; a 5-minute poll uses 1 to 3) and 12 status calls (`PT429`).
- Kill switch (review F-17, R-01b): `update sync.settings set value = 'off' where key = 'enabled'` pauses push and every read RPC for everyone immediately (`PT503`); clients back off and keep local data. Status and erasure still work.
- The project-wide download budget is a single counter row, so one heavy user can use it up for everyone for the rest of the UTC day. That trades availability for staying inside Free's egress; the per-user budget makes it take many accounts.
- Secrets: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` reach clients. `SUPABASE_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` are server-only, Sensitive, production only.
- Not mitigated in code: sybil sign-ups beyond the project size guard (rely on Clerk bot protection and email verification, R5); revocation lag of about 60 s, because Clerk session tokens are short-lived and Supabase does not check revocation.

## 11. Free-tier capacity

Sources, fetched Oct 30 2026: [supabase.com/pricing](https://supabase.com/pricing), [clerk.com/pricing](https://clerk.com/pricing), [Supabase Clerk third-party auth](https://supabase.com/docs/guides/auth/third-party/clerk).

| Limit (Free / Hobby) | Value |
| --- | --- |
| Supabase database | 500 MB per project; read-only when exceeded |
| Supabase egress | 5 GB per month (plus 5 GB cached) |
| Supabase third-party MAU | 50,000 |
| Clerk Hobby retained users | 50,000 per app |
| Supabase pause | after 1 week of inactivity; 2 active free projects per org |
| Supabase backups | none on Free |

Estimates, from the payload format and this design's polling. These are not measurements.
- **Storage.** A typical prompt entry is 2 to 4 KB of JSON. Postgres row, TOAST and index overhead is about 1.5×. A 300-prompt user is therefore about 1 to 2 MB; a 100-prompt user about 0.3 to 0.6 MB. With the 400 MiB guard that is roughly 200 to 400 heavy users, or 700 to 1,300 typical users. The 10 MiB per-user cap means one account can never take more than about 2.5% of the database.
- **Egress per user per month**, 2 devices:
  - About 100 visible polls a day × about 0.5 KB × 2 devices × 30 days = about 3 MB.
  - Daily manifest: 300 rows × about 60 B × 2 × 30 = about 1 MB.
  - Changed rows from the other device: about 1 MB.
  - Total about 5 MB, which fits about 1,000 active users in 5 GB.
  - Each new device downloads the whole Library once (1 to 2 MB).
  - The daily full re-pull this replaced would have added about 60 MB per user per month at 1 MB × 2 devices (review F-06).
- **Download budgets** (R-01b) cap the worst case: 32 MiB per user per day and 150 MiB per day for the project, about 4.4 GiB per 30 days, so a scripted client cannot push the project past Free's 5 GB egress. The budget counts payload bytes plus a fixed 128 B per row, not HTTP framing, so real egress is somewhat higher; the margin to 5 GB covers it at these numbers, but watch the Supabase usage page after launch.
- **Binding limits:** egress first (about 1,000 active syncing users), then database size. MAU (50,000) is not binding. Beyond that, Supabase Pro is $25 per month. That is a Dave decision, not assumed here.

## 12. Built, stubbed and not built

| Area | State |
| --- | --- |
| Schema, RLS, definer RPCs, quotas, rate limits, kill switch, issuer and claim checks | Built and tested locally |
| Sync engine: capture, pull, push, conflicts, tombstones, offline queue, manifest check, first run, snapshot, restore, owner guard, oversize | Built and tested (engine e2e against real SQL) |
| Web wiring (`useAccountSync` in `App`, `/app` CSP) | Built; flag off |
| Extension Clerk Sync Host bootstrap, manifest additions, side-panel handling | Built; flag off; not run in Chrome |
| Desktop PKCE and token exchange in Rust, loopback state/path checks, keychain, token bridge with client_id/scope checks and rate limit, CSP overlay | Built; Rust module logic compiled and tested standalone with the same crates (the Tauri command wrappers and a full Tauri build need webkit2gtk, not on the build box) |
| Desktop ticket to Clerk session (clerk-js non-browser mode) | Not built |
| UI: status line, conflict copies, owner-mismatch choice, delete-my-data, export and restore buttons, "close and reopen the panel" hint | Not built (engine and RPCs exist) |
| Runs, evals, Scratch, settings | Not synced |
| Telemetry of sync status counts | Not built |

## 13. PR #248 (iCloud folder library) ranking

**Recommendation: keep #248 as a draft and do not merge it. Fold its contracts and fixtures into this work. Close it once account sync ships, unless Dave still wants a folder export target.**

| | #248 iCloud folder | This work |
| --- | --- | --- |
| Serves every user (web, Windows, extension) | No: macOS desktop plus a paired local service | Yes |
| State | Draft, +47,765 / −911, 220 files, 100 commits, last commit Oct 29 7:58 PM ET; not activated | One local commit, flag off |
| Open blockers | Activation, two-device test, Windows fsync EPERM, iCloud propagation never observed | Provisioning and Dave's rollout steps; desktop session step; UI |
| Conflict model | Divergent commit heads | Per-item LWW with the loser kept |

Worth reusing from #248:
- the preservation contract and its tests (lossless fixture with more than 25 versions, unknown metadata, deletion markers), to extend sync to runs, evals and Scratch;
- the conflict-copy and commit-receipt vocabulary for the restore UI;
- the strict-durability IndexedDB outbox idea, if the localStorage queue proves too small;
- the pack and import fixtures for first-run de-duplication tests.

## 14. Rollout (each step needs Dave)

1. **R1.** Create a Supabase project on the free org (`us-east-1` suggested). `garden-os-online` is paused, so the org stays within its 2 active free projects.
2. **R2.** Apply `supabase/migrations/20261030090000_account_sync.sql`. Run the Supabase security and performance advisors, and confirm the `sync` schema is not in the exposed schemas.
3. **R3.** Supabase Auth: turn off "Allow new users to sign up" and anonymous sign-ins. Leave Realtime off.
4. **R4.** Clerk: open "Connect with Supabase", which adds `role: authenticated` to session tokens. In Supabase, add the Clerk third-party provider with domain `clerk.promptlab.tools`. Production instance only. Do not use a JWT template.
5. **R5.** Clerk: confirm bot protection and email verification for sign-up.
6. **R6.** Vercel env:
   - `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (public).
   - `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` (Sensitive, production only).
   - `VITE_PL_ACCOUNT_SYNC=on` last.
7. **R7.** Clerk webhook endpoint `https://promptlab.tools/api/sync/clerk-webhook` for `user.deleted`.
8. **R8.** Desktop: a Clerk OAuth application (public client, PKCE, loopback redirect), the Native API setting, then Vercel env `PL_DESKTOP_OAUTH_CLIENT_ID` (that app's client id) and `PL_ACCOUNT_SYNC_DESKTOP=on`, then build the session step. Optional: `PL_DESKTOP_OAUTH_SCOPES`.
9. **R9.** Extension: add the published extension id to Clerk `allowed_origins`; CWS permission justification for `cookies` and the new hosts; then a sync build.
10. **R10.** Approve the privacy and terms additions in [ACCOUNT_SYNC_PRIVACY_NOTE.md](ACCOUNT_SYNC_PRIVACY_NOTE.md); they are not on the live pages.
11. **R11.** Backups: set up the weekly export in [ACCOUNT_SYNC_BACKUP_RUNBOOK.md](ACCOUNT_SYNC_BACKUP_RUNBOOK.md).
12. **R12.** Flip the flag for web first, then the extension, then desktop.

Rollback: kill switch (`enabled = off`) for an immediate server pause; unset `VITE_PL_ACCOUNT_SYNC` and redeploy to remove the client. Local data is never deleted by either.

## Decision record draft

Proposed `D-0xx`, for Dave to accept or edit: hosted account sync (Supabase Free + Clerk) ships first and runs automatically for signed-in users; the iCloud folder (D-016 phase A, #248) is deferred. Preservation gaps accepted for v1: runs, evals and Scratch are not synced; version history is whatever each entry carries.

## Tests

| Suite | Where | Covers |
| --- | --- | --- |
| RLS and protocol | `supabase/tests/account-sync.test.mjs` (PGlite) | isolation, anon denied, no-sub token, private conflict copies, LWW, unchanged, tombstones, limits, erase, pull |
| Security and review findings | `supabase/tests/security.test.mjs` (PGlite) | open-policy, table-grant and function-grant guards, definer ownership, direct-write and direct-select denial, issuer and claim rules, item, row, byte, request, conflict and project caps, the 364-copy / 86.8 MiB conflict case, conflict bytes in the quota, size guard on conflict-only writes, read kill switch, list-conflicts RPC, per-user and project download budgets, response byte cap, rate limits, PT codes, manifest and fetch, admin delete |
| Real Postgres 17 | `supabase/tests/concurrency.pg.test.mjs` (embedded-postgres) | 3 writers × 100 items with slow commits, no cursor skip; admin delete waits for an in-flight push; `pg_dump` / `psql` restore rehearsal per the runbook (skipped if `pg_dump` is not installed) |
| Engine end to end | `supabase/tests/sync-engine.e2e.test.mjs` | two devices, first-run merge, dedupe, snapshot and restore, edits, conflicts, delete, offline, fresh device, second user, owner mismatch, manifest repair, paused, quota, oversize, paging through byte-capped reads, export via RPC |
| Client units | `prompt-lab-extension/src/tests/accountSync.test.js` (vitest) | flag off by default, hash, backoff, queue, model, transport headers and list-conflicts RPC, desktop commands never handle secrets, page continuation, extension token cache in session storage, restore merge, status map, bridge |
| API and build | `tests/clerk-sync-webhook.test.mjs`, `tests/desktop-token-bridge.test.mjs`, `tests/account-sync-build.test.mjs` | signature verification, raw-body Node path, bridge client_id/scope/revocation checks and rate limits, CSP and manifest changes only with the flag |
| Desktop Rust | `src-tauri/src/account_auth.rs` `#[cfg(test)]` (run standalone) | callback classification, listener ignores bad path/state and keeps waiting, timeout, PKCE vector (RFC 7636), code exchange keeps the refresh token in the store, refresh rotation and forget-on-refusal |

Run: `npm run test:sync` from `prompt-lab-source` (Node 22).

## 15. Review status

Fire Watch's first review (F-01 to F-17) covered the work before commit `e850e79`; its re-review (R-01 to R-07) covered `e850e79`. The re-review text was relayed by the parent agent; the appended section was not present in the restored `/workspace/promptlab-review/REVIEW.md` when this was written, so R-titles below are from that relay.

| Finding | Status | Shown by |
| --- | --- | --- |
| F-01 per-user storage cap | Fixed | security: item, row, byte, request, conflict and project caps |
| F-02 any `authenticated` JWT becomes a user | Fixed in SQL; Supabase Auth sign-ups off is R3 (Dave) | security: F-02 claims test |
| F-03 extension and desktop sign-in undesigned | Built behind the flag; desktop session step open (R-03) | sections 7, 12 |
| F-04 direct table writes | Fixed | security: F-04 direct-write denial, grants guard |
| F-05 cursor skip under concurrent pushes | Fixed | concurrency.pg: F-05 |
| F-06 daily full re-pull egress | Fixed (manifest check) | e2e: daily manifest check |
| F-07 no backups on Free | Mitigated: device snapshots, weekly export runbook (rehearsed locally, R-06); export not set up (R11, Dave) | e2e snapshot tests; concurrency.pg: R-06 |
| F-08 no CI guard on RLS | Guard tests exist; wiring `test:sync` into CI not done (no CI runs allowed) | security: F-08, grants guard |
| F-09 no deletion on Clerk account delete | Fixed; webhook endpoint setup is R7 (Dave) | clerk-sync-webhook tests |
| F-10 rate limiting | Fixed (tighter after R-01b) | security: F-10, default pull limit |
| F-11 stale GitHub Pages claim | Not in this branch's scope | - |
| F-12 www does not redirect | Not in scope (Vercel setting, Dave) | - |
| F-13 mobile subdomain NXDOMAIN | Not in scope (DNS, Dave) | - |
| F-14 HSTS, CAA, DMARC | Not in scope (DNS / Vercel, Dave) | - |
| F-15 Vercel secrets not Sensitive | Not in scope (Vercel env, Dave); new sync secrets listed as Sensitive in R6 | - |
| F-16 extension id for `/api` | Documented; needs the published id (Dave) | section 7 |
| F-17 server-side kill switch | Fixed; now covers every read RPC | security: F-17, R-01b kill switch |
| R-01 conflict copies outside the quota | Fixed: 2 MiB per-user conflict cap with eviction, 5 per item, conflict bytes in the 10 MiB quota, size guard on every conflict write | security: R-01 (364 copies, 86.8 MiB attempted, at most 2 MiB kept), R-01 quota, R-01 size guard |
| R-01b direct SELECT, read limits, egress | Fixed: no SELECT grants, `sync_list_conflicts` RPC, read kill switch, 2 MiB response cap, per-user and project daily download budgets, reads 12 a minute | security: R-01b tests; e2e: paging; vitest: list-conflicts RPC |
| R-02 desktop-token accepts any OAuth token | Fixed: client_id and scope checks via Clerk's verify endpoint, revoked/expired refused, per-IP and per-user rate limit, 503 without `PL_DESKTOP_OAUTH_CLIENT_ID`; still off by default | desktop-token-bridge: R-02 tests |
| R-03 desktop session step, loopback redirect exact-match, real Chrome | Open (needs Dave's Clerk OAuth app and real devices) | - |
| R-04 keychain commands reachable from the webview | Fixed: refresh token held in Rust only, no keychain read command, webview gets short-lived access tokens; per-window capability gating not added (single `main` window) | Rust: r04 tests; vitest: desktop commands never handle secrets |
| R-05 loopback takes the first callback | Fixed: wrong path or state ignored, keeps listening until timeout | Rust: r05 tests |
| R-06 pg_dump rehearsal | Rehearsed locally: box `pg_dump` 17.11 against the embedded Postgres 17.10 server, restored into a fresh database; found and documented two restore steps (truncate `sync.settings`, set the sequence first). Not rehearsed against a real Supabase project. | concurrency.pg: R-06 |
| R-07 webhook raw body on Vercel | Fixed in code (raw stream read, parsed bodies refused); not run on Vercel itself | clerk-sync-webhook: R-07 tests |
| Low: account deletion without the per-user lock | Fixed | concurrency.pg: LOW admin delete waits |
| Low: extension Clerk token in `chrome.storage.local` | Fixed: `chrome.storage.session` with trusted-contexts access, memory fallback | vitest: extension token cache |
