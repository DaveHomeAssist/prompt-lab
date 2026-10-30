// Real multi-connection Postgres checks. Starts a throwaway local Postgres 17
// (embedded-postgres) on a random port.
// F-05: concurrent pushes from two devices of one user must never let a pull
//       cursor skip a change.
// LOW (re-review): account deletion takes the same per-user lock as a push.
// R-06: pg_dump / restore rehearsal with the box's pg_dump 17 client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { claimsFor, migrationSql, shimSql } from './helpers.mjs';

const port = 55000 + Math.floor(Math.random() * 5000);
const dataDir = mkdtempSync(join(tmpdir(), 'pl-sync-pg-'));
const password = `local-${Math.random().toString(36).slice(2)}`;
let server;
const connect = async (database = 'postgres') => { const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database }); await client.connect(); return client; };

before(async () => {
  server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password, port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  const admin = await connect();
  await admin.query(shimSql());
  for (const sql of migrationSql()) await admin.query(sql);
  await admin.query(`update sync.settings set value = '100000' where key in ('push_per_minute', 'pull_per_minute')`);
  await admin.end();
});
after(async () => { await server?.stop(); rmSync(dataDir, { recursive: true, force: true }); });

async function asUser(client, sub, sql, params) {
  await client.query('begin');
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claimsFor(sub))]);
    await client.query('set local role authenticated');
    const result = await client.query(sql, params);
    return { result, commit: () => client.query('commit') };
  } catch (error) { await client.query('rollback'); throw error; }
}

test('F-05: two devices pushing at once, with slow commits, never make a cursor skip a change', { timeout: 120000 }, async () => {
  const sub = 'user_Concurrent1';
  const writers = await Promise.all([connect(), connect(), connect()]);
  const reader = await connect();
  const pushed = new Set();
  const seen = new Set();
  let cursor = 0;
  let writing = true;
  const writer = async (client, name) => {
    for (let round = 0; round < 25; round += 1) {
      const ids = Array.from({ length: 4 }, (_, i) => `${name}-${round}-${i}`);
      const changes = ids.map((id) => ({ kind: 'prompt', item_id: id, base_version: 0, lamport: round + 1, payload: { state: 'active', entry: { id } } }));
      const { commit } = await asUser(client, sub, 'select public.sync_push($1, $2::jsonb)', [name, JSON.stringify(changes)]);
      // Hold the transaction open after the push, so a late commit is likely.
      await client.query(`select pg_sleep(${(Math.random() * 0.015).toFixed(4)})`);
      await commit();
      ids.forEach((id) => pushed.add(id));
    }
  };
  const pullOnce = async () => {
    const { result, commit } = await asUser(reader, sub, 'select item_id, change_seq from public.sync_pull($1, 1000)', [cursor]);
    await commit();
    for (const row of result.rows) { seen.add(row.item_id); cursor = Math.max(cursor, Number(row.change_seq)); }
    return result.rows.length;
  };
  const puller = (async () => { while (writing) { await pullOnce(); await new Promise((resolve) => setTimeout(resolve, 1)); } })();
  await Promise.all(writers.map((client, index) => writer(client, `dev${index}`)));
  writing = false;
  await puller;
  while (await pullOnce()) { /* drain */ }
  const missed = [...pushed].filter((id) => !seen.has(id));
  assert.equal(pushed.size, 300);
  assert.deepEqual(missed, [], `cursor skipped ${missed.length} changes`);
  await Promise.all([...writers, reader].map((client) => client.end()));
});

test('LOW: sync_admin_delete_user waits for an in-flight push and erases what it wrote', { timeout: 60000 }, async () => {
  const sub = 'user_DeleteRace1';
  const pusher = await connect();
  const admin = await connect();
  const changes = [{ kind: 'prompt', item_id: 'late', base_version: 0, lamport: 1, payload: { state: 'active', entry: { id: 'late' } } }];
  const { commit } = await asUser(pusher, sub, 'select public.sync_push($1, $2::jsonb)', ['dev', JSON.stringify(changes)]);
  // The push holds the per-user lock and has not committed yet.
  await admin.query('begin');
  await admin.query('set local role service_role');
  let deleted = null;
  const erase = admin.query('select public.sync_admin_delete_user($1) as r', [sub]).then((result) => { deleted = result.rows[0].r; });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(deleted, null, 'erasure must wait for the per-user lock');
  await commit();
  await erase;
  await admin.query('commit');
  assert.equal(deleted.items, 1, 'the late push is erased, not left behind');
  const left = await admin.query('select count(*)::int as n from public.sync_items where user_id = $1', [sub]);
  assert.equal(left.rows[0].n, 0);
  await Promise.all([pusher.end(), admin.end()]);
});

const PG_DUMP = ['/usr/lib/postgresql/17/bin/pg_dump', '/usr/bin/pg_dump'].find((path) => existsSync(path));
const PSQL = ['/usr/lib/postgresql/17/bin/psql', '/usr/bin/psql'].find((path) => existsSync(path));

test('R-06: weekly pg_dump export restores into a fresh database per the runbook', { timeout: 120000, skip: !(PG_DUMP && PSQL) && 'pg_dump/psql not installed' }, async () => {
  const src = await connect();
  const R = 'user_Restore1';
  const items = Array.from({ length: 20 }, (_, i) => ({ kind: 'prompt', item_id: `r${i}`, base_version: 0, lamport: i + 1, payload: { state: 'active', entry: { id: `r${i}`, title: `Restore ${i}`, notes: 'é ünïcödé ✓' } } }));
  await (await asUser(src, R, 'select public.sync_push($1, $2::jsonb)', ['dev', JSON.stringify(items)])).commit();
  await (await asUser(src, R, 'select public.sync_push($1, $2::jsonb)', ['dev-old', JSON.stringify([{ ...items[0], lamport: 0, payload: { state: 'active', entry: { id: 'r0', title: 'loser' } } }])])).commit();
  const snapshot = async (client) => (await client.query(`select user_id, kind, item_id, md5(payload::text) as h, deleted, version, lamport, device_id from public.sync_items order by 1, 2, 3`)).rows;
  const before = await snapshot(src);
  const conflictsBefore = (await src.query('select user_id, item_id, md5(losing_payload::text) as h from public.sync_conflicts order by id')).rows;
  const maxSeq = Number((await src.query('select max(change_seq) as m from public.sync_items')).rows[0].m);
  const env = { ...process.env, PGPASSWORD: password };
  const conn = ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres'];
  const dir = mkdtempSync(join(tmpdir(), 'pl-sync-dump-'));
  const file = join(dir, 'sync.sql');
  try {
    // Runbook "Weekly export", plain pg_dump variant.
    execFileSync(PG_DUMP, [...conn, '-d', 'postgres', '--data-only', '--no-owner', '-t', 'public.sync_items', '-t', 'public.sync_conflicts', '-t', 'sync.settings', '-f', file], { env });
    const dump = readFileSync(file, 'utf8');
    assert.match(dump, /COPY public\.sync_items/);
    assert.equal((dump.match(/^user_/gm) || []).length >= before.length, true);
    // Runbook "Restore" step 2: a new database with the schema, then the data.
    await src.query('create database rehearsal');
    const dst = await connect('rehearsal');
    await dst.query(shimSql().split('\n').filter((line) => !/^create role/i.test(line)).join('\n'));
    for (const sql of migrationSql()) await dst.query(sql);
    // Before loading: settings rows are in the dump, and new change_seq values
    // must land above every device cursor (devices then re-pull the rows).
    await dst.query('truncate sync.settings');
    await dst.query(`select setval('public.sync_change_seq', $1)`, [maxSeq]);
    await dst.end();
    execFileSync(PSQL, [...conn, '-d', 'rehearsal', '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { env });
    const check = await connect('rehearsal');
    assert.deepEqual(await snapshot(check), before, 'every row, version, clock and payload restored');
    assert.deepEqual((await check.query('select user_id, item_id, md5(losing_payload::text) as h from public.sync_conflicts order by id')).rows, conflictsBefore);
    assert.ok(Number((await check.query('select min(change_seq) as m from public.sync_items')).rows[0].m) > maxSeq, 'restored rows sort after every old cursor');
    assert.equal((await check.query(`select value from sync.settings where key = 'pull_per_minute'`)).rows[0].value, '100000');
    // A device that had synced up to the old max cursor gets the restored rows on its next pull,
    // and pushes work on the restored database.
    const pulled = await asUser(check, R, 'select item_id from public.sync_pull($1, 1000)', [maxSeq]);
    await pulled.commit();
    assert.equal(pulled.result.rows.length, 20);
    const pushed = await asUser(check, R, 'select public.sync_push($1, $2::jsonb) as r', ['dev', JSON.stringify([{ kind: 'prompt', item_id: 'after-restore', base_version: 0, lamport: 99, payload: { state: 'active', entry: { id: 'after-restore' } } }])]);
    await pushed.commit();
    assert.equal(pushed.result.rows[0].r[0].status, 'applied');
    await check.end();
  } finally {
    await src.query('drop database if exists rehearsal').catch(() => {});
    await src.end();
    rmSync(dir, { recursive: true, force: true });
  }
});
