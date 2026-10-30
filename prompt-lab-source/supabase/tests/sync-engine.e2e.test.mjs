// Drives the real client sync engine (prompt-lab-extension/src/lib/sync)
// against the real migration in local Postgres (PGlite). Each "device" is its
// own in-memory localStorage; each user is a Clerk-style `sub` claim.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine } from '../../prompt-lab-extension/src/lib/sync/syncEngine.js';
import { markLibraryDeleted } from '../../prompt-lab-extension/src/lib/libraryDeletion.js';
import { readLocalSnapshot, restoreLocalSnapshot } from '../../prompt-lab-extension/src/lib/sync/syncBackup.js';
import { asRole, createDb } from './helpers.mjs';

let db;
let as;
let networkDown = false;

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const asUser = (sub, sql, params) => as(sub, async () => (await db.query(sql, params)).rows);

// Same calls supabaseTransport.js makes over HTTP, with PostgREST's status mapping.
function pgTransport(sub) {
  const call = async (sql, params) => {
    if (networkDown) throw Object.assign(new Error('Network unavailable.'), { status: 0 });
    try { return await asUser(sub, sql, params); } catch (error) {
      const status = /^PT\d{3}$/.test(error.code || '') ? Number(error.code.slice(2)) : error.code === '28000' ? 401 : 400;
      throw Object.assign(new Error(error.message), { status });
    }
  };
  return {
    pull: (cursor, limit) => call('select * from public.sync_pull($1, $2)', [cursor, limit]),
    push: async (device, changes) => (await call('select public.sync_push($1, $2::jsonb) as r', [device, JSON.stringify(changes)]))[0].r,
    fetchItems: (keys) => call('select * from public.sync_fetch($1::jsonb)', [JSON.stringify(keys)]),
    manifest: () => call('select * from public.sync_manifest()'),
  };
}

let fakeNow = Date.parse('2026-10-30T10:00:00Z');
const now = () => fakeNow;
function device(name, sub) {
  const storage = new MemoryStorage();
  const engine = () => createSyncEngine({ storage, transport: pgTransport(sub), userId: sub, deviceId: name, now, random: () => 0.5 });
  return { storage, sync: (options) => engine().syncOnce(options), name };
}
const entry = (id, title, updatedAt = '2026-10-29T12:00:00Z', extra = {}) => ({ id, title, original: `${title} text`, enhanced: '', notes: '', tags: [], collection: '', createdAt: '2026-10-29T00:00:00Z', updatedAt, ...extra });
const read = (dev, key) => JSON.parse(dev.storage.getItem(key) || '[]');
const titles = (dev) => read(dev, 'pl2-library').map((item) => item.title).sort();
const write = (dev, key, value) => dev.storage.setItem(key, JSON.stringify(value));

const A = 'user_Ae2e';
const B = 'user_Be2e';
const a1 = device('a1-laptop', A);
const a2 = device('a2-desktop', A);

before(async () => { db = await createDb(); as = asRole(db); });

test('first device uploads its existing Library on first sign-in', async () => {
  write(a1, 'pl2-library', [entry('p1', 'Alpha'), entry('p2', 'Beta')]);
  write(a1, 'pl2-library-trash', [entry('t1', 'Trashed', undefined, { deletedAt: '2026-10-29T13:00:00Z' })]);
  write(a1, 'pl2-collections', ['Work']);
  const result = await a1.sync();
  assert.equal(result.status, 'synced');
  assert.equal(result.pending, 0);
  const server = await asUser(A, 'select kind, item_id from public.sync_items order by kind, item_id');
  assert.deepEqual(server.map((row) => `${row.kind}:${row.item_id}`), ['prompt:p1', 'prompt:p2', 'prompt:t1', 'structure:main']);
});

test('second device merges: exact duplicates dropped, its own prompts uploaded, collections unioned', async () => {
  write(a2, 'pl2-library', [entry('x9', 'Alpha'), entry('p3', 'Gamma')]); // x9 duplicates p1's content
  write(a2, 'pl2-collections', ['Home']);
  const result = await a2.sync();
  assert.equal(result.status, 'synced');
  assert.equal(result.dropped, 1);
  const snapshot = readLocalSnapshot(a2.storage, A);
  assert.equal(snapshot.reason, 'first-sync');
  assert.deepEqual(JSON.parse(snapshot.data['pl2-library']).map((item) => item.id), ['x9', 'p3'], 'the dropped duplicate is in the snapshot');
  assert.deepEqual(titles(a2), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(read(a2, 'pl2-library-trash').map((item) => item.id), ['t1']);
  assert.deepEqual(read(a2, 'pl2-collections').sort(), ['Home', 'Work']);
  await a1.sync();
  assert.deepEqual(titles(a1), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(read(a1, 'pl2-collections').sort(), ['Home', 'Work']);
});

test('an edit on one device reaches the other', async () => {
  write(a1, 'pl2-library', read(a1, 'pl2-library').map((item) => item.id === 'p2' ? { ...item, title: 'Beta v2', updatedAt: '2026-10-30T09:00:00Z' } : item));
  await a1.sync();
  const result = await a2.sync();
  assert.equal(result.pulled, 1);
  assert.deepEqual(titles(a2), ['Alpha', 'Beta v2', 'Gamma']);
});

test('concurrent edits: one copy wins on both devices, the other is kept as a conflict copy', async () => {
  const edit = (dev, title) => write(dev, 'pl2-library', read(dev, 'pl2-library').map((item) => item.id === 'p1' ? { ...item, title, updatedAt: '2026-10-30T09:30:00Z' } : item));
  edit(a1, 'Alpha from laptop');
  edit(a2, 'Alpha from desktop');
  await a1.sync();
  const second = await a2.sync();
  assert.equal(second.conflicts, 1);
  await a1.sync();
  const one = read(a1, 'pl2-library').find((item) => item.id === 'p1').title;
  const two = read(a2, 'pl2-library').find((item) => item.id === 'p1').title;
  assert.equal(one, two, 'devices converge');
  const copies = await asUser(A, `select losing_payload from public.sync_conflicts where item_id = 'p1'`);
  const kept = copies.map((row) => row.losing_payload.entry.title);
  assert.ok(kept.includes(one === 'Alpha from laptop' ? 'Alpha from desktop' : 'Alpha from laptop'), 'loser is recoverable');
  assert.equal((await a1.sync()).pending, 0);
  assert.equal((await a2.sync()).pending, 0);
});

test('a permanent delete propagates as a tombstone and is not resurrected', async () => {
  write(a1, 'pl2-library', read(a1, 'pl2-library').filter((item) => item.id !== 'p3'));
  markLibraryDeleted(['p3'], a1.storage);
  await a1.sync();
  await a2.sync();
  assert.ok(!read(a2, 'pl2-library').some((item) => item.id === 'p3'));
  assert.equal(a2.storage.getItem('pl2-library-deleted:p3'), '1');
  const [row] = await asUser(A, `select deleted, payload from public.sync_items where item_id = 'p3'`);
  assert.deepEqual([row.deleted, row.payload], [true, null]);
});

test('offline edits stay queued with backoff and go out when the network returns', async () => {
  write(a2, 'pl2-library', [...read(a2, 'pl2-library'), entry('p4', 'Offline idea', '2026-10-30T10:00:00Z')]);
  networkDown = true;
  const offline = await a2.sync();
  networkDown = false;
  assert.equal(offline.status, 'offline');
  assert.ok(offline.pending >= 1);
  const queued = JSON.parse(a2.storage.getItem(`pl2-sync-queue:${A}`));
  assert.ok(Object.values(queued).every((item) => item.attempts === 1 && item.nextAttemptAt > fakeNow));
  fakeNow += 10 * 60 * 1000;
  const back = await a2.sync();
  assert.equal(back.status, 'synced');
  assert.equal(back.pending, 0);
  await a1.sync();
  assert.ok(titles(a1).includes('Offline idea'));
});

test('clearing site data loses nothing: a fresh device restores the whole Library', async () => {
  const fresh = device('a1-after-clear', A);
  const result = await fresh.sync();
  assert.equal(result.status, 'synced');
  assert.deepEqual(titles(fresh), titles(a1));
  assert.deepEqual(read(fresh, 'pl2-library-trash').map((item) => item.id), ['t1']);
});

test('another user sees none of it, and a device signed in as A does not auto-merge into B', async () => {
  const b1 = device('b1', B);
  write(b1, 'pl2-library', [entry('p1', 'B private')]);
  await b1.sync();
  assert.deepEqual(titles(b1), ['B private']);
  const seenByB = await asUser(B, 'select item_id from public.sync_items');
  assert.deepEqual(seenByB.map((row) => row.item_id).sort(), ['main', 'p1']);
  const wrongUser = createSyncEngine({ storage: a1.storage, transport: pgTransport(B), userId: B, deviceId: 'a1-laptop', now });
  assert.equal((await wrongUser.syncOnce()).status, 'owner-mismatch');
  const [bRow] = await asUser(B, `select payload from public.sync_items where item_id = 'p1'`);
  assert.equal(bRow.payload.entry.title, 'B private');
});

test('restoring the first-sync snapshot brings back a dropped duplicate, and it syncs', async () => {
  const dev = device('a5-restore', A);
  write(dev, 'pl2-library', [entry('dupe', 'Beta v2', '2026-10-30T09:00:00Z')]);
  const first = await dev.sync();
  assert.equal(first.dropped, 0, 'not an exact duplicate (different updatedAt is fine, content differs)');
  const dev2 = device('a6-restore', A);
  const remoteAlpha = read(a1, 'pl2-library').find((item) => item.id === 'p2');
  write(dev2, 'pl2-library', [{ ...remoteAlpha, id: 'copy-of-p2' }]);
  const merged = await dev2.sync();
  assert.equal(merged.dropped, 1);
  assert.ok(!read(dev2, 'pl2-library').some((item) => item.id === 'copy-of-p2'));
  restoreLocalSnapshot(dev2.storage, readLocalSnapshot(dev2.storage, A));
  assert.ok(read(dev2, 'pl2-library').some((item) => item.id === 'copy-of-p2'));
  assert.deepEqual(titles(dev2).filter((title) => title !== 'Beta v2'), titles(a1).filter((title) => title !== 'Beta v2'), 'restore merges; it never removes synced prompts');
  const after = await dev2.sync();
  assert.equal(after.status, 'synced');
  const [row] = await asUser(A, `select item_id from public.sync_items where item_id = 'copy-of-p2'`);
  assert.equal(row.item_id, 'copy-of-p2');
  const live = await asUser(A, `select count(*)::int as n from public.sync_items where kind = 'prompt' and not deleted`);
  assert.ok(live[0].n >= 6, 'nothing was tombstoned by the restore');
});

test('daily manifest check: catches a missed change and re-uploads what the account lost', async () => {
  await a1.sync(); await a2.sync();
  // Simulate a missed pull on a2: rewind nothing, but make a1 change p2 and
  // then move a2's cursor past it, as if a pull had been skipped.
  write(a1, 'pl2-library', read(a1, 'pl2-library').map((item) => item.id === 'p2' ? { ...item, title: 'Beta v3', updatedAt: '2026-10-30T11:00:00Z' } : item));
  await a1.sync();
  const state = JSON.parse(a2.storage.getItem(`pl2-sync-state:${A}`));
  state.cursor = 10 ** 12;
  a2.storage.setItem(`pl2-sync-state:${A}`, JSON.stringify(state));
  await a2.sync();
  assert.ok(!titles(a2).includes('Beta v3'), 'cursor alone misses it');
  // The account loses an item (for example a restore from an older backup).
  await db.exec('reset role');
  await db.query(`delete from public.sync_items where user_id = $1 and item_id = 'p4'`, [A]);
  fakeNow += 25 * 60 * 60 * 1000;
  const checked = await a2.sync();
  assert.equal(checked.status, 'synced');
  assert.ok(titles(a2).includes('Beta v3'), 'manifest diff fetched the missed row');
  const [restored] = await asUser(A, `select payload from public.sync_items where item_id = 'p4'`);
  assert.equal(restored.payload.entry.title, 'Offline idea', 're-uploaded from the device');
});

test('quota, rate-limit and kill-switch errors surface as statuses and keep local data', async () => {
  await db.exec('reset role');
  await db.query(`update sync.settings set value = 'off' where key = 'enabled'`);
  write(a1, 'pl2-library', [...read(a1, 'pl2-library'), entry('p9', 'While paused')]);
  const paused = await a1.sync();
  assert.equal(paused.status, 'paused');
  assert.ok(titles(a1).includes('While paused'));
  await db.query(`update sync.settings set value = 'on' where key = 'enabled'`);
  await db.query(`update sync.settings set value = '1' where key = 'max_live_items_per_user'`);
  fakeNow += 10 * 60 * 1000;
  const quota = await a1.sync();
  assert.equal(quota.status, 'quota');
  assert.ok(quota.pending >= 1);
  await db.query(`update sync.settings set value = '5000' where key = 'max_live_items_per_user'`);
  fakeNow += 10 * 60 * 1000;
  assert.equal((await a1.sync()).status, 'synced');
});

test('a prompt over the 256 KiB item cap stays local and does not block other changes', async () => {
  fakeNow += 10 * 60 * 1000;
  write(a1, 'pl2-library', [...read(a1, 'pl2-library'), entry('huge', 'Huge history', undefined, { notes: 'n'.repeat(300000) }), entry('small', 'Small one')]);
  const result = await a1.sync();
  assert.equal(result.status, 'synced');
  assert.equal(result.tooLarge, 1);
  const ids = (await asUser(A, `select item_id from public.sync_items where item_id in ('huge', 'small')`)).map((row) => row.item_id);
  assert.deepEqual(ids, ['small']);
  assert.ok(titles(a1).includes('Huge history'), 'still on this device');
});
