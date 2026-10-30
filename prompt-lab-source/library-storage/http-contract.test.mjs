import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryAdapter } from './contract.mjs';
import { createLocalApi } from './local-api.mjs';

const specification = () => readFile(new URL('./openapi-v1.json', import.meta.url), 'utf8').then(JSON.parse);
const resolve = (spec, value) => value.$ref ? value.$ref.slice(2).split('/').reduce((node, key) => node[key], spec) : value;

test('every published operation describes typed success and shared runtime errors', async () => {
  const spec = await specification();
  for (const [path, methods] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(methods)) {
    for (const status of ['400', '401', '403', '409', '413', '422', '429', '503']) {
      assert.ok(operation.responses[status], `${method} ${path} omits ${status}`);
    }
    for (const [status, response] of Object.entries(operation.responses)) {
      const body = resolve(spec, response).content?.['application/json']?.schema;
      assert.ok(body, `${method} ${path} ${status} has no response schema`);
      assert.ok(resolve(spec, body), `${method} ${path} ${status} has a broken schema reference`);
    }
  }
  for (const path of ['/v1/library/objects/{hash}', '/v1/library/operations/{operationId}']) assert.ok(spec.paths[path].get.responses['404']);
  assert.equal(spec.paths['/v1/library/commits'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/CommitRequest');
});

test('minimal reviewed commits, revision ETag and error envelopes agree with the HTTP contract', async t => {
  const adapter = createMemoryAdapter(), token = 'synthetic-contract-only'.repeat(3);
  const api = createLocalApi({ adapter, libraryId: 'contract', credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }], allowedOrigins: ['https://paired.invalid'] });
  const base = await api.listen(); t.after(() => api.close());
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  const initial = await request('/v1/library'); assert.equal(initial.status, 200); assert.equal(initial.headers.get('etag'), null);
  const response = await request('/v1/library/previews', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ libraryId: 'contract', expectedRevision: null, sourceText: '{"library":[]}' }) });
  assert.equal(response.status, 201); const preview = await response.json();
  const { previewId, libraryId, expectedRevision, fingerprint } = preview;
  const saved = await request('/v1/library/commits', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'minimal' }, body: JSON.stringify({ previewId, libraryId, expectedRevision, fingerprint }) });
  assert.equal(saved.status, 201); const receipt = await saved.json();
  const current = await request('/v1/library', { headers: { Origin: 'https://paired.invalid' } });
  assert.equal(current.headers.get('etag'), JSON.stringify(receipt.revision));
  assert.ok(current.headers.get('access-control-expose-headers').split(/,\s*/).includes('ETag'));
  assert.equal((await current.json()).revision, receipt.revision);
  const missing = await request('/v1/library/operations/missing'); assert.equal(missing.status, 404);
  assert.deepEqual(Object.keys(await missing.json()).sort(), ['code', 'error', 'ok', 'retryable']);
  const noKey = await request('/v1/library/commits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preview) });
  assert.equal(noKey.status, 422); assert.equal((await noKey.json()).code, 'INVALID_OPERATION');
});
