import test from 'node:test';
import assert from 'node:assert/strict';
import { request as rawRequest } from 'node:http';
import { createMemoryAdapter } from './contract.mjs';
import { createLocalApi } from './local-api.mjs';
const token = 'a'.repeat(48), readToken = 'b'.repeat(48);
async function fixture(t, options = {}) {
  const api = createLocalApi({ adapter: createMemoryAdapter(), libraryId: 'lib1', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }, { token: readToken, scopes: ['read'], expiresAt: Date.now() + 60_000 }], ...options });
  const base = await api.listen(); t.after(() => api.close());
  const request = (path, opts = {}) => fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
  return { api, base, request };
}
test('rejects absent auth, read-only writes, hostile origins and rebinding hosts', async t => {
  const { base, request } = await fixture(t);
  assert.equal((await fetch(base + '/v1/library')).status, 401);
  assert.equal((await request('/v1/library', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
  // fetch rewrites Host; send a real hostile Host header over HTTP instead.
  const hostStatus = await new Promise((resolve, reject) => {
    const req = rawRequest(base + '/v1/library', { headers: { Host: 'evil.invalid', Authorization: `Bearer ${token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  assert.equal((await request('/v1/library/previews', { method: 'POST', headers: { Authorization: `Bearer ${readToken}` } })).status, 403);
});
test('preview/apply/readback uses one bound library and safely replays response loss', async t => {
  const { request } = await fixture(t);
  const previewResponse = await request('/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: 'lib1', expectedRevision: null, sourceText: JSON.stringify({ library: [{ id: 'p1' }] }) }) });
  assert.equal(previewResponse.status, 201);
  const preview = await previewResponse.json();
  const opts = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'api-op1' }, body: JSON.stringify(preview) };
  const receiptResponse = await request('/v1/library/commits', opts);
  assert.equal(receiptResponse.status, 201);
  const receipt = await receiptResponse.json();
  assert.deepEqual(await (await request('/v1/library/commits', opts)).json(), receipt);
  assert.deepEqual(await (await request('/v1/library/operations/api-op1')).json(), receipt);
  const current = await (await request('/v1/library')).json();
  assert.equal(current.libraryId, 'lib1'); assert.equal(current.revision, receipt.revision);
  assert.equal((await request('/v1/library/snapshot')).status, 409);
  const snapshot = await (await request(`/v1/library/snapshot?revision=${encodeURIComponent(receipt.revision)}&limit=1`)).json();
  assert.equal(snapshot.objects.length, 1); assert.equal(snapshot.nextCursor, '1');
});
test('expires and revokes credentials without deleting stored data', async t => {
  const credentials = [{ token, scopes: ['read'], expiresAt: Date.now() - 1 }];
  const { request } = await fixture(t, { credentials });
  assert.equal((await request('/v1/library')).status, 401);
  credentials[0].expiresAt = Date.now() + 60_000;
  assert.equal((await request('/v1/library')).status, 200);
  credentials[0].revoked = true;
  assert.equal((await request('/v1/library')).status, 401);
});

test('malformed JSON bodies fail without publication and request limits are explicit', async t => {
  const { request, api } = await fixture(t, { requestsPerMinute: 2 });
  assert.equal((await request('/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
  assert.equal((await request('/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  const limited = await request('/v1/library');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal((await api.service.read()).revision, null);
});

test('HTTP import review commits the retained graph and exposes its state through revision-pinned reads', async t => {
  const { request, api } = await fixture(t);
  const response = await request('/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'import', libraryId: 'lib1', expectedRevision: null, sourceText: JSON.stringify({ library: [{ id: 'p', original: 'preserved' }] }) }) });
  assert.equal(response.status, 201);
  const preview = await response.json();
  assert.equal(preview.importPlan.unresolved, 0);
  assert.equal(preview.commitAvailable, true);
  const readback = await request(`/v1/library/previews/${preview.previewId}`, { headers: { Authorization: `Bearer ${readToken}` } });
  assert.equal(readback.status, 200);
  assert.deepEqual(await readback.json(), preview);
  const commit = await request('/v1/library/commits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'import' }, body: JSON.stringify(preview) });
  assert.equal(commit.status, 201);
  const receipt = await commit.json();
  assert.equal(receipt.operation, 'import');
  assert.equal((await api.service.read()).revision, receipt.revision);
  assert.deepEqual(await (await request('/v1/library/operations/import')).json(), receipt);
  const snapshot = await (await request(`/v1/library/snapshot?revision=${encodeURIComponent(receipt.revision)}`)).json();
  assert.equal(snapshot.stateKind, 'library-state');
  assert.equal(snapshot.stateHash, receipt.stateHash);
  const stateObject = await (await request(`/v1/library/objects/${snapshot.stateHash}`)).json();
  assert.deepEqual(stateObject.data, preview.importPlan.manifest);
  assert.equal((await request(`/v1/library/previews/${preview.previewId}`)).status, 409);
});

test('HTTP backup inventory pages verified checkpoints with read scope and rejects stale cursors', async t => {
  const { api, request } = await fixture(t);
  const revisions = [];
  for (let i = 0; i < 3; i++) {
    const preview = await api.service.preview({ libraryId: 'lib1', expectedRevision: revisions.at(-1) ?? null, sourceText: JSON.stringify({ library: [{ id: 'p', original: `revision${i}` }] }) });
    revisions.push((await api.service.apply({ ...preview, idempotencyKey: `op${i}` })).revision);
  }
  const path = `/v1/library/backups?revision=${encodeURIComponent(revisions[2])}&limit=1`;
  const response = await request(path, { headers: { Authorization: `Bearer ${readToken}` } });
  assert.equal(response.status, 200);
  const first = await response.json();
  assert.equal(first.items.length, 1); assert.equal(first.nextCursor, '1');
  assert.equal(first.items[0].checkpointId, revisions[0]);
  assert.equal(first.items[0].name, 'Before op1');
  assert.equal(first.items[0].independentBackup, false);
  const second = await (await request(path + '&cursor=1')).json();
  assert.equal(second.items[0].checkpointId, revisions[1]); assert.equal(second.nextCursor, null);
  assert.equal((await request('/v1/library/backups')).status, 409);
  assert.equal((await request(path + '&cursor=-1')).status, 400);
  assert.equal((await request(path.replace('limit=1', 'limit=101'))).status, 400);
  const newer = await api.service.preview({ libraryId: 'lib1', expectedRevision: revisions[2], sourceText: '{"library":[]}' });
  await api.service.apply({ ...newer, idempotencyKey: 'newer' });
  assert.equal((await request(path + '&cursor=1')).status, 409);
  assert.equal((await request('/v1/library/restores', { method: 'POST' })).status, 400);
});
