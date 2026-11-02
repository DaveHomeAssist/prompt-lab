// Drives the real client sync engine (prompt-lab-extension/src/lib/sync)
// against the real migration in local Postgres (PGlite). Each "device" is its
// own in-memory localStorage; each user is a Clerk-style `sub` claim.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, jsonbTextBytes } from '../../prompt-lab-extension/src/lib/sync/syncEngine.js';
import { markLibraryDeleted } from '../../prompt-lab-extension/src/lib/libraryDeletion.js';
import { readLocalSnapshot, restoreLocalSnapshot } from '../../prompt-lab-extension/src/lib/sync/syncBackup.js';
import { exportAccountData } from '../../prompt-lab-extension/src/lib/sync/supabaseTransport.js';
import { asRole, createDb, rpcRunner } from './helpers.mjs';

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

let runner;
const asUser = (sub, sql, params) => runner(sub, sql, params);
// Clients cannot select tables (R-01b). Tests inspect a user's rows as the
// definer role, which still sees only that user's rows through RLS.
const inspect = (sub, sql, params) => as(sub, async () => (await db.query(sql, params)).rows, 'sync_owner');

// Same calls supabaseTransport.js makes over HTTP, with PostgREST's status mapping.
function pgTransport(sub) {
  const call = async (sql, params) => {
    if (networkDown) throw Object.assign(new Error('Network unavailable.'), { status: 0 });
    try { return await asUser(sub, sql, params); } catch (error) {
      const status = error.status || (/^PT\d{3}$/.test(error.code || '') ? Number(error.code.slice(2)) : error.code === '28000' ? 401 : 400);
      throw Object.assign(new Error(error.message), { status });
    }
  };
  return {
    pull: (cursor, limit) => call('select * from public.sync_pull($1, $2)', [cursor, limit]),
    push: async (device, changes) => (await call('select public.sync_push($1, $2::jsonb) as r', [device, JSON.stringify(changes)]))[0].r,
    fetchItems: (keys) => call('select * from public.sync_fetch($1::jsonb)', [JSON.stringify(keys)]),
    manifest: () => call('select * from public.sync_manifest()'),
    listConflicts: () => call('select * from public.sync_list_conflicts(100)'),
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

before(async () => {
  db = await createDb(); as = asRole(db); runner = rpcRunner(db, as);
  // Many syncs run within one minute here; the rate limits have their own tests.
  await db.query(`update sync.settings set value = '100000' where key in ('push_per_minute', 'pull_per_minute', 'status_per_minute')`);
});

test('first device uploads its existing Library on first sign-in', async () => {
  write(a1, 'pl2-library', [entry('p1', 'Alpha'), entry('p2', 'Beta')]);
  write(a1, 'pl2-library-trash', [entry('t1', 'Trashed', undefined, { deletedAt: '2026-10-29T13:00:00Z' })]);
  write(a1, 'pl2-collections', ['Work']);
  const result = await a1.sync();
  assert.equal(result.status, 'synced');
  assert.equal(result.pending, 0);
  const server = await inspect(A, 'select kind, item_id from public.sync_items order by kind, item_id');
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
  const copies = await inspect(A, `select losing_payload from public.sync_conflicts where item_id = 'p1'`);
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
  const [row] = await inspect(A, `select deleted, payload from public.sync_items where item_id = 'p3'`);
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
  const seenByB = await inspect(B, 'select item_id from public.sync_items');
  assert.deepEqual(seenByB.map((row) => row.item_id).sort(), ['main', 'p1']);
  const wrongUser = createSyncEngine({ storage: a1.storage, transport: pgTransport(B), userId: B, deviceId: 'a1-laptop', now });
  assert.equal((await wrongUser.syncOnce()).status, 'owner-mismatch');
  const [bRow] = await inspect(B, `select payload from public.sync_items where item_id = 'p1'`);
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
  const [row] = await inspect(A, `select item_id from public.sync_items where item_id = 'copy-of-p2'`);
  assert.equal(row.item_id, 'copy-of-p2');
  const live = await inspect(A, `select count(*)::int as n from public.sync_items where kind = 'prompt' and not deleted`);
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
  const [restored] = await inspect(A, `select payload from public.sync_items where item_id = 'p4'`);
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
  const ids = (await inspect(A, `select item_id from public.sync_items where item_id in ('huge', 'small')`)).map((row) => row.item_id);
  assert.deepEqual(ids, ['small']);
  assert.ok(titles(a1).includes('Huge history'), 'still on this device');
});

test('R-01b: a new device pages through byte-capped pulls and fetches, and export reads conflicts by RPC', async () => {
  fakeNow += 10 * 60 * 1000;
  const C = 'user_Cpaging';
  const c1 = device('c1-laptop', C);
  const big = (id) => entry(id, `Big ${id}`, undefined, { notes: 'b'.repeat(200000) });
  write(c1, 'pl2-library', ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map(big));
  assert.equal((await c1.sync()).status, 'synced');
  // Each read call now stops at ~400 KB, so a full pull needs several pages.
  await db.query(`update sync.settings set value = '450000' where key = 'max_response_bytes'`);
  try {
    const c2 = device('c2-desktop', C);
    assert.equal((await c2.sync()).status, 'synced');
    assert.deepEqual(titles(c2), ['Big k1', 'Big k2', 'Big k3', 'Big k4', 'Big k5', 'Big k6']);
    const exported = await exportAccountData(pgTransport(C));
    assert.equal(exported.items.filter((row) => row.kind === 'prompt').length, 6);
    assert.ok(Array.isArray(exported.conflicts));
  } finally {
    await db.query(`update sync.settings set value = '2097152' where key = 'max_response_bytes'`);
  }
});

// #277 review (Codex) regressions.
function hookedDevice(name, sub, hooks = {}) {
  const storage = new MemoryStorage();
  const transport = () => {
    const base = pgTransport(sub);
    return { ...base, pull: async (cursor, limit) => { const rows = await base.pull(cursor, limit); await hooks.afterPull?.(storage, rows); return rows; } };
  };
  const engine = () => createSyncEngine({ storage, transport: transport(), userId: sub, deviceId: name, now, random: () => 0.5 });
  return { storage, sync: (options) => engine().syncOnce(options), name };
}
const conflictTitles = async (sub) => (await inspect(sub, 'select losing_payload from public.sync_conflicts')).map((row) => row.losing_payload?.entry?.title);
const serverTitle = async (sub, id) => (await inspect(sub, `select payload from public.sync_items where kind = 'prompt' and item_id = $1`, [id]))[0]?.payload?.entry?.title;

test('#277 P1: a save made while a pull is in flight is not overwritten by a newer remote version', async () => {
  const C = 'user_Ce2e';
  let editDuringPull = false;
  const c1 = device('c1', C);
  const c2 = hookedDevice('c2', C, {
    afterPull: (storage, rows) => {
      if (!editDuringPull || !rows.length) return;
      editDuringPull = false;
      const library = JSON.parse(storage.getItem('pl2-library'));
      storage.setItem('pl2-library', JSON.stringify(library.map((item) => (item.id === 'cp1' ? { ...item, title: 'Saved during pull', updatedAt: '2026-10-30T11:00:00Z' } : item))));
    },
  });
  write(c1, 'pl2-library', [entry('cp1', 'Original')]);
  assert.equal((await c1.sync()).status, 'synced');
  assert.equal((await c2.sync()).status, 'synced');
  write(c1, 'pl2-library', [entry('cp1', 'Remote edit', '2026-10-30T10:30:00Z')]);
  assert.equal((await c1.sync()).status, 'synced');
  editDuringPull = true;
  const result = await c2.sync();
  assert.equal(result.status, 'synced');
  // The local save survives: either it is live on the account, or it is kept as a conflict copy.
  const live = await serverTitle(C, 'cp1');
  const kept = await conflictTitles(C);
  assert.ok(live === 'Saved during pull' || kept.includes('Saved during pull'), `local save lost (live=${live}, kept=${kept})`);
  assert.ok(live === 'Remote edit' || kept.includes('Remote edit'), 'remote edit lost');
  assert.ok(result.conflicts >= 1);
});

test('#277 P1: the daily manifest check does not overwrite an unqueued local edit', async () => {
  const D = 'user_De2e';
  const d1 = device('d1', D);
  const d2 = device('d2', D);
  write(d1, 'pl2-library', [entry('dp1', 'Original')]);
  await d1.sync(); await d2.sync();
  write(d1, 'pl2-library', [entry('dp1', 'Remote edit', '2026-10-30T10:30:00Z')]);
  await d1.sync();
  // d2 edits locally, then its next sync starts with the daily manifest check.
  write(d2, 'pl2-library', [entry('dp1', 'Local edit before manifest', '2026-10-30T11:00:00Z')]);
  const saved = fakeNow; fakeNow += 25 * 60 * 60 * 1000;
  try {
    const result = await d2.sync();
    assert.equal(result.status, 'synced');
  } finally { fakeNow = saved; }
  const live = await serverTitle(D, 'dp1');
  const kept = await conflictTitles(D);
  assert.ok(live === 'Local edit before manifest' || kept.includes('Local edit before manifest'), `local edit lost (live=${live}, kept=${kept})`);
});

test('#277 P1: a customized starter prompt is not dropped as a duplicate on first sync', async () => {
  const E = 'user_Ee2e';
  const seed = { metadata: { packId: 'starter', seedPromptId: 'code-review' } };
  const e1 = device('e1', E);
  const e2 = device('e2', E);
  write(e1, 'pl2-library', [entry('ep-a', 'Code review', undefined, { ...seed, original: 'Default text' })]);
  await e1.sync();
  write(e2, 'pl2-library', [entry('ep-b', 'Code review', undefined, { ...seed, original: 'My customized review prompt' })]);
  const result = await e2.sync();
  assert.equal(result.status, 'synced');
  assert.equal(result.dropped, 0);
  const originals = (await inspect(E, `select payload from public.sync_items where kind = 'prompt'`)).map((row) => row.payload.entry.original).sort();
  assert.deepEqual(originals, ['Default text', 'My customized review prompt']);
  // An untouched copy of the same starter prompt is still de-duplicated.
  const e3 = device('e3', E);
  write(e3, 'pl2-library', [entry('ep-c', 'Code review', undefined, { ...seed, original: 'Default text' })]);
  assert.equal((await e3.sync()).dropped, 1);
});

test('#277 P2: prompts that together exceed 2 MiB push in several byte-bounded batches', async () => {
  const F = 'user_Fe2e';
  const f1 = device('f1', F);
  const body = (i) => `${i}:`.padEnd(200 * 1024, 'x');
  write(f1, 'pl2-library', Array.from({ length: 12 }, (_, i) => entry(`fp${i}`, `Big ${i}`, undefined, { original: body(i) })));
  const result = await f1.sync();
  assert.equal(result.status, 'synced', result.error);
  assert.equal(result.pending, 0);
  const [{ n }] = await inspect(F, `select count(*)::int as n from public.sync_items where kind = 'prompt'`);
  assert.equal(n, 12);
});

// Fire Watch re-review 3 regressions.
test('R-11: the device that loses a conflict takes the winner and keeps its edit only as a conflict copy', async () => {
  const G = 'user_Ge2e';
  const g1 = device('g1', G);
  const g2 = device('g2', G);
  const titleOf = (dev) => read(dev, 'pl2-library').find((item) => item.id === 'gp1')?.title;
  write(g1, 'pl2-library', [entry('gp1', 'Original')]);
  await g1.sync(); await g2.sync();
  // g1 edits a few times so its clock is ahead, then g2 edits the same prompt offline.
  for (const n of [1, 2, 3]) { write(g1, 'pl2-library', [entry('gp1', `Laptop edit ${n}`, `2026-10-30T10:0${n}:00Z`)]); await g1.sync(); }
  write(g2, 'pl2-library', [entry('gp1', 'Desktop edit', '2026-10-30T10:05:00Z')]);
  const first = await g2.sync();
  assert.equal(first.conflicts, 1);
  const winner = await serverTitle(G, 'gp1');
  const loser = winner === 'Laptop edit 3' ? 'Desktop edit' : 'Laptop edit 3';
  assert.ok((await conflictTitles(G)).includes(loser), 'the losing edit is a conflict copy');
  // The next syncs on both devices must not re-push the losing edit over the winner.
  await g2.sync(); await g1.sync(); await g2.sync();
  assert.equal(await serverTitle(G, 'gp1'), winner, 'the account still holds the winner');
  assert.equal(titleOf(g1), winner);
  assert.equal(titleOf(g2), winner);
  assert.equal((await conflictTitles(G)).filter((title) => title === loser).length, 1, 'one conflict copy, not a re-push loop');
  assert.equal((await g1.sync()).pending, 0);
  assert.equal((await g2.sync()).pending, 0);
});

// R-16: whichever side loses a later conflict must survive as a live row or a conflict copy.
const survives = async (sub, id, title) => (await serverTitle(sub, id)) === title || (await conflictTitles(sub)).includes(title);

test('R-11/R-16: an edit made while the losing push is in flight is kept, and the winner is not lost', async () => {
  const H = 'user_He2e';
  const h1 = device('h1', H);
  let editAfterPush = false;
  const storage = new MemoryStorage();
  const base = pgTransport(H);
  const transport = { ...base, push: async (deviceId, changes) => {
    const results = await base.push(deviceId, changes);
    if (editAfterPush) { editAfterPush = false; storage.setItem('pl2-library', JSON.stringify([entry('hp1', 'Typed during push', '2026-10-30T10:09:00Z')])); }
    return results;
  } };
  const h2 = { storage, sync: () => createSyncEngine({ storage, transport, userId: H, deviceId: 'h2', now, random: () => 0.5 }).syncOnce() };
  write(h1, 'pl2-library', [entry('hp1', 'Original')]);
  await h1.sync(); await h2.sync();
  for (const n of [1, 2, 3]) { write(h1, 'pl2-library', [entry('hp1', `Laptop ${n}`, `2026-10-30T10:0${n}:00Z`)]); await h1.sync(); }
  write(h2, 'pl2-library', [entry('hp1', 'Desktop edit', '2026-10-30T10:05:00Z')]);
  editAfterPush = true;
  assert.equal((await h2.sync()).conflicts, 1);
  assert.ok((await conflictTitles(H)).includes('Desktop edit'));
  await h2.sync(); await h1.sync(); await h2.sync();
  assert.ok(await survives(H, 'hp1', 'Typed during push'), 'the newer edit is kept');
  assert.ok(await survives(H, 'hp1', 'Laptop 3'), 'the winner is kept (live or as a conflict copy)');
  const live = await serverTitle(H, 'hp1');
  assert.equal(read(h1, 'pl2-library').find((item) => item.id === 'hp1').title, live);
  assert.equal(read(h2, 'pl2-library').find((item) => item.id === 'hp1').title, live);
});

// Fire Watch re-review 4 probes: a device loses a conflict whose winner was
// saved between its pull and its push, so the winner has to be fetched.
function lostPushDevice(sub, id, winnerDevice, hooks = {}) {
  const storage = new MemoryStorage();
  const base = pgTransport(sub);
  const control = { editBeforePush: false, failFetch: false, fetches: 0 };
  const transport = {
    ...base,
    push: async (deviceId, changes) => {
      if (control.editBeforePush) {
        control.editBeforePush = false;
        for (const title of ['Laptop 4', 'Laptop 5', 'WINNER']) {
          write(winnerDevice, 'pl2-library', [entry(id, title, '2026-10-30T10:08:00Z')]);
          assert.equal((await winnerDevice.sync()).status, 'synced');
        }
        control.failFetch = hooks.failFetchOnce || false;
      }
      return base.push(deviceId, changes);
    },
    fetchItems: async (keys) => {
      control.fetches += 1;
      if (control.failFetch) { control.failFetch = false; throw Object.assign(new Error('Network unavailable.'), { status: 0 }); }
      const rows = await base.fetchItems(keys);
      await hooks.afterFetch?.(storage);
      return rows;
    },
  };
  return { storage, control, sync: () => createSyncEngine({ storage, transport, userId: sub, deviceId: `${id}-loser`, now, random: () => 0.5 }).syncOnce() };
}
async function setUpLostPush(sub, id, hooks) {
  const winner = device(`${id}-winner`, sub);
  const loser = lostPushDevice(sub, id, winner, hooks);
  write(winner, 'pl2-library', [entry(id, 'Original')]);
  await winner.sync(); await loser.sync();
  for (const n of [1, 2, 3]) { write(winner, 'pl2-library', [entry(id, `Laptop ${n}`, `2026-10-30T10:0${n}:00Z`)]); await winner.sync(); }
  await loser.sync();
  write(loser, 'pl2-library', [entry(id, 'LOSER', '2026-10-30T10:05:00Z')]);
  loser.control.editBeforePush = true;
  return { winner, loser };
}

test('R-16 probe E1: an edit typed during the winner fetch does not erase the winner', async () => {
  const S = 'user_E1e2e';
  let typeAgain = true;
  const { winner, loser } = await setUpLostPush(S, 'e1', { afterFetch: (storage) => {
    if (!typeAgain) return;
    typeAgain = false;
    storage.setItem('pl2-library', JSON.stringify([entry('e1', 'LOSER typed again', '2026-10-30T10:09:00Z')]));
  } });
  await loser.sync();
  assert.ok((await conflictTitles(S)).includes('LOSER'));
  await loser.sync(); await winner.sync(); await loser.sync();
  assert.ok(await survives(S, 'e1', 'WINNER'), 'the winner survives live or as a conflict copy');
  assert.ok(await survives(S, 'e1', 'LOSER typed again'), 'the newer edit survives too');
  const live = await serverTitle(S, 'e1');
  assert.equal(read(winner, 'pl2-library')[0].title, live);
  assert.equal(JSON.parse(loser.storage.getItem('pl2-library'))[0].title, live);
});

test('R-16 probe E2: a failed winner fetch, then offline edits, does not erase the winner', async () => {
  const S = 'user_E2e2e';
  const { winner, loser } = await setUpLostPush(S, 'e2', { failFetchOnce: true });
  assert.equal((await loser.sync()).status, 'offline');
  networkDown = true;
  try {
    loser.storage.setItem('pl2-library', JSON.stringify([entry('e2', 'LOSER edited offline', '2026-10-30T10:09:00Z')]));
    assert.equal((await loser.sync()).status, 'offline');
  } finally { networkDown = false; }
  fakeNow += 10 * 60 * 1000;
  await loser.sync(); await loser.sync(); await winner.sync(); await loser.sync();
  assert.ok(await survives(S, 'e2', 'WINNER'), 'the winner survives live or as a conflict copy');
  assert.ok(await survives(S, 'e2', 'LOSER edited offline'), 'the offline edit survives too');
  const live = await serverTitle(S, 'e2');
  assert.equal(read(winner, 'pl2-library')[0].title, live);
  assert.equal(JSON.parse(loser.storage.getItem('pl2-library'))[0].title, live);
});

test('R-17: a pending lost record for an erased item is dropped and the prompt uploads again', async () => {
  const S = 'user_E7e2e';
  const { loser } = await setUpLostPush(S, 'e7', { failFetchOnce: true });
  assert.equal((await loser.sync()).status, 'offline');
  const lostKeys = () => Object.keys(JSON.parse(loser.storage.getItem(`pl2-sync-state:${S}`)).lost || {});
  assert.deepEqual(lostKeys(), ['prompt:e7'], 'a pending record exists');
  // "Delete my synced data" from another device.
  await asUser(S, 'select public.sync_delete_my_data() as r');
  fakeNow += 10 * 60 * 1000;
  assert.equal((await loser.sync()).status, 'synced');
  assert.deepEqual(lostKeys(), []);
  assert.equal(await serverTitle(S, 'e7'), 'LOSER', 'the local prompt uploaded again');
  const fetches = loser.control.fetches;
  await loser.sync();
  const saved = fakeNow; fakeNow += 25 * 60 * 60 * 1000;
  try { assert.equal((await loser.sync()).status, 'synced'); } finally { fakeNow = saved; }
  assert.equal(loser.control.fetches, fetches, 'no more fetches for the erased item');
});

test('R-17: the manifest check also drops a pending lost record the account no longer has', async () => {
  const S = 'user_E8e2e';
  const { loser } = await setUpLostPush(S, 'e8', { failFetchOnce: true });
  assert.equal((await loser.sync()).status, 'offline');
  await asUser(S, 'select public.sync_delete_my_data() as r');
  // The manifest check runs first when it is due; it alone should drop the
  // record, so the fetch-first step has nothing left to fetch.
  const fetches = loser.control.fetches;
  const saved = fakeNow; fakeNow += 25 * 60 * 60 * 1000;
  try { assert.equal((await loser.sync()).status, 'synced'); } finally { fakeNow = saved; }
  assert.equal(loser.control.fetches, fetches, 'no fetch for the erased item');
  assert.deepEqual(Object.keys(JSON.parse(loser.storage.getItem(`pl2-sync-state:${S}`)).lost || {}), []);
  assert.equal(await serverTitle(S, 'e8'), 'LOSER');
});

test('R-18: a prompt with U+0000 or a lone surrogate does not block its batch', async () => {
  const S = 'user_R18e2e';
  const d = device('r18', S);
  write(d, 'pl2-library', [entry('bad', 'Nul\u0000here', undefined, { notes: 'lone \ud800 surrogate', tags: ['ok\udc00'] }), entry('fine', 'Fine one')]);
  const first = await d.sync();
  assert.equal(first.status, 'synced', first.error);
  assert.equal(first.pending, 0);
  const rows = await inspect(S, `select item_id, payload from public.sync_items where kind = 'prompt' order by item_id`);
  assert.deepEqual(rows.map((row) => row.item_id), ['bad', 'fine']);
  assert.equal(rows[0].payload.entry.title, 'Nul\uFFFDhere');
  assert.equal(rows[0].payload.entry.notes, 'lone \uFFFD surrogate');
  assert.equal(read(d, 'pl2-library').find((item) => item.id === 'bad').title, 'Nul\u0000here', 'the local copy is unchanged');
  const second = await d.sync();
  assert.equal(second.pushed, 0, 'no re-push loop');
  assert.equal(second.pending, 0);
});

test('re-review 4 Low: numbers are measured the way jsonb::text prints them', async () => {
  const values = [{ a: 1e21 }, { b: 1e-7 }, { c: -2.5e-10 }, { d: 1.5e300 }, { e: 123.456 }, { f: 0 }, { g: -7 }, { h: [1e21, 5e-324, 2 ** 53] }, { i: 1.25e22 }];
  for (const value of values) {
    const [{ n }] = (await db.query('select octet_length($1::jsonb::text)::int as n', [JSON.stringify(value)])).rows;
    assert.equal(jsonbTextBytes(value), n, JSON.stringify(value));
  }
});

test('R-12: batches are sized the way the server counts jsonb (spaces after : and ,)', async () => {
  const K = 'user_Ke2e';
  const k1 = device('k1', K);
  // Member-heavy prompts: about 1.9 MiB as JSON.stringify, about 2.3 MiB as jsonb::text.
  const fields = (i) => Object.fromEntries(Array.from({ length: 17000 }, (_, j) => [`f${j}`, i]));
  write(k1, 'pl2-library', Array.from({ length: 10 }, (_, i) => entry(`kp${i}`, `Wide ${i}`, undefined, { metadata: fields(i) })));
  const result = await k1.sync();
  assert.equal(result.status, 'synced', result.error);
  assert.equal(result.pending, 0);
  const [{ n }] = await inspect(K, `select count(*)::int as n from public.sync_items where kind = 'prompt'`);
  assert.equal(n, 10);
});

test('R-12: a single item under the cap as JSON.stringify but over it as jsonb stays local and does not block the rest', async () => {
  const L = 'user_Le2e';
  const l1 = device('l1', L);
  const wide = Object.fromEntries(Array.from({ length: 21000 }, (_, j) => [`f${j}`, 1]));
  assert.ok(JSON.stringify(wide).length < 255 * 1024, 'under the old client check');
  write(l1, 'pl2-library', [entry('lp-wide', 'Wide', undefined, { metadata: wide }), entry('lp-small', 'Small')]);
  const result = await l1.sync();
  assert.equal(result.status, 'synced', result.error);
  assert.equal(result.tooLarge, 1);
  const ids = (await inspect(L, `select item_id from public.sync_items where kind = 'prompt'`)).map((row) => row.item_id);
  assert.deepEqual(ids, ['lp-small']);
});

test('R-12: a 413 "request too large" splits the batch and retries instead of reporting quota', async () => {
  const M = 'user_Me2e';
  const m1 = device('m1', M);
  await db.query(`update sync.settings set value = '300000' where key = 'max_request_bytes'`);
  try {
    write(m1, 'pl2-library', Array.from({ length: 4 }, (_, i) => entry(`mp${i}`, `Mid ${i}`, undefined, { original: `${i}`.padEnd(120 * 1024, 'm') })));
    const result = await m1.sync();
    assert.equal(result.status, 'synced', result.error);
    assert.equal(result.pending, 0);
    const [{ n }] = await inspect(M, `select count(*)::int as n from public.sync_items where kind = 'prompt'`);
    assert.equal(n, 4);
  } finally {
    await db.query(`update sync.settings set value = '2097152' where key = 'max_request_bytes'`);
  }
});

test('R-11 / #285 Codex P1: a failed winner fetch after a lost push is retried and the winner still lands', async () => {
  const N = 'user_Ne2e';
  const n1 = device('n1', N);
  const titleOf = (dev) => read(dev, 'pl2-library').find((item) => item.id === 'np1')?.title;
  const storage = new MemoryStorage();
  const base = pgTransport(N);
  let editBeforePush = false; let failFetch = false;
  const transport = {
    ...base,
    // Another device saves between this device's pull and its push, so the
    // winner is not among the pulled rows and has to be fetched.
    push: async (deviceId, changes) => {
      if (editBeforePush) {
        editBeforePush = false;
        // Several saves, so the laptop's clock is ahead and it wins the conflict.
        for (const title of ['Laptop 4', 'Laptop 5', 'Laptop wins']) {
          write(n1, 'pl2-library', [entry('np1', title, '2026-10-30T10:08:00Z')]);
          assert.equal((await n1.sync()).status, 'synced');
        }
        failFetch = true;
      }
      return base.push(deviceId, changes);
    },
    fetchItems: async (keys) => {
      if (failFetch) { failFetch = false; throw Object.assign(new Error('Network unavailable.'), { status: 0 }); }
      return base.fetchItems(keys);
    },
  };
  const n2 = { storage, sync: () => createSyncEngine({ storage, transport, userId: N, deviceId: 'n2', now, random: () => 0.5 }).syncOnce() };
  write(n1, 'pl2-library', [entry('np1', 'Original')]);
  await n1.sync(); await n2.sync();
  for (const n of [1, 2, 3]) { write(n1, 'pl2-library', [entry('np1', `Laptop ${n}`, `2026-10-30T10:0${n}:00Z`)]); await n1.sync(); }
  await n2.sync();
  write(n2, 'pl2-library', [entry('np1', 'Desktop loses', '2026-10-30T10:05:00Z')]);
  editBeforePush = true;
  const failed = await n2.sync();
  assert.equal(failed.status, 'offline', 'the winner fetch failed');
  assert.equal(await serverTitle(N, 'np1'), 'Laptop wins', 'the laptop edit won on the server');
  assert.ok((await conflictTitles(N)).includes('Desktop loses'), 'the losing edit is a conflict copy');
  fakeNow += 60 * 1000;
  const retry = await n2.sync();
  assert.equal(retry.status, 'synced', retry.error);
  assert.equal(titleOf(n2), 'Laptop wins', 'the winner lands after the failed fetch');
  assert.equal(retry.pending, 0);
  assert.equal(await serverTitle(N, 'np1'), 'Laptop wins', 'the loser was not re-pushed');
  // A later manifest check agrees.
  const saved = fakeNow; fakeNow += 25 * 60 * 60 * 1000;
  try { assert.equal((await n2.sync()).status, 'synced'); } finally { fakeNow = saved; }
  assert.equal(titleOf(n2), 'Laptop wins');
});
