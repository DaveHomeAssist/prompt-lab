# Account sync: backup and restore runbook

Supabase Free has no automatic backups and no point-in-time recovery. Each device keeps a full local copy and a pre-merge snapshot. Even so, a bad client release could push bad data everywhere, so the operator keeps a weekly export as well. Every step here needs Dave (rollout R11). Nothing has been set up.

## Weekly export (operator)

Where: a **private** location only, such as a private repo with encrypted artifacts or Dave's own storage. Never the public `prompt-lab` repo.

Credential: the project database connection string, stored as a secret in the runner. Never commit it or print it.

```sh
# Supabase CLI against the linked project (needs the database password)
supabase db dump --data-only --schema public,sync \
  -f "sync-$(date +%Y-%m-%d).sql"
# or plain pg_dump with the session-pooler connection string
pg_dump "$SUPABASE_DB_URL" --data-only --no-owner \
  -t public.sync_items -t public.sync_conflicts -t sync.settings \
  -f "sync-$(date +%Y-%m-%d).sql"
```

Keep 4 weekly copies, then delete older ones, which matches the privacy note's "[N] weeks". Encrypt at rest, for example `age -r <recipient>`.

Check after each run: the file is non-empty, and `select count(*) from public.sync_items` matches the dump's row count. Also record `select max(change_seq) from public.sync_items` next to the file; a restore into a new database needs it.

Do not add `-t public.sync_change_seq` to the dump. Restoring an old sequence value into a live database would move the sequence backwards, and new changes would then sort before cursors devices already hold.

## Restore

1. Turn sync off for everyone: `update sync.settings set value = 'off' where key = 'enabled';`. Clients back off and keep local data.
2. Restore into a **new** local or scratch database first and check row counts and a few known items. Into a new database:

   ```sh
   # schema first: the migration (and, locally, the Supabase role shim)
   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -c "truncate sync.settings" \
     -c "select setval('public.sync_change_seq', <max change_seq recorded with the dump>)"
   psql "$SCRATCH_DB_URL" -v ON_ERROR_STOP=1 -q -f sync-YYYY-MM-DD.sql
   ```

   - `truncate sync.settings` first: the migration inserts default settings and the dump's rows would collide on the primary key.
   - Set the sequence first: the insert trigger gives every restored row a new `change_seq`. Starting above the old maximum puts every restored row after every device's cursor, so devices pull them on their next sync. Versions, clocks and payloads are restored unchanged.
3. In production, restore the affected users only, or the whole table:

   ```sql
   begin;
   delete from public.sync_items where user_id = any($1);   -- affected users, or skip for full restore
   -- \i sync-YYYY-MM-DD.sql  (data for those users only, or all rows)
   commit;
   ```

4. Turn sync back on.
5. Devices then repair themselves within a day through the manifest check:
   - an item the server no longer has, or has at an older version than the device saw, is uploaded again from the device;
   - the restored copy goes to `sync_conflicts` if the device copy wins.

   This path is tested in `sync-engine.e2e.test.mjs` ("daily manifest check").

## Device-side recovery (per user)

- Before the first sync merge on a device, and before any pull that applies 50 or more items, the app saves a snapshot (`pl2-sync-snapshot:<user>`).
- Restoring it merges: missing prompts come back, and nothing current is removed.
- Conflict copies (`sync_conflicts`) hold the losing side of the newest 5 conflicts per prompt, up to 200 copies and 2 MiB per account.

## Tested locally

- Restoring rows into the schema and the device re-upload path: engine e2e test, PGlite.
- `pg_dump` dump and `psql` restore, rehearsed locally (`supabase/tests/concurrency.pg.test.mjs`, "R-06"): the build box's `pg_dump` 17.11 against the embedded Postgres 17.10 server, the exact `pg_dump` command above, restored into a fresh database with the steps above. Every row, version, clock, payload and conflict copy came back; restored rows sorted after the old cursor; a device pulled them and a push worked afterwards. The rehearsal found both pre-load steps (settings collision; sequence position).
- Not rehearsed: against a real Supabase project (session pooler, `supabase db dump`, role differences). Do that once in a scratch project before relying on it.
