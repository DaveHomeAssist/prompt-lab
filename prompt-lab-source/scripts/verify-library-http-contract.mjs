// Synthetic inputs only. Captures omit authorization headers and stay on the runner.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryAdapter, MAX_BYTES } from '../library-storage/contract.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';
import { captureSourceInventory } from '../library-storage/source-inventory.mjs';
import { createLocalApi } from '../library-storage/local-api.mjs';

const output = process.argv[2];
if (!output) throw new Error('Provide a new output path for synthetic HTTP contract captures.');
const directory = await mkdtemp(join(tmpdir(), 'promptlab-http-contract-'));
const libraryId = 'synthetic-http-contract', token = 'synthetic-local-contract-token'.repeat(2), captures = [];
const credentials = [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 600_000 }];
let api, base;
async function start(adapter, options = {}) {
  adapter ??= await createFolderAdapter(join(directory, 'library'));
  api = createLocalApi({ adapter, libraryId, credentials, requestsPerMinute: 1000, ...options }); base = await api.listen();
}
async function request(path, status, { method = 'GET', body, headers = {}, rawBody } = {}) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined || rawBody !== undefined ? { body: rawBody ?? JSON.stringify(body) } : {}) });
  const value = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  captures.push({ path: path.split('?')[0], method, status, ...(body !== undefined ? { requestBody: body } : {}), body: value,
    headers: Object.fromEntries(['content-type', 'etag', 'retry-after'].flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)]] : [])) });
  return value;
}
const post = (path, body, status = 201, headers) => request(path, status, { method: 'POST', body, headers });
const commit = (preview, key) => {
  const { previewId, libraryId, expectedRevision, fingerprint } = preview;
  return post('/v1/library/commits', { previewId, libraryId, expectedRevision, fingerprint }, 201, { 'Idempotency-Key': key });
};
const content = {
  library: [{ id: 'prompt', original: 'Original text', variants: [{ id: 'one', content: 'Variant one' }, { id: 'two', content: 'Variant two' }], uses: 7, source: { future: true }, folderId: 'folder',
    versions: Array.from({ length: 41 }, (_, i) => ({ id: `version-${i}`, original: `Prior ${i}`, future: { retained: true } })) }],
  trash: [{ id: 'trash', original: 'Kept in Trash' }], collections: ['Work'], folders: [{ id: 'folder', name: 'Work' }],
  packs: { pack: { provenance: 'synthetic', future: true } }, assets: { image: { base64: 'AAH/', mime: 'application/octet-stream' } },
  runs: [{ id: 'run', promptId: 'prompt', promptVersionId: 'version-0' }], testCases: [{ id: 'case', promptId: 'prompt', input: 'input' }],
  evaluations: [{ id: 'evaluation', runId: 'run' }], scratch: { pads: [{ id: 'note', content: 'Scratch', linkedPromptId: 'missing-prompt' }] },
  markers: { deleted: ['deleted'], generation: '0' }, future: { preserved: [null, false, 0] }, backups: [{ state: 'unavailable', name: 'external' }],
};
async function inputFor(workspace, expectedRevision) {
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': JSON.stringify(workspace.trash) };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'synthetic-origin',
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic source fixture.' }), archives: { reviewed: true, records: [] } });
  return { libraryId, expectedRevision, mode: 'import', sourceText: JSON.stringify(workspace), sourceInventory };
}

try {
  await start();
  await request('/v1/library', 200);
  await request('/v1/library', 401, { headers: { Authorization: '' } });
  await request('/v1/library', 403, { headers: { Origin: 'https://unpaired.invalid' } });
  await request('/v1/library/previews', 400, { method: 'POST', rawBody: '{' });
  await post('/v1/library/previews', { libraryId, expectedRevision: null, sourceText: '{"library":[],"settings":{}}' }, 422);
  const firstPreview = await post('/v1/library/previews', await inputFor(content, null));
  assert.equal(firstPreview.commitAvailable, true);
  await request('/v1/library/previews/' + firstPreview.previewId, 200);
  const first = await commit(firstPreview, 'first');
  assert.deepEqual(await commit(firstPreview, 'first'), first);
  await request('/v1/library/operations/first', 200);
  await request('/v1/library/operations/missing', 404);
  await request('/v1/library/objects/' + 'sha256:' + '0'.repeat(64), 404);
  const revision = encodeURIComponent(first.revision);
  const ids = []; let cursor = '0';
  do {
    const page = await request(`/v1/library/snapshot?revision=${revision}&limit=3&cursor=${cursor}`, 200);
    ids.push(...page.objects); cursor = page.nextCursor;
  } while (cursor !== null);
  for (const id of ids) await request('/v1/library/objects/' + id, 200);
  const state = await api.service.read(); assert.deepEqual(ids.sort(), Object.keys(state.objects).sort());
  await request(`/v1/library/records?revision=${revision}&limit=2`, 200);
  await request(`/v1/library/current-records?revision=${revision}&limit=2`, 409);
  await request('/v1/library/transfer?revision=' + revision, 200);
  const selection = await post('/v1/library/current-views', { libraryId, expectedRevision: first.revision, resolutions: {} });
  assert.equal(selection.commitAvailable, true, JSON.stringify(selection.currentViewPlan.blocked));
  const selected = await commit(selection, 'select');
  await request(`/v1/library/current-records?revision=${encodeURIComponent(selected.revision)}&limit=2`, 200);
  const secondContent = structuredClone(content); secondContent.library[0].original = 'Changed text';
  const secondInput = await inputFor(secondContent, selected.revision);
  const unresolved = await post('/v1/library/previews', secondInput);
  const resolutions = Object.fromEntries(unresolved.importPlan.rows.filter(row => !row.choice).map(row => [row.member, { action: 'replace', target: row.matches[0] }]));
  const secondPreview = await post('/v1/library/previews', { ...secondInput, resolutions });
  const second = await commit(secondPreview, 'second');
  await request('/v1/library/previews/' + firstPreview.previewId, 409);
  await request('/v1/library/snapshot?revision=' + revision, 409);
  await request('/v1/library/backups?revision=' + encodeURIComponent(second.revision) + '&limit=1', 200);
  const restore = await post('/v1/library/restores', { libraryId, expectedRevision: second.revision, checkpointId: first.revision });
  const restored = await commit(restore, 'restore');
  await api.close(); api = null;
  await start();
  assert.deepEqual(await commit(restore, 'restore'), restored);
  assert.equal((await request('/v1/library', 200)).revision, restored.revision);
  assert.equal((await request('/v1/library/operations/restore', 200)).revision, restored.revision);
  assert.equal(Object.keys((await api.service.read()).operations).length, 4);
  await post('/v1/library/commits', restore, 422);
  const oversized = JSON.stringify({ libraryId, expectedRevision: restored.revision, sourceText: 'x'.repeat(MAX_BYTES) });
  await request('/v1/library/previews', 413, { method: 'POST', rawBody: oversized });
  await api.close(); api = null;
  await start(createMemoryAdapter(), { requestsPerMinute: 1 });
  await request('/v1/library', 200); await request('/v1/library', 429);
  await api.close(); api = null;
  await start({ read: async () => { throw new Error('Synthetic private storage detail'); } });
  const unavailable = await request('/v1/library', 503);
  assert.ok(!JSON.stringify(unavailable).includes('private storage detail'));
  const spec = JSON.parse(await readFile(new URL('../library-storage/openapi-v1.json', import.meta.url), 'utf8'));
  const report = { checkedAt: new Date().toISOString(), node: process.version, directory, syntheticOnly: true, captures, definitions: Object.keys(spec.components.schemas).length };
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ captures: captures.length, statuses: [...new Set(captures.map(row => row.status))], output, restartReplay: true, completeObjectPagination: true }));
} finally { if (api) await api.close(); }
