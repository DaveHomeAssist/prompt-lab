// Review findings F-01, F-02, F-04, F-08, F-09, F-10, F-17 and re-review
// findings R-01, R-01b as executable checks against the real migration in
// local Postgres (PGlite).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, claimsFor, createDb } from './helpers.mjs';

let db; let as;
const U = 'user_Quota1';
const V = 'user_Other2';
const prompt = (id, extra = {}) => ({ kind: 'prompt', item_id: id, base_version: 0, lamport: 1, payload: { state: 'active', entry: { id, title: id, ...extra } } });
const push = (claims, changes, device = 'dev-1') => as(claims, async () => (await db.query('select public.sync_push($1, $2::jsonb) as r', [device, JSON.stringify(changes)])).rows[0].r);
const setting = (key, value) => db.query('update sync.settings set value = $2 where key = $1', [key, String(value)]);
// Inspection as the local superuser, scoped to one user (clients cannot select).
const count = async (sub) => Number((await db.query('select count(*)::int as n from public.sync_items where user_id = $1', [sub])).rows[0].n);
const adminRows = async (sql, params) => (await db.query(sql, params)).rows;
const rpc = (claims, sql, params) => as(claims, async () => (await db.query(sql, params)).rows);
let defaults;

before(async () => {
  db = await createDb(); as = asRole(db);
  defaults = (await db.query('select key, value from sync.settings')).rows;
});
beforeEach(async () => {
  await db.exec('reset role');
  await db.exec('delete from public.sync_items; delete from public.sync_conflicts; delete from sync.rate; delete from sync.egress;');
  for (const { key, value } of defaults) await setting(key, value);
});

// ---- F-08: guard against open policies and stray grants ----
test('F-08: every public table has forced RLS, and no policy is open or reaches anon/public', async () => {
  const tables = (await db.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`)).rows;
  assert.ok(tables.length >= 2);
  for (const t of tables) assert.ok(t.relrowsecurity && t.relforcerowsecurity, `${t.relname} must enable and force RLS`);
  const policies = (await db.query(`select tablename, policyname, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'public'`)).rows;
  assert.ok(policies.length >= 2);
  for (const p of policies) {
    assert.deepEqual(p.roles, ['sync_owner'], `${p.policyname} must only reach the definer role`);
    for (const expr of [p.qual, p.with_check].filter(Boolean)) {
      assert.doesNotMatch(expr, /^\s*\(?\s*true\s*\)?\s*$/i, `${p.policyname} is open`);
      assert.match(expr, /user_id = \( SELECT sync\.current_user_id\(\)/i, `${p.policyname} must be owner-only`);
    }
    assert.ok(!p.roles.includes('public') && !p.roles.includes('anon'), `${p.policyname} reaches ${p.roles}`);
  }
});

test('F-04/F-08/R-01b: clients hold no table privileges at all; only the client RPCs are executable', async () => {
  const grants = (await db.query(`select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'PUBLIC') and table_schema in ('public', 'sync')`)).rows;
  assert.deepEqual(grants, []);
  const executable = (await db.query(`select n.nspname || '.' || p.proname as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'sync') and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).rows.map((r) => r.fn);
  assert.deepEqual(executable, ['public.sync_delete_my_data', 'public.sync_fetch', 'public.sync_list_conflicts', 'public.sync_manifest',
    'public.sync_pull', 'public.sync_push', 'public.sync_status']);
  const anonExec = (await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'sync') and has_function_privilege('anon', p.oid, 'execute')`)).rows;
  assert.deepEqual(anonExec, []);
  const fns = (await db.query(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'sync\\_%'`)).rows;
  for (const f of fns) assert.ok((f.proconfig || []).some((c) => c === 'search_path=""' || c === 'search_path='), `${f.proname} needs a fixed search_path`);
  assert.ok(fns.find((f) => f.proname === 'sync_push').prosecdef, 'sync_push is SECURITY DEFINER');
  const owner = (await db.query(`select r.rolname, r.rolsuper, r.rolbypassrls from pg_proc p join pg_roles r on r.oid = p.proowner where p.proname = 'sync_push'`)).rows[0];
  assert.deepEqual(owner, { rolname: 'sync_owner', rolsuper: false, rolbypassrls: false });
});

test('F-04: a client cannot write rows directly or pick change_seq, version or lamport', async () => {
  await push(U, [prompt('p1')]);
  const attempts = [
    `insert into public.sync_items (user_id, kind, item_id, payload, device_id, change_seq, version, lamport) values ('${U}', 'prompt', 'evil', '{}', 'x', 999999999, 77, 9000000000000000000)`,
    `update public.sync_items set change_seq = 1, version = 99 where user_id = '${U}'`,
    `delete from public.sync_items where user_id = '${U}'`,
    `insert into public.sync_conflicts (user_id, kind, item_id, losing_payload, losing_device_id, losing_lamport, winning_version) values ('${U}', 'prompt', 'x', '{}', 'x', 1, 1)`,
    `select nextval('public.sync_change_seq')`,
    `update sync.settings set value = 'off'`,
  ];
  for (const sql of attempts) await assert.rejects(as(U, () => db.query(sql)), /permission denied/, sql);
  await assert.rejects(push(U, [{ ...prompt('big-clock'), lamport: 9007199254740991 }]), /invalid lamport/);
  assert.equal(await count(U), 1);
});

// ---- F-02: only active Clerk session tokens from the configured issuer ----
test('F-02: rejects foreign issuers, pending sessions, anonymous and Supabase-Auth tokens', async () => {
  const bad = [
    claimsFor(U, { iss: 'https://evil.example.com' }),
    claimsFor(U, { iss: 'https://abcd.supabase.co/auth/v1' }),
    claimsFor(U, { sts: 'pending' }),
    claimsFor(U, { role: 'anon' }),
    claimsFor(U, { is_anonymous: true }),
    claimsFor('3f1c2a4e-1111-4222-8333-944445555666'),
    claimsFor('3f1c2a4e-1111-4222-8333-944445555666', { iss: 'https://abcd.supabase.co/auth/v1', is_anonymous: true }),
    claimsFor('user_x; drop table'),
  ];
  for (const claims of bad) {
    await assert.rejects(push(claims, [prompt('p1')]), /not authenticated/, JSON.stringify(claims));
    await assert.rejects(rpc(claims, 'select * from public.sync_pull(0, 10)'), /not authenticated/, JSON.stringify(claims));
  }
  assert.equal((await push(claimsFor(U, { sts: 'active' }), [prompt('ok')]))[0].status, 'applied');
});

// ---- F-01: per-user quotas ----
test('F-01: per-user item cap rejects the batch that goes over, and deletes still work', async () => {
  await setting('max_live_items_per_user', 3);
  await push(U, [prompt('a'), prompt('b'), prompt('c')]);
  await assert.rejects(push(U, [prompt('d')]), /quota exceeded/);
  assert.equal(await count(U), 3);
  assert.equal((await push(V, [prompt('d')]))[0].status, 'applied', 'other users are unaffected');
  const [rowA] = await adminRows(`select version from public.sync_items where user_id = $1 and item_id = 'a'`, [U]);
  assert.equal((await push(U, [{ kind: 'prompt', item_id: 'a', base_version: Number(rowA.version), lamport: 2, deleted: true }]))[0].status, 'applied');
});

test('F-01: tombstones count toward the row cap', async () => {
  await setting('max_rows_per_user', 2);
  await push(U, [prompt('a'), { kind: 'prompt', item_id: 'gone', base_version: 0, lamport: 1, deleted: true }]);
  await assert.rejects(push(U, [{ kind: 'prompt', item_id: 'gone2', base_version: 0, lamport: 1, deleted: true }]), /quota exceeded/);
});

test('F-01: per-user byte cap and per-request byte cap', async () => {
  await setting('max_bytes_per_user', 300000);
  const blob = 'x'.repeat(200000);
  await push(U, [prompt('a', { original: blob })]);
  await assert.rejects(push(U, [prompt('b', { original: blob })]), /quota exceeded/);
  assert.equal(await count(U), 1);
  await setting('max_request_bytes', 100000);
  await assert.rejects(push(V, [prompt('c', { original: 'y'.repeat(120000) })]), /request too large/);
  assert.equal(await count(V), 0);
});

test('F-01: conflict copies are capped per item and per user', async () => {
  await setting('max_conflicts_per_item', 3);
  await setting('max_conflicts_per_user', 5);
  await push(U, [prompt('a'), prompt('b')]);
  for (let i = 0; i < 6; i += 1) {
    await push(U, [{ ...prompt('a', { title: `stale ${i}` }), base_version: 0, lamport: 0 }], `dev-x${i}`);
    await push(U, [{ ...prompt('b', { title: `stale ${i}` }), base_version: 0, lamport: 0 }], `dev-x${i}`);
  }
  const copies = await rpc(U, 'select item_id from public.sync_list_conflicts(200)');
  assert.ok(copies.filter((row) => row.item_id === 'a').length <= 3);
  assert.equal(copies.length, 5);
});

test('F-01: project-wide size guard stops growth, still allows deletes', async () => {
  await push(U, [prompt('a')]);
  await setting('max_database_bytes', 1);
  await assert.rejects(push(V, [prompt('b')]), (error) => error.code === 'PT507' && /storage is full/.test(error.message));
  const [row] = await adminRows(`select version from public.sync_items where user_id = $1 and item_id = 'a'`, [U]);
  assert.equal((await push(U, [{ kind: 'prompt', item_id: 'a', base_version: Number(row.version), lamport: 2, deleted: true }]))[0].status, 'applied');
});

// ---- F-10 / F-17: rate limit and kill switch ----
test('F-10: per-user push rate limit', async () => {
  await setting('push_per_minute', 3);
  for (let i = 0; i < 3; i += 1) await push(U, [prompt(`r${i}`)]);
  await assert.rejects(push(U, [prompt('r3')]), /too many sync requests/);
  assert.equal((await push(V, [prompt('r3')]))[0].status, 'applied', 'limit is per user');
});

test('F-17: the server-side kill switch pauses push and pull but not erasure', async () => {
  await push(U, [prompt('a')]);
  await setting('enabled', 'off');
  await assert.rejects(push(U, [prompt('b')]), /paused/);
  await assert.rejects(as(U, () => db.query('select * from public.sync_pull(0, 10)')), /paused/);
  const status = (await as(U, () => db.query('select public.sync_status() as s'))).rows[0].s;
  assert.equal(status.enabled, false);
  const erased = (await as(U, () => db.query('select public.sync_delete_my_data() as r'))).rows[0].r;
  assert.equal(erased.items, 1);
});

test('errors carry PostgREST status codes (PT413, PT429, PT503)', async () => {
  await setting('enabled', 'off');
  await assert.rejects(push(U, [prompt('a')]), (error) => error.code === 'PT503');
  await setting('enabled', 'on');
  await setting('max_request_bytes', 10);
  await assert.rejects(push(U, [prompt('a')]), (error) => error.code === 'PT413');
});

// ---- F-06 support: manifest and fetch ----
test('manifest lists versions without payloads; fetch returns named rows only for the caller', async () => {
  await push(U, [prompt('a'), prompt('b')]);
  await push(V, [prompt('a')]);
  const manifest = (await as(U, () => db.query('select * from public.sync_manifest() order by item_id'))).rows;
  assert.deepEqual(manifest.map((row) => [row.item_id, Number(row.version), Object.keys(row).includes('payload')]), [['a', 1, false], ['b', 1, false]]);
  const fetched = (await as(U, () => db.query('select * from public.sync_fetch($1::jsonb)', [JSON.stringify([{ kind: 'prompt', item_id: 'b' }, { kind: 'prompt', item_id: 'zzz' }])]))).rows;
  assert.deepEqual(fetched.map((row) => [row.item_id, row.payload.entry.title]), [['b', 'b']]);
});

// ---- F-09: account deletion path ----
test('F-09: sync_admin_delete_user is service-role only and erases only that user', async () => {
  await push(U, [prompt('a')]);
  await push(V, [prompt('a')]);
  await assert.rejects(as(V, () => db.query(`select public.sync_admin_delete_user('${U}')`)), /permission denied/);
  await assert.rejects(as(null, () => db.query(`select public.sync_admin_delete_user('${U}')`)), /permission denied/);
  const result = (await as({ role: 'service_role' }, () => db.query('select public.sync_admin_delete_user($1) as r', [U]), 'service_role')).rows[0].r;
  assert.equal(result.items, 1);
  assert.equal(await count(U), 0);
  assert.equal(await count(V), 1);
});

// ---- R-01: conflict copies are bounded and count against the quota ----
const conflictBytes = async (sub) => Number((await db.query(
  'select coalesce(sum(octet_length(losing_payload::text)), 0)::bigint as n from public.sync_conflicts where user_id = $1', [sub])).rows[0].n);

test('R-01: the review case (364 losing copies of ~250 KB = 86.8 MiB) is capped at 2 MiB of conflict copies', { timeout: 300000 }, async () => {
  await setting('push_per_minute', 100000);
  const ids = Array.from({ length: 364 }, (_, i) => `c${i}`);
  for (let i = 0; i < ids.length; i += 200) await push(U, ids.slice(i, i + 200).map((id) => prompt(id)));
  const itemBytes = Number((await db.query('select sum(octet_length(payload::text))::bigint as n from public.sync_items where user_id = $1', [U])).rows[0].n);
  const blob = 'z'.repeat(250000 - 80);
  let attempted = 0;
  const statuses = [];
  for (let i = 0; i < ids.length; i += 8) {
    // Stale base_version and a lower clock: every change loses and its
    // attacker-chosen payload would be kept as a conflict copy.
    const changes = ids.slice(i, i + 8).map((id) => ({ ...prompt(id, { original: blob }), base_version: 0, lamport: 0 }));
    attempted += changes.reduce((sum, change) => sum + JSON.stringify(change.payload).length, 0);
    const result = await push(U, changes, 'attacker');
    statuses.push(...result.map((r) => r.status));
  }
  assert.equal(statuses.length, 364);
  assert.ok(statuses.every((status) => status === 'conflict_lost'));
  assert.ok(attempted >= 364 * 249000 && attempted / 2 ** 20 > 86.5, `attempted ${(attempted / 2 ** 20).toFixed(1)} MiB`);
  const kept = await conflictBytes(U);
  assert.ok(kept <= 2 * 2 ** 20, `kept ${kept} bytes of conflict copies`);
  assert.ok(kept > 0);
  // The live library is untouched, and the status line reports the copies.
  assert.equal(Number((await db.query('select sum(octet_length(payload::text))::bigint as n from public.sync_items where user_id = $1', [U])).rows[0].n), itemBytes);
  const [{ s: status }] = await rpc(U, 'select public.sync_status() as s');
  assert.equal(status.conflict_bytes, kept);
  assert.equal(status.max_conflict_bytes, 2 * 2 ** 20);
});

test('R-01: conflict bytes count against the per-user byte quota (rejected, not stored)', async () => {
  await setting('max_bytes_per_user', 600000);
  await setting('max_conflict_bytes_per_user', 10 * 2 ** 20);
  await push(U, [prompt('a', { original: 'a'.repeat(200000) }), prompt('b')]);
  // A 250 KB losing copy fits (200 KB + 250 KB < 600 KB) ...
  assert.equal((await push(U, [{ ...prompt('b', { original: 'l'.repeat(250000) }), lamport: 0 }], 'dev-old'))[0].status, 'conflict_lost');
  // ... the next one would take items + conflicts past the quota: the whole push is refused.
  await assert.rejects(push(U, [{ ...prompt('b', { original: 'm'.repeat(250000) }), lamport: 0 }], 'dev-old'),
    (error) => error.code === 'PT413' && /quota exceeded/.test(error.message));
  assert.equal((await adminRows('select count(*)::int as n from public.sync_conflicts where user_id = $1', [U]))[0].n, 1);
});

test('R-01: the project size guard runs on conflict-only writes', async () => {
  await push(U, [prompt('a')]);
  await setting('max_database_bytes', 1);
  await assert.rejects(push(U, [{ ...prompt('a', { title: 'stale' }), lamport: 0 }], 'dev-old'), (error) => error.code === 'PT507');
  assert.equal(await conflictBytes(U), 0);
});

// ---- R-01b: reads only through guarded RPCs, with a daily download budget ----
test('R-01b: a direct REST-style select on sync tables is denied for signed-in and anonymous callers', async () => {
  await push(U, [prompt('a')]);
  await push(U, [{ ...prompt('a', { title: 'stale' }), lamport: 0 }], 'dev-old');
  for (const sql of ['select * from public.sync_items', 'select * from public.sync_conflicts', 'select count(*) from public.sync_items',
    'select * from sync.egress', 'select * from sync.rate', 'select * from sync.settings']) {
    await assert.rejects(rpc(U, sql), /permission denied/, sql);
    await assert.rejects(rpc(null, sql), /permission denied/, sql);
  }
});

test('R-01b: every read RPC is refused while the kill switch is on', async () => {
  await push(U, [prompt('a')]);
  await setting('enabled', 'off');
  for (const sql of ['select * from public.sync_pull(0, 10)', 'select * from public.sync_manifest()',
    `select * from public.sync_fetch('[{"kind":"prompt","item_id":"a"}]'::jsonb)`, 'select * from public.sync_list_conflicts(10)']) {
    await assert.rejects(rpc(U, sql), (error) => error.code === 'PT503' && /paused/.test(error.message), sql);
  }
});

test('R-01b: listConflicts RPC returns only the caller copies, newest first', async () => {
  await push(U, [prompt('a')]);
  await push(V, [prompt('a')]);
  await push(U, [{ ...prompt('a', { title: 'old 1' }), lamport: 0 }], 'dev-old');
  await push(U, [{ ...prompt('a', { title: 'old 2' }), lamport: 0 }], 'dev-old');
  const mine = await rpc(U, 'select * from public.sync_list_conflicts(100)');
  assert.deepEqual(mine.map((row) => row.losing_payload.entry.title), ['old 2', 'old 1']);
  assert.equal((await rpc(V, 'select * from public.sync_list_conflicts(100)')).length, 0);
});

test('R-01b: per-user and project daily download budgets are enforced', async () => {
  const blob = 'e'.repeat(100000);
  await push(U, [prompt('a', { original: blob }), prompt('b', { original: blob })]);
  await push(V, [prompt('a', { original: blob })]);
  await setting('max_egress_bytes_per_user_day', 300000);
  assert.equal((await rpc(U, 'select * from public.sync_pull(0, 500)')).length, 2); // ~200 KB charged
  await assert.rejects(rpc(U, 'select * from public.sync_pull(0, 500)'), (error) => error.code === 'PT429' && /download budget/.test(error.message));
  await assert.rejects(rpc(U, `select * from public.sync_fetch('[{"kind":"prompt","item_id":"a"},{"kind":"prompt","item_id":"b"}]'::jsonb)`), /download budget/);
  const [{ s: status }] = await rpc(U, 'select public.sync_status() as s');
  assert.ok(status.egress_bytes_today > 200000 && status.egress_bytes_today <= 300000);
  assert.equal((await rpc(V, 'select * from public.sync_pull(0, 500)')).length, 1, 'the per-user budget is per user');
  // Project-wide budget: once spent, every user is refused until the UTC day rolls over.
  await setting('max_egress_bytes_per_user_day', 10 ** 9);
  await setting('max_egress_bytes_per_day', 400000);
  await assert.rejects(rpc(V, 'select * from public.sync_pull(0, 500)'), /download budget for today/);
  // A new UTC day resets the counters.
  await db.query(`update sync.egress set day = day - 1`);
  assert.equal((await rpc(V, 'select * from public.sync_pull(0, 500)')).length, 1);
});

test('R-01b: a read page stops at max_response_bytes and the cursor picks up the rest', async () => {
  const blob = 'p'.repeat(100000);
  await push(U, [prompt('a', { original: blob }), prompt('b', { original: blob }), prompt('c', { original: blob })]);
  await setting('max_response_bytes', 150000);
  const first = await rpc(U, 'select * from public.sync_pull(0, 500)');
  assert.deepEqual(first.map((row) => row.item_id), ['a']);
  const second = await rpc(U, 'select * from public.sync_pull($1, 500)', [first[0].change_seq]);
  assert.deepEqual(second.map((row) => row.item_id), ['b']);
  const fetched = await rpc(U, `select item_id from public.sync_fetch('[{"kind":"prompt","item_id":"b"},{"kind":"prompt","item_id":"c"}]'::jsonb)`);
  assert.equal(fetched.length, 1);
});

test('R-01b: the default pull limit suits a 5-minute poll (12 reads a minute)', async () => {
  const [{ value }] = await adminRows(`select value from sync.settings where key = 'pull_per_minute'`);
  assert.equal(Number(value), 12);
  for (let i = 0; i < 12; i += 1) await rpc(U, 'select * from public.sync_pull(0, 10)');
  await assert.rejects(rpc(U, 'select * from public.sync_manifest()'), (error) => error.code === 'PT429');
  assert.equal((await rpc(V, 'select * from public.sync_pull(0, 10)')).length, 0);
});
