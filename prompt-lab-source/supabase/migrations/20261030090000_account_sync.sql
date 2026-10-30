-- Prompt Lab account sync, schema v1. See docs/ACCOUNT_SYNC_DESIGN.md.
--
-- Identity: Clerk session tokens through Supabase's native Clerk third-party
-- auth integration (not the deprecated JWT template). The Clerk user id is
-- the JWT `sub` (text, "user_..."), never a uuid.
--
-- Access path: clients hold no table privileges at all, neither read nor
-- write. Every read and write goes through the SECURITY DEFINER functions
-- below, which run as the non-superuser role sync_owner, take the caller id
-- from the verified JWT, enforce quotas, rate limits, a daily download budget
-- and a kill switch, and are themselves still subject to owner-only row-level
-- security. Nothing in this file has been applied to a remote project.

create schema if not exists sync;
revoke all on schema sync from public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'sync_owner') then
    create role sync_owner nologin noinherit;
  end if;
end $$;
-- The migration role must be able to hand objects to sync_owner (PG16+ rules).
grant sync_owner to current_user;
grant usage on schema sync, public to sync_owner;

-- Operator settings: kill switch, accepted issuer, quotas and rate limits.
-- Not reachable from the Data API. Change with SQL, for example:
--   update sync.settings set value = 'off' where key = 'enabled';
create table if not exists sync.settings (key text primary key, value text not null);
insert into sync.settings (key, value) values
  ('enabled', 'on'),
  ('issuer', 'https://clerk.promptlab.tools'),
  ('max_rows_per_user', '10000'),           -- live items plus tombstones
  ('max_live_items_per_user', '5000'),
  ('max_bytes_per_user', '10485760'),       -- 10 MiB of payload JSON
  ('max_database_bytes', '419430400'),      -- 400 MiB: stop growth well before Free's 500 MB read-only line
  ('max_request_bytes', '2097152'),         -- 2 MiB per push
  ('max_conflicts_per_item', '5'),
  ('max_conflicts_per_user', '200'),
  ('max_conflict_bytes_per_user', '2097152'), -- 2 MiB of kept conflict copies; oldest evicted first
  ('max_response_bytes', '2097152'),        -- 2 MiB of payload per read call; clients page
  ('max_egress_bytes_per_user_day', '33554432'), -- 32 MiB of payload reads per user per UTC day
  ('max_egress_bytes_per_day', '157286400'),     -- 150 MiB per UTC day for the whole project (~4.4 GiB / 30 days, under Free's 5 GB)
  ('push_per_minute', '30'),
  ('pull_per_minute', '12'),                -- reads: a 5-minute poll needs 1-3 per cycle
  ('status_per_minute', '12')
on conflict (key) do nothing;
revoke all on sync.settings from public;
grant select on sync.settings to sync_owner;

create or replace function sync.setting(p_key text) returns text
language sql stable set search_path = ''
as $$ select value from sync.settings where key = p_key $$;
alter function sync.setting(text) owner to sync_owner;
revoke all on function sync.setting(text) from public;

-- Caller id from the verified JWT, or null. Accepts only active Clerk session
-- tokens from the configured issuer: role authenticated, a "user_" subject,
-- not anonymous, and not a pending session (sts = "pending").
create or replace function sync.current_user_id() returns text
language plpgsql stable security definer set search_path = ''
as $$
declare claims jsonb;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if claims is null or jsonb_typeof(claims) <> 'object' then return null; end if;
  if claims ->> 'role' is distinct from 'authenticated' then return null; end if;
  if claims ->> 'iss' is distinct from sync.setting('issuer') then return null; end if;
  if coalesce(claims ->> 'sts', 'active') <> 'active' then return null; end if;
  if coalesce(claims ->> 'is_anonymous', 'false') <> 'false' then return null; end if;
  if coalesce(claims ->> 'sub', '') !~ '^user_[A-Za-z0-9]{1,64}$' then return null; end if;
  return claims ->> 'sub';
end $$;
alter function sync.current_user_id() owner to sync_owner;
revoke all on function sync.current_user_id() from public;

-- One global, monotonic change sequence. Pull cursors are positions in it.
create sequence if not exists public.sync_change_seq as bigint;
revoke all on sequence public.sync_change_seq from public, anon, authenticated;
grant usage on sequence public.sync_change_seq to sync_owner;

create table if not exists public.sync_items (
  user_id      text        not null,
  kind         text        not null check (kind in ('prompt', 'structure')),
  item_id      text        not null check (char_length(item_id) between 1 and 200),
  payload      jsonb,
  deleted      boolean     not null default false,
  version      bigint      not null default 1 check (version > 0),
  lamport      bigint      not null default 0 check (lamport between 0 and 9007199254740991),
  device_id    text        not null check (char_length(device_id) between 1 and 100),
  client_updated_at timestamptz,
  change_seq   bigint      not null default nextval('public.sync_change_seq'),
  write_xid    xid8        not null default pg_current_xact_id(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, kind, item_id),
  -- 256 KiB per item: long prompts plus version history. Images stay local.
  constraint sync_items_payload_size check (payload is null or octet_length(payload::text) <= 262144),
  constraint sync_items_tombstone check (deleted or payload is not null)
);
create index if not exists sync_items_user_change_idx on public.sync_items (user_id, change_seq);

-- The losing side of every conflict is kept here so it can be restored.
create table if not exists public.sync_conflicts (
  id            bigint generated always as identity primary key,
  user_id       text        not null,
  kind          text        not null,
  item_id       text        not null,
  losing_payload jsonb,
  losing_deleted boolean    not null default false,
  losing_device_id text     not null,
  losing_lamport bigint     not null,
  winning_version bigint    not null,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  constraint sync_conflicts_payload_size check (losing_payload is null or octet_length(losing_payload::text) <= 262144)
);
create index if not exists sync_conflicts_user_idx on public.sync_conflicts (user_id, kind, item_id, id desc);

-- Fixed-window call counters for per-user rate limits.
create table if not exists sync.rate (
  user_id text not null,
  action text not null,
  window_start timestamptz not null,
  calls integer not null,
  primary key (user_id, action)
);
revoke all on sync.rate from public;
grant select, insert, update, delete on sync.rate to sync_owner;

-- Daily download (egress) counters, per user and for the whole project
-- (user_id '*'). Reset when the UTC day changes.
create table if not exists sync.egress (
  user_id text primary key,
  day date not null,
  bytes bigint not null
);
revoke all on sync.egress from public;
grant select, insert, update, delete on sync.egress to sync_owner;

-- The server, never the client, assigns sequence, xid and timestamps.
create or replace function sync.stamp_item() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.change_seq := nextval('public.sync_change_seq');
  new.write_xid := pg_current_xact_id();
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.user_id := old.user_id; -- ownership never changes
    new.created_at := old.created_at;
  end if;
  return new;
end $$;
alter function sync.stamp_item() owner to sync_owner;
revoke all on function sync.stamp_item() from public;
drop trigger if exists sync_items_touch on public.sync_items;
drop trigger if exists sync_items_stamp on public.sync_items;
create trigger sync_items_stamp before insert or update on public.sync_items
  for each row execute function sync.stamp_item();

-- Row-level security on both tables, forced even for the table owner.
alter table public.sync_items enable row level security;
alter table public.sync_items force row level security;
alter table public.sync_conflicts enable row level security;
alter table public.sync_conflicts force row level security;

-- No direct table access for clients (no PostgREST select either): reads and
-- writes go through the rate-limited, budgeted functions below.
revoke all on public.sync_items, public.sync_conflicts from public, anon, authenticated;
grant select, insert, update, delete on public.sync_items, public.sync_conflicts to sync_owner;
revoke all on schema sync from anon, authenticated;

do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('sync_items', 'sync_conflicts') loop
    execute format('drop policy %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;
create policy sync_items_owner_write on public.sync_items for all to sync_owner
  using (user_id = (select sync.current_user_id())) with check (user_id = (select sync.current_user_id()));
create policy sync_conflicts_owner_write on public.sync_conflicts for all to sync_owner
  using (user_id = (select sync.current_user_id())) with check (user_id = (select sync.current_user_id()));

-- Shared guards: signed in, sync switched on, under the per-minute limit.
create or replace function sync.require_caller(p_action text, p_check_enabled boolean default true) returns text
language plpgsql volatile set search_path = ''
as $$
declare uid text := sync.current_user_id(); n integer; lim integer; win timestamptz := date_trunc('minute', now());
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_check_enabled and sync.setting('enabled') is distinct from 'on' then
    raise exception 'account sync is paused' using errcode = 'PT503';
  end if;
  lim := coalesce(sync.setting(p_action || '_per_minute')::integer, 60);
  insert into sync.rate as r (user_id, action, window_start, calls) values (uid, p_action, win, 1)
    on conflict (user_id, action) do update
      set calls = case when r.window_start = excluded.window_start then r.calls + 1 else 1 end,
          window_start = excluded.window_start
    returning calls into n;
  if n > lim then raise exception 'too many sync requests' using errcode = 'PT429'; end if;
  return uid;
end $$;
alter function sync.require_caller(text, boolean) owner to sync_owner;
revoke all on function sync.require_caller(text, boolean) from public;

-- Charge payload bytes about to be returned against the caller's and the
-- project's daily download budget. A response that would cross either budget
-- is refused whole (the charge rolls back with it).
create or replace function sync.charge_egress(p_uid text, p_bytes bigint) returns void
language plpgsql volatile set search_path = ''
as $$
declare d date := (now() at time zone 'utc')::date; u bigint; t bigint;
begin
  if coalesce(p_bytes, 0) <= 0 then return; end if;
  insert into sync.egress as e (user_id, day, bytes) values (p_uid, d, p_bytes)
    on conflict (user_id) do update set bytes = case when e.day = excluded.day then e.bytes + excluded.bytes else excluded.bytes end, day = excluded.day
    returning bytes into u;
  if u > sync.setting('max_egress_bytes_per_user_day')::bigint then
    raise exception 'daily sync download budget used' using errcode = 'PT429';
  end if;
  insert into sync.egress as e (user_id, day, bytes) values ('*', d, p_bytes)
    on conflict (user_id) do update set bytes = case when e.day = excluded.day then e.bytes + excluded.bytes else excluded.bytes end, day = excluded.day
    returning bytes into t;
  if t > sync.setting('max_egress_bytes_per_day')::bigint then
    raise exception 'account sync download budget for today is used up' using errcode = 'PT429';
  end if;
end $$;
alter function sync.charge_egress(text, bigint) owner to sync_owner;
revoke all on function sync.charge_egress(text, bigint) from public;

-- Approximate wire size of one returned row: payload text plus fixed overhead.
create or replace function sync.row_bytes(p jsonb) returns bigint
language sql immutable set search_path = ''
as $$ select coalesce(octet_length(p::text), 0)::bigint + 128 $$;
alter function sync.row_bytes(jsonb) owner to sync_owner;
revoke all on function sync.row_bytes(jsonb) from public;

-- Push a batch of changes from one device.
-- Change: {kind, item_id, base_version, lamport, payload, deleted, client_updated_at}
-- base_version 0 means "the device has never seen this item".
-- Rule: if base_version equals the stored version the change applies.
-- Otherwise it is a conflict decided by (lamport, device_id), higher wins
-- (per-item last writer wins); the loser is written to sync_conflicts.
-- A per-user advisory lock serializes a user's pushes, so their change_seq
-- order equals commit order and pull cursors cannot skip a late commit.
create or replace function public.sync_push(p_device_id text, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text;
  change jsonb;
  cur public.sync_items%rowtype;
  results jsonb := '[]'::jsonb;
  c_kind text; c_id text; c_base bigint; c_lamport bigint; c_payload jsonb; c_deleted boolean; c_at timestamptz;
  incoming_wins boolean;
  before_rows bigint; before_live bigint; before_bytes bigint; before_conflict_bytes bigint;
  after_rows bigint; after_live bigint; after_bytes bigint; after_conflict_bytes bigint;
  touched_conflicts boolean := false;
begin
  uid := sync.require_caller('push');
  if p_device_id is null or char_length(p_device_id) not between 1 and 100 then raise exception 'invalid device id' using errcode = '22023'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 200 then raise exception 'changes must be an array of at most 200' using errcode = '22023'; end if;
  if octet_length(p_changes::text) > sync.setting('max_request_bytes')::bigint then raise exception 'sync request too large' using errcode = 'PT413'; end if;

  perform pg_advisory_xact_lock(hashtextextended('prompt-lab-sync:' || uid, 0));

  select count(*), count(*) filter (where not deleted), coalesce(sum(octet_length(payload::text)), 0)
    into before_rows, before_live, before_bytes from public.sync_items where user_id = uid;
  select coalesce(sum(octet_length(losing_payload::text)), 0) into before_conflict_bytes
    from public.sync_conflicts where user_id = uid;

  for change in select * from jsonb_array_elements(p_changes) loop
    c_kind := change ->> 'kind';
    c_id := change ->> 'item_id';
    c_base := coalesce((change ->> 'base_version')::bigint, 0);
    c_lamport := coalesce((change ->> 'lamport')::bigint, 0);
    if c_lamport < 0 or c_lamport > 9007199254740990 then raise exception 'invalid lamport clock' using errcode = '22023'; end if;
    c_deleted := coalesce((change ->> 'deleted')::boolean, false);
    c_payload := case when c_deleted then null else change -> 'payload' end;
    c_at := nullif(change ->> 'client_updated_at', '')::timestamptz;

    select * into cur from public.sync_items
      where user_id = uid and kind = c_kind and item_id = c_id for update;

    if not found then
      insert into public.sync_items (user_id, kind, item_id, payload, deleted, version, lamport, device_id, client_updated_at)
        values (uid, c_kind, c_id, c_payload, c_deleted, 1, c_lamport, p_device_id, c_at)
        returning * into cur;
      results := results || jsonb_build_object('kind', c_kind, 'item_id', c_id, 'status', 'applied', 'version', cur.version, 'change_seq', cur.change_seq);
    elsif cur.version = c_base then
      update public.sync_items set payload = c_payload, deleted = c_deleted, version = cur.version + 1,
        lamport = greatest(cur.lamport + 1, c_lamport), device_id = p_device_id, client_updated_at = c_at
        where user_id = uid and kind = c_kind and item_id = c_id returning * into cur;
      results := results || jsonb_build_object('kind', c_kind, 'item_id', c_id, 'status', 'applied', 'version', cur.version, 'change_seq', cur.change_seq);
    elsif cur.payload is not distinct from c_payload and cur.deleted = c_deleted then
      results := results || jsonb_build_object('kind', c_kind, 'item_id', c_id, 'status', 'unchanged', 'version', cur.version, 'change_seq', cur.change_seq);
    else
      touched_conflicts := true;
      incoming_wins := (c_lamport, p_device_id) > (cur.lamport, cur.device_id);
      if incoming_wins then
        insert into public.sync_conflicts (user_id, kind, item_id, losing_payload, losing_deleted, losing_device_id, losing_lamport, winning_version)
          values (uid, c_kind, c_id, cur.payload, cur.deleted, cur.device_id, cur.lamport, cur.version + 1);
        update public.sync_items set payload = c_payload, deleted = c_deleted, version = cur.version + 1,
          lamport = greatest(cur.lamport + 1, c_lamport), device_id = p_device_id, client_updated_at = c_at
          where user_id = uid and kind = c_kind and item_id = c_id returning * into cur;
        results := results || jsonb_build_object('kind', c_kind, 'item_id', c_id, 'status', 'conflict_won', 'version', cur.version, 'change_seq', cur.change_seq);
      else
        insert into public.sync_conflicts (user_id, kind, item_id, losing_payload, losing_deleted, losing_device_id, losing_lamport, winning_version)
          values (uid, c_kind, c_id, c_payload, c_deleted, p_device_id, c_lamport, cur.version);
        results := results || jsonb_build_object('kind', c_kind, 'item_id', c_id, 'status', 'conflict_lost', 'version', cur.version, 'change_seq', cur.change_seq);
      end if;
      -- Keep only the newest conflict copies per item and per user.
      delete from public.sync_conflicts c where c.user_id = uid and c.kind = c_kind and c.item_id = c_id
        and c.id not in (select k.id from public.sync_conflicts k where k.user_id = uid and k.kind = c_kind and k.item_id = c_id
                         order by k.id desc limit sync.setting('max_conflicts_per_item')::integer);
    end if;
  end loop;

  -- Conflict copies are capped hard per user, by count and by bytes: the
  -- newest are kept, the oldest evicted. Losing copies are attacker-supplied
  -- bytes that never touch the live library, so they get their own small cap.
  if touched_conflicts then
    delete from public.sync_conflicts c where c.user_id = uid and c.id in (
      select s.id from (
        select k.id,
               row_number() over (order by k.id desc) as rn,
               sum(octet_length(coalesce(k.losing_payload::text, ''))) over (order by k.id desc) as running
        from public.sync_conflicts k where k.user_id = uid) s
      where s.rn > sync.setting('max_conflicts_per_user')::integer
         or s.running > sync.setting('max_conflict_bytes_per_user')::bigint);
  end if;

  -- Quotas. A batch that grows a total past its cap is rolled back whole;
  -- a batch that shrinks usage (deletes) is always allowed. Conflict copies
  -- count against the per-user byte quota as well as their own cap.
  select count(*), count(*) filter (where not deleted), coalesce(sum(octet_length(payload::text)), 0)
    into after_rows, after_live, after_bytes from public.sync_items where user_id = uid;
  select coalesce(sum(octet_length(losing_payload::text)), 0) into after_conflict_bytes
    from public.sync_conflicts where user_id = uid;
  if (after_rows > sync.setting('max_rows_per_user')::bigint and after_rows > before_rows)
     or (after_live > sync.setting('max_live_items_per_user')::bigint and after_live > before_live)
     or (after_bytes + after_conflict_bytes > sync.setting('max_bytes_per_user')::bigint
         and after_bytes + after_conflict_bytes > before_bytes + before_conflict_bytes) then
    raise exception 'account sync storage quota exceeded' using errcode = 'PT413';
  end if;
  -- Whole-project guard against many accounts each filling their quota. Runs
  -- on every write that adds item or conflict bytes.
  if (after_bytes > before_bytes or after_conflict_bytes > before_conflict_bytes or touched_conflicts)
     and pg_database_size(current_database()) > sync.setting('max_database_bytes')::bigint then
    raise exception 'account sync storage is full' using errcode = 'PT507';
  end if;
  return results;
end $$;
alter function public.sync_push(text, jsonb) owner to sync_owner;

-- Pull changes after a cursor. Rows from transactions that may still overlap
-- an in-flight writer (xid at or above the snapshot xmin) wait for the next pull.
-- A page stops at max_response_bytes (always at least one row) and then marks
-- its last row page_truncated; the client keeps paging from the last
-- change_seq. Returned bytes count against the daily download budget.
create or replace function public.sync_pull(p_cursor bigint, p_limit integer default 500)
returns table (kind text, item_id text, payload jsonb, deleted boolean, version bigint, lamport bigint, device_id text, change_seq bigint, page_truncated boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare uid text := sync.require_caller('pull'); r record; total bigint := 0; cap bigint := sync.setting('max_response_bytes')::bigint; have boolean := false;
begin
  for r in
    select i.kind, i.item_id, i.payload, i.deleted, i.version, i.lamport, i.device_id, i.change_seq, sync.row_bytes(i.payload) as sz
    from public.sync_items i
    where i.user_id = uid
      and i.change_seq > coalesce(p_cursor, 0)
      and i.write_xid < pg_snapshot_xmin(pg_current_snapshot())
    order by i.change_seq
    limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  loop
    if have and total + r.sz > cap then
      page_truncated := true; -- the last row returned says "ask again"
      return next;
      have := false;
      exit;
    end if;
    if have then return next; end if;
    total := total + r.sz;
    kind := r.kind; item_id := r.item_id; payload := r.payload; deleted := r.deleted;
    version := r.version; lamport := r.lamport; device_id := r.device_id; change_seq := r.change_seq;
    page_truncated := false; have := true;
  end loop;
  if have then return next; end if;
  perform sync.charge_egress(uid, total);
end $$;
alter function public.sync_pull(bigint, integer) owner to sync_owner;

-- Versions only (no payloads): the cheap daily consistency check.
create or replace function public.sync_manifest()
returns table (kind text, item_id text, version bigint, deleted boolean)
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.require_caller('pull'); n bigint;
begin
  select coalesce(sum(char_length(i.item_id) + 64), 0) into n from public.sync_items i where i.user_id = uid;
  perform sync.charge_egress(uid, n);
  return query select i.kind, i.item_id, i.version, i.deleted from public.sync_items i where i.user_id = uid;
end $$;
alter function public.sync_manifest() owner to sync_owner;

-- Full rows for up to 500 named items: [{kind, item_id}, ...]. Stops at
-- max_response_bytes (at least one row); the client asks again for the rest.
create or replace function public.sync_fetch(p_keys jsonb)
returns table (kind text, item_id text, payload jsonb, deleted boolean, version bigint, lamport bigint, device_id text, change_seq bigint)
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.require_caller('pull'); r record; total bigint := 0; cap bigint := sync.setting('max_response_bytes')::bigint;
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' or jsonb_array_length(p_keys) > 500 then raise exception 'keys must be an array of at most 500' using errcode = '22023'; end if;
  for r in
    select distinct on (i.change_seq) i.kind, i.item_id, i.payload, i.deleted, i.version, i.lamport, i.device_id, i.change_seq, sync.row_bytes(i.payload) as sz
    from public.sync_items i
    join jsonb_to_recordset(p_keys) as k(kind text, item_id text) on k.kind = i.kind and k.item_id = i.item_id
    where i.user_id = uid
    order by i.change_seq
  loop
    exit when total > 0 and total + r.sz > cap;
    total := total + r.sz;
    kind := r.kind; item_id := r.item_id; payload := r.payload; deleted := r.deleted;
    version := r.version; lamport := r.lamport; device_id := r.device_id; change_seq := r.change_seq;
    return next;
  end loop;
  perform sync.charge_egress(uid, total);
end $$;

-- Unresolved conflict copies, newest first, through the same guards as every
-- other read (rate limit, kill switch, response cap, daily budget).
create or replace function public.sync_list_conflicts(p_limit integer default 100)
returns table (id bigint, kind text, item_id text, losing_payload jsonb, losing_deleted boolean, created_at timestamptz)
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.require_caller('pull'); r record; total bigint := 0; cap bigint := sync.setting('max_response_bytes')::bigint;
begin
  for r in
    select c.id, c.kind, c.item_id, c.losing_payload, c.losing_deleted, c.created_at, sync.row_bytes(c.losing_payload) as sz
    from public.sync_conflicts c
    where c.user_id = uid and c.resolved_at is null
    order by c.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  loop
    exit when total > 0 and total + r.sz > cap;
    total := total + r.sz;
    id := r.id; kind := r.kind; item_id := r.item_id; losing_payload := r.losing_payload;
    losing_deleted := r.losing_deleted; created_at := r.created_at;
    return next;
  end loop;
  perform sync.charge_egress(uid, total);
end $$;
alter function public.sync_list_conflicts(integer) owner to sync_owner;
alter function public.sync_fetch(jsonb) owner to sync_owner;

-- Usage, limits and the kill switch, for the client's status line.
create or replace function public.sync_status()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.require_caller('status', false); r bigint; l bigint; b bigint; cb bigint; eg bigint;
begin
  select count(*), count(*) filter (where not deleted), coalesce(sum(octet_length(payload::text)), 0)
    into r, l, b from public.sync_items where user_id = uid;
  select coalesce(sum(octet_length(losing_payload::text)), 0) into cb from public.sync_conflicts where user_id = uid;
  select case when e.day = (now() at time zone 'utc')::date then e.bytes else 0 end into eg from sync.egress e where e.user_id = uid;
  return jsonb_build_object('enabled', sync.setting('enabled') = 'on', 'rows', r, 'live_items', l, 'bytes', b,
    'conflict_bytes', cb, 'egress_bytes_today', coalesce(eg, 0),
    'max_rows', sync.setting('max_rows_per_user')::bigint, 'max_live_items', sync.setting('max_live_items_per_user')::bigint,
    'max_bytes', sync.setting('max_bytes_per_user')::bigint,
    'max_conflict_bytes', sync.setting('max_conflict_bytes_per_user')::bigint,
    'max_egress_bytes_per_day', sync.setting('max_egress_bytes_per_user_day')::bigint);
end $$;
alter function public.sync_status() owner to sync_owner;

-- Erase every synced row for the caller ("Delete my synced data"). Works even
-- while sync is paused, so erasure is never blocked by the kill switch.
create or replace function public.sync_delete_my_data()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare uid text := sync.current_user_id(); n_items bigint; n_conflicts bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('prompt-lab-sync:' || uid, 0));
  delete from public.sync_items where user_id = uid; get diagnostics n_items = row_count;
  delete from public.sync_conflicts where user_id = uid; get diagnostics n_conflicts = row_count;
  delete from sync.rate where user_id = uid;
  delete from sync.egress where user_id = uid;
  return jsonb_build_object('items', n_items, 'conflicts', n_conflicts);
end $$;
alter function public.sync_delete_my_data() owner to sync_owner;

-- Server-side erasure for the Clerk user.deleted webhook (api/sync/clerk-webhook.js).
-- Callable only with the service role key, which bypasses RLS. Takes the same
-- per-user lock as sync_push, so an in-flight push cannot land after the erase.
create or replace function public.sync_admin_delete_user(p_user_id text)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare n_items bigint; n_conflicts bigint;
begin
  if coalesce(p_user_id, '') !~ '^user_[A-Za-z0-9]{1,64}$' then raise exception 'invalid user id' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('prompt-lab-sync:' || p_user_id, 0));
  delete from public.sync_items where user_id = p_user_id; get diagnostics n_items = row_count;
  delete from public.sync_conflicts where user_id = p_user_id; get diagnostics n_conflicts = row_count;
  delete from sync.rate where user_id = p_user_id;
  delete from sync.egress where user_id = p_user_id;
  return jsonb_build_object('items', n_items, 'conflicts', n_conflicts);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.sync_push(text, jsonb)', 'public.sync_pull(bigint, integer)', 'public.sync_manifest()',
    'public.sync_fetch(jsonb)', 'public.sync_list_conflicts(integer)', 'public.sync_status()', 'public.sync_delete_my_data()', 'public.sync_admin_delete_user(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.sync_push(text, jsonb), public.sync_pull(bigint, integer), public.sync_manifest(),
  public.sync_fetch(jsonb), public.sync_list_conflicts(integer), public.sync_status(), public.sync_delete_my_data() to authenticated;
grant execute on function sync.current_user_id(), sync.setting(text), sync.require_caller(text, boolean),
  sync.charge_egress(text, bigint), sync.row_bytes(jsonb) to sync_owner;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema sync to service_role;
    grant select, delete on public.sync_items, public.sync_conflicts to service_role;
    grant select, delete on sync.rate, sync.egress to service_role;
    grant execute on function public.sync_admin_delete_user(text) to service_role;
  end if;
end $$;
