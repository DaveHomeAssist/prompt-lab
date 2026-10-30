// Runs the real migration in local Postgres (PGlite, WASM) and checks RLS,
// the push protocol and account erasure. No network, no remote project.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { asRole, createDb } from './helpers.mjs';

let db;
let as;

const A = 'user_Atest';
const B = 'user_Btest';

const push = (sub, device, changes) => as(sub, async () =>
  (await db.query('select public.sync_push($1, $2::jsonb) as r', [device, JSON.stringify(changes)])).rows[0].r);
// Clients hold no table privileges (R-01b), so the test inspects rows as the
// local superuser, scoped to one user. Client reads go through the RPCs.
const rows = async (sub, table = 'sync_items') =>
  (await db.query(`select * from public.${table} where user_id = $1 order by ${table === 'sync_items' ? 'change_seq' : 'id'}`, [sub])).rows;

before(async () => {
  db = await createDb();
  as = asRole(db);
});

test('a signed-in user creates items owned by their Clerk id', async () => {
  const result = await push(A, 'dev-a1', [
    { kind: 'prompt', item_id: 'p1', base_version: 0, lamport: 1, payload: { state: 'active', entry: { id: 'p1', title: 'A one' } } },
    { kind: 'prompt', item_id: 'p2', base_version: 0, lamport: 2, payload: { state: 'active', entry: { id: 'p2', title: 'A two' } } },
  ]);
  assert.deepEqual(result.map((r) => r.status), ['applied', 'applied']);
  const mine = await rows(A);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((row) => row.user_id === A));
});

test('RLS: user B cannot read, change or delete user A rows', async () => {
  await push(B, 'dev-b1', [{ kind: 'prompt', item_id: 'p1', base_version: 0, lamport: 1, payload: { state: 'active', entry: { id: 'p1', title: 'B one' } } }]);
  const seenByB = await rows(B);
  assert.deepEqual(seenByB.map((row) => [row.user_id, row.payload.entry.title]), [[B, 'B one']]);

  // Clients have no write grants at all; writes go through sync_push only.
  await assert.rejects(as(B, () => db.query(`update public.sync_items set payload = '{"x":1}' where user_id = $1`, [A])), /permission denied/);
  await assert.rejects(as(B, () => db.query('delete from public.sync_items where user_id = $1', [A])), /permission denied/);
  await assert.rejects(
    as(B, () => db.query(`insert into public.sync_items (user_id, kind, item_id, payload, device_id) values ($1, 'prompt', 'evil', '{}', 'x')`, [A])),
    /permission denied/,
  );
  const stillA = await rows(A);
  assert.deepEqual(stillA.map((row) => row.payload.entry.title), ['A one', 'A two']);
});

test('RLS: anonymous callers see nothing and cannot push', async () => {
  await assert.rejects(as(null, () => db.query('select * from public.sync_items')), /permission denied/);
  await assert.rejects(push(null, 'dev', []), /permission denied/);
});

test('RLS: a token without a sub claim is rejected', async () => {
  await assert.rejects(as({ role: 'authenticated', iss: 'https://clerk.promptlab.tools' }, () => db.query(`select public.sync_push('dev', '[]'::jsonb)`)), /not authenticated/);
  await assert.rejects(as({ role: 'authenticated', iss: 'https://clerk.promptlab.tools' }, () => db.query('select * from public.sync_pull(0, 10)')), /not authenticated/);
});

test('RLS: conflict copies are private too', async () => {
  // A edits p1 from two devices that both started at version 1.
  await push(A, 'dev-a1', [{ kind: 'prompt', item_id: 'p1', base_version: 1, lamport: 5, payload: { state: 'active', entry: { id: 'p1', title: 'A one, laptop' } } }]);
  const lost = await push(A, 'dev-a2', [{ kind: 'prompt', item_id: 'p1', base_version: 1, lamport: 3, payload: { state: 'active', entry: { id: 'p1', title: 'A one, phone' } } }]);
  assert.equal(lost[0].status, 'conflict_lost');
  const aConflicts = await rows(A, 'sync_conflicts');
  assert.equal(aConflicts.length, 1);
  assert.equal(aConflicts[0].losing_payload.entry.title, 'A one, phone');
  assert.equal((await rows(B, 'sync_conflicts')).length, 0);
});

test('push: stale writer with a higher clock wins and the overwritten edit is kept', async () => {
  const before = (await rows(A)).find((row) => row.item_id === 'p1');
  const won = await push(A, 'dev-a2', [{ kind: 'prompt', item_id: 'p1', base_version: 1, lamport: 50, payload: { state: 'active', entry: { id: 'p1', title: 'A one, later phone edit' } } }]);
  assert.equal(won[0].status, 'conflict_won');
  const after = (await rows(A)).find((row) => row.item_id === 'p1');
  assert.equal(after.payload.entry.title, 'A one, later phone edit');
  assert.equal(Number(after.version), Number(before.version) + 1);
  assert.ok(Number(after.change_seq) > Number(before.change_seq));
  const kept = (await rows(A, 'sync_conflicts')).at(-1);
  assert.equal(kept.losing_payload.entry.title, 'A one, laptop');
});

test('push: identical content from another device is not a conflict', async () => {
  const current = (await rows(A)).find((row) => row.item_id === 'p2');
  const result = await push(A, 'dev-a9', [{ kind: 'prompt', item_id: 'p2', base_version: 0, lamport: 1, payload: current.payload }]);
  assert.equal(result[0].status, 'unchanged');
});

test('push: tombstones and pull-since-cursor ordering', async () => {
  const cursor = Math.max(...(await rows(A)).map((row) => Number(row.change_seq)));
  const p2 = (await rows(A)).find((row) => row.item_id === 'p2');
  await push(A, 'dev-a1', [{ kind: 'prompt', item_id: 'p2', base_version: Number(p2.version), lamport: 60, deleted: true }]);
  const changed = (await as(A, async () => (await db.query('select item_id, deleted, payload from public.sync_pull($1, 500)', [cursor])).rows));
  assert.deepEqual(changed, [{ item_id: 'p2', deleted: true, payload: null }]);
});

test('push: input limits are enforced', async () => {
  await assert.rejects(push(A, '', []), /invalid device id/);
  await assert.rejects(push(A, 'dev', Array.from({ length: 201 }, (_, i) => ({ kind: 'prompt', item_id: `x${i}`, payload: {} }))), /at most 200/);
  await assert.rejects(push(A, 'dev', [{ kind: 'notes', item_id: 'n1', payload: {} }]), /check constraint/);
  const huge = 'x'.repeat(270000);
  await assert.rejects(push(A, 'dev', [{ kind: 'prompt', item_id: 'big', payload: { text: huge } }]), /payload_size/);
});

test('delete my data erases only the caller rows', async () => {
  const result = await as(A, async () => (await db.query('select public.sync_delete_my_data() as r')).rows[0].r);
  assert.ok(result.items >= 2);
  assert.equal((await rows(A)).length, 0);
  assert.equal((await rows(A, 'sync_conflicts')).length, 0);
  assert.equal((await rows(B)).length, 1);
});

test('pull RPC returns only the caller rows after the cursor, in change order', async () => {
  await push(B, 'dev-b1', [{ kind: 'structure', item_id: 'main', base_version: 0, lamport: 9, payload: { collections: ['Ops'], folders: [], loadedPacks: [] } }]);
  const all = await as(B, async () => (await db.query('select * from public.sync_pull(0, 500)')).rows);
  assert.deepEqual(all.map((row) => row.item_id), ['p1', 'main']);
  const after = await as(B, async () => (await db.query('select * from public.sync_pull($1, 500)', [all[0].change_seq])).rows);
  assert.deepEqual(after.map((row) => row.item_id), ['main']);
  assert.equal((await as(A, async () => (await db.query('select * from public.sync_pull(0, 500)')).rows)).length, 0);
  await assert.rejects(as(null, () => db.query('select * from public.sync_pull(0, 10)')), /permission denied/);
});
