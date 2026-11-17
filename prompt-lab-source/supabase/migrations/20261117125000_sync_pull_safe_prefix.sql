-- A pull cursor must not move past a change that is still unsafe to read.
--
-- write_xid is assigned when a push starts, and change_seq is assigned when
-- the row is written. Those orders can disagree: a transaction that started
-- earlier can commit a higher change_seq while a later transaction's lower
-- change_seq is still hidden, because an even newer transaction is holding
-- the snapshot horizon between their xids. Filtering with
-- `write_xid < pg_snapshot_xmin(...)` then returns the higher sequence and
-- drops the lower one, so the client cursor skips it.
--
-- Return only the contiguous safe prefix. The first visible row that is not
-- yet below the horizon, and every row after it, waits for the next pull.
create or replace function sync.pull_impl(uid text, p_cursor bigint, p_limit integer)
returns table (kind text, item_id text, payload jsonb, deleted boolean, version bigint, lamport bigint, device_id text, change_seq bigint, page_truncated boolean)
language plpgsql
set search_path = ''
as $$
declare r record; total bigint := 0; cap bigint := sync.setting('max_response_bytes')::bigint; have boolean := false;
begin
  for r in
    with horizon as (
      select pg_snapshot_xmin(pg_current_snapshot()) as xmin
    ),
    ordered as (
      select i.kind, i.item_id, i.payload, i.deleted, i.version, i.lamport, i.device_id, i.change_seq,
             sync.row_bytes(i.payload) as sz,
             (i.write_xid < h.xmin) as safe
      from public.sync_items i
      cross join horizon h
      where i.user_id = uid
        and i.change_seq > coalesce(p_cursor, 0)
      order by i.change_seq
      limit least(greatest(coalesce(p_limit, 500), 1), 1000)
    )
    select o.kind, o.item_id, o.payload, o.deleted, o.version, o.lamport, o.device_id, o.change_seq, o.sz
    from ordered o
    where o.safe
      and not exists (
        select 1 from ordered earlier
        where earlier.change_seq <= o.change_seq
          and earlier.safe is not true
      )
    order by o.change_seq
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
