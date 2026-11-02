-- Fire Watch re-review 3 (2026-11-01): R-10 and R-13.
--
-- R-10: "Delete my synced data" erased the caller's rate-limit counters, daily
-- download counters and first-seen record, so push/pull, delete, repeat
-- bypassed every per-minute limit and the daily budgets (R-08, R-09).
-- Erasure now removes content only (items and conflict copies) and is itself
-- rate limited: a small per-minute limit through require_caller (it still
-- works while sync is paused) plus a per-UTC-day limit. Counters hold no
-- content and expire with their window or day. Only account deletion
-- (sync_admin_delete_user, Clerk user.deleted) clears them.
insert into sync.settings (key, value) values
  ('delete_per_minute', '2'),
  ('delete_per_day', '10')
on conflict (key) do nothing;

create or replace function public.sync_delete_my_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.require_caller('delete', false); n_items bigint; n_conflicts bigint; n_today integer;
  day_start timestamptz := (date_trunc('day', now() at time zone 'utc')) at time zone 'utc';
begin
  insert into sync.rate as r (user_id, action, window_start, calls) values (uid, 'delete_day', day_start, 1)
    on conflict (user_id, action) do update
      set calls = case when r.window_start = excluded.window_start then r.calls + 1 else 1 end,
          window_start = excluded.window_start
    returning calls into n_today;
  begin
    if n_today > coalesce(sync.setting('delete_per_day')::integer, 10) then
      raise exception 'too many delete requests today' using errcode = 'PT429';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('prompt-lab-sync:' || uid, 0));
    delete from public.sync_items where user_id = uid; get diagnostics n_items = row_count;
    delete from public.sync_conflicts where user_id = uid; get diagnostics n_conflicts = row_count;
    -- sync.rate, sync.egress and sync.accounts are kept on purpose (R-10).
    return jsonb_build_object('items', n_items, 'conflicts', n_conflicts);
  exception when others then
    -- As in sync_push (R-08): a refusal is data, so the day counter commits.
    return sync.refusal(sqlstate, sqlerrm);
  end;
end $$;
revoke all on function public.sync_delete_my_data() from public, anon, authenticated;
grant execute on function public.sync_delete_my_data() to authenticated;

-- R-13: Supabase's default privileges grant anon and authenticated USAGE,
-- SELECT and UPDATE on every new sequence in public, including the identity
-- sequence behind sync_conflicts.id. Clients need none of them.
do $$ declare s record; begin
  for s in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S' and c.relname like 'sync\_%' loop
    execute format('revoke all on sequence public.%I from public, anon, authenticated', s.relname);
  end loop;
end $$;
