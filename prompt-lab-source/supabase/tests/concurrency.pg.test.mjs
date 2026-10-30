// F-05: concurrent pushes from two devices of one user must never let a pull
// cursor skip a change. Needs real multi-connection Postgres, so this starts a
// throwaway local Postgres 17 (embedded-postgres) on a random port.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { claimsFor, migrationSql, shimSql } from './helpers.mjs';

const port = 55000 + Math.floor(Math.random() * 5000);
const dataDir = mkdtempSync(join(tmpdir(), 'pl-sync-pg-'));
const password = `local-${Math.random().toString(36).slice(2)}`;
let server;
const connect = async () => { const client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' }); await client.connect(); return client; };

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
