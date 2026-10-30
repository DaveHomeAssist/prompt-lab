// Review findings F-01, F-02, F-04, F-08, F-09, F-10, F-17 as executable
// checks against the real migration in local Postgres (PGlite).
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, claimsFor, createDb } from './helpers.mjs';

let db; let as;
const U = 'user_Quota1';
const V = 'user_Other2';
const prompt = (id, extra = {}) => ({ kind: 'prompt', item_id: id, base_version: 0, lamport: 1, payload: { state: 'active', entry: { id, title: id, ...extra } } });
const push = (claims, changes, device = 'dev-1') => as(claims, async () => (await db.query('select public.sync_push($1, $2::jsonb) as r', [device, JSON.stringify(changes)])).rows[0].r);
const setting = (key, value) => db.query('update sync.settings set value = $2 where key = $1', [key, String(value)]);
const count = async (sub) => Number((await as(sub, () => db.query('select count(*)::int as n from public.sync_items'))).rows[0].n);

before(async () => { db = await createDb(); as = asRole(db); });
beforeEach(async () => {
  await db.exec('reset role');
  await db.exec(`delete from public.sync_items; delete from public.sync_conflicts; delete from sync.rate;
    update sync.settings set value = d.value from (values ('enabled','on'),('max_rows_per_user','10000'),('max_live_items_per_user','5000'),
      ('max_bytes_per_user','10485760'),('max_database_bytes','419430400'),('max_request_bytes','2097152'),('max_conflicts_per_item','10'),('max_conflicts_per_user','500'),
      ('push_per_minute','60'),('pull_per_minute','120')) as d(key, value) where settings.key = d.key;`);
});

// ---- F-08: guard against open policies and stray grants ----
test('F-08: every public table has forced RLS, and no policy is open or reaches anon/public', async () => {
  const tables = (await db.query(`select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`)).rows;
  assert.ok(tables.length >= 2);
  for (const t of tables) assert.ok(t.relrowsecurity && t.relforcerowsecurity, `${t.relname} must enable and force RLS`);
  const policies = (await db.query(`select tablename, policyname, roles::text[] as roles, qual, with_check from pg_policies where schemaname = 'public'`)).rows;
  assert.ok(policies.length >= 4);
  for (const p of policies) {
    for (const expr of [p.qual, p.with_check].filter(Boolean)) {
      assert.doesNotMatch(expr, /^\s*\(?\s*true\s*\)?\s*$/i, `${p.policyname} is open`);
      assert.match(expr, /user_id = \( SELECT sync\.current_user_id\(\)/i, `${p.policyname} must be owner-only`);
    }
    assert.ok(!p.roles.includes('public') && !p.roles.includes('anon'), `${p.policyname} reaches ${p.roles}`);
  }
});

test('F-04/F-08: clients hold SELECT only; anon holds nothing; sync schema tables are private', async () => {
  const grants = (await db.query(`select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'public') and table_schema in ('public', 'sync')`)).rows;
  const bad = grants.filter((g) => g.grantee !== 'authenticated' || g.privilege_type !== 'SELECT' || g.table_schema !== 'public');
  assert.deepEqual(bad, []);
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
    assert.equal((await as(claims, () => db.query('select * from public.sync_items'))).rows.length, 0);
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
  const rowA = (await as(U, () => db.query(`select version from public.sync_items where item_id = 'a'`))).rows[0];
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
  const copies = (await as(U, () => db.query('select item_id from public.sync_conflicts'))).rows;
  assert.ok(copies.filter((row) => row.item_id === 'a').length <= 3);
  assert.equal(copies.length, 5);
});

test('F-01: project-wide size guard stops growth, still allows deletes', async () => {
  await push(U, [prompt('a')]);
  await setting('max_database_bytes', 1);
  await assert.rejects(push(V, [prompt('b')]), (error) => error.code === 'PT507' && /storage is full/.test(error.message));
  const [row] = (await as(U, () => db.query(`select version from public.sync_items where item_id = 'a'`))).rows;
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
