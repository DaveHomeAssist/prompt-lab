import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDomainMap, pageDomainMap } from './domain-map.mjs';
import { createPackage, createMemoryAdapter, createCommandService, canonical, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createLocalApi } from './local-api.mjs';

async function fixture({ traceCount = 3, sourceIdentity = 'origin-a', surface = 'desktop', alterEntries = () => {}, indexedOverride, parents = [], clientBuffers } = {}) {
  const workspace = {
    schemaVersion: 2, future: { unknown: [false, null, 'kept'] },
    library: [{ id: 'p1', title: 'Original', original: '$& {{input}}', currentVersionId: 'current', collection: 'Work', folderId: 'f1',
      metadata: { packId: 'pack1', source: 'user', usage: { count: 8 }, future: true,
        followUpOrigin: { sourcePromptId: 'p1', sourcePromptVersionId: 'v40', sourceRunId: 'e1', sourceCandidateId: 'candidate' } },
      variants: [{ id: 'variant', content: 'variant', future: 9 }], testCases: [{ id: 'embedded-case', input: 'legacy case', future: 1 }],
      resultMeta: { runId: 'e1' }, goldenResponse: { pinnedFromRunId: 'e1', text: 'golden' },
      artwork: { image: 'data:image/png;base64,AA==' },
      versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `version ${i}`, future: i })) }],
    trash: [{ id: 'p2', versions: [{ id: 'v40', original: 'Different prompt history' }], deletedAt: 'original timestamp' }],
    collections: ['Work'], folders: [{ id: 'f1', parentId: 'unavailable-parent', name: 'Work' }],
    packs: { pack1: { id: 'pack1', future: 'retained' } }, assets: { a1: { bytes: 'AAH/', future: true } },
    scratch: { pads: [{ id: 'pad1', content: 'notes', linkedPrompts: [{ id: 'missing' }], future: true }], activePadId: 'pad1', tombstones: { old: 5 }, future: 7 },
    runs: [{ id: 'e1', promptId: 'p1', promptVersionId: 'v40', testCaseId: 'c1', candidates: [{ id: 'candidate', content: 'candidate text' }], selectedCandidateId: 'candidate' }],
    testCases: [{ id: 'c1', promptId: 'p1', input: 'case', unknown: true }],
    evaluations: [{ id: 'verdict', runId: 'e1', result: { arbitrary: true } }],
    experiments: [{ id: 'experiment', variants: [{ text: 'one' }, { text: 'two' }] }],
    traceRuns: [{ run_id: 'export-trace', prompt_id: 'p1', parent_run_id: 'trace0', fork_of_run_id: 'missing-trace' }],
    markers: { unknown: 'preserved' }, backups: [{ source: 'reviewed backup', available: false }],
  };
  const entries = {
    'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': JSON.stringify(workspace.trash),
    'pl2-collections': JSON.stringify(workspace.collections), 'pl2-collection-folders': JSON.stringify(workspace.folders),
    'pl2-packs': JSON.stringify(workspace.packs), 'pl2-loaded-packs': '["pack1"]',
    'pl2-pads': JSON.stringify(workspace.scratch), 'pl2-pads-schema-version': '4',
    'pl2-pad': 'legacy plain text $&', 'pl2-pad_meta': '1700000000', 'pl-pad': 'older content', 'pl-pad_meta': '1699999999',
    'pl2-experiment-history': JSON.stringify(workspace.experiments), 'pl2-experiment-fallback': '[{"id":"fallback-experiment","future":3}]',
    'pl2-eval-run-fallback': '[{"id":"e1","promptId":"p1","future":"fallback"}]',
    'pl2-test-case-fallback': '[{"id":"c1","promptId":"p1","input":"offline case"}]',
    'pl2-run-fallback': '[{"run_id":"fallback-trace","prompt_id":"missing"}]',
    'pl2-recent-artwork': '[{"image":"data:image/png;base64,BA==","future":8}]',
    'pl2-library-journal-revision': '9', 'pl2-scratch-journal-revision': '12',
    'pl2-library-deleted:p3': '1', 'pl2-library-deleted-batch:b1': '["p4"]', 'pl2-library-clear:0000000000000001:aa': '1',
    'pl2-draft-reset-recovery-v1': '{"buffer":"recovery","future":false}',
    'pl2-session-pl2-session': '{"draft":"unsaved"}', 'pl2-session-pl2-dual-draft': '{"left":"left","right":"right"}',
    'pl2-provider-settings': 'NEVER_READ', '__clerk_client_jwt': 'NEVER_READ',
  };
  alterEntries(entries);
  const indexed = {
    experiments: [{ id: 'indexed-experiment', variants: [{ id: 'raw-variant', raw: true }], unknown: true }],
    eval_runs: [{ id: 'e1', promptId: 'p1', promptVersionId: 'v40', testCaseId: 'c1', future: 'indexed' }],
    test_cases: [{ id: 'c1', promptId: 'p1', input: 'indexed case' }],
    runs: Array.from({ length: traceCount }, (_, i) => ({ run_id: `trace${i}`, prompt_id: 'p1', unknown: i })),
    journal: [{ id: 'library', revision: 9, entries: { 'pl2-library': JSON.stringify([{ ...workspace.library[0], title: 'Journal copy' }]), 'pl2-library-deleted:journal-delete': '1' }, future: 2 },
      { id: 'scratch', revision: 12, entries: { 'pl2-pads': JSON.stringify({ ...workspace.scratch, future: 'journal' }) } }],
  };
  const inventory = await captureSourceInventory({ surface, sourceIdentity, clientBuffers,
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => {
      assert.ok(!['pl2-provider-settings', '__clerk_client_jwt'].includes(key)); return entries[key] ?? null;
    } },
    readIndexedStore: indexedOverride ?? (async ({ store }) => ({ state: 'present', databaseVersion: store === 'journal' ? 1 : 4,
      keyPath: null, autoIncrement: false, records: indexed[store], primaryKeys: indexed[store].map((_, i) => `original-primary-key-${i}`) })),
    readExtensionDrafts: async () => ({ 'pl2-session': { text: 'extension editor' }, 'pl2-dual-draft': { left: 'extension left' } }),
    archives: { reviewed: true, records: [{ path: 'explicit backup', available: false, future: true }] }, capturedAt: '2026-10-29T00:00:00Z',
  });
  const pkg = await createPackage(JSON.stringify(workspace), { libraryId: 'library1', operationId: 'capture', parents,
    createdAt: '2026-10-29T00:00:00Z', sourceInventory: inventory });
  return { pkg, workspace, inventory, entries, indexed };
}

function originalValue(pkg, row) {
  let value = pkg.objects[row.origin.object].data;
  for (const key of row.origin.path) { assert.ok(Object.hasOwn(value, key)); value = value[key]; }
  if (row.origin.decodedPath !== null) {
    value = JSON.parse(value);
    for (const key of row.origin.decodedPath) { assert.ok(Object.hasOwn(value, key)); value = value[key]; }
  }
  return value;
}

test('maps all captured domains and raw values without limits, normalization or fabricated records', async () => {
  const f = await fixture({ traceCount: 1002 }), before = canonical(f.pkg);
  const map = await buildDomainMap(f.pkg);
  for (const domain of ['prompts', 'trash', 'prompt-versions', 'collections', 'folders', 'packs', 'loaded-packs', 'scratch',
    'scratch-notes', 'scratch-tombstones', 'scratch-legacy', 'experiments', 'evaluations', 'test-cases', 'execution-traces',
    'deletion-markers', 'drafts', 'recovery', 'assets', 'backups', 'journal-records', 'source-metadata', 'prompt-variants',
    'experiment-variants', 'embedded-test-cases', 'evaluation-candidates']) assert.ok(map.counts[domain] > 0, domain);
  assert.equal(map.counts['execution-traces'], 1004);
  assert.equal(map.records.filter(row => row.domain === 'prompt-versions' && row.origin.replica === 'workspace').length, 42);
  const indexedTraces = map.records.filter(row => row.domain === 'execution-traces' && row.origin.replica === 'execution-traces');
  assert.deepEqual(new Set(indexedTraces.map(row => row.primaryKey)), new Set(f.indexed.runs.map((_, i) => `original-primary-key-${i}`)));
  assert.equal(map.activationReady, false); assert.equal(map.view, 'preserved');
  assert.equal(map.issues.length, 0);
  assert.equal(new Set(map.records.map(row => row.key)).size, map.records.length);
  for (const row of map.records) assert.deepEqual(row.value, originalValue(f.pkg, row));
  assert.equal(canonical(f.pkg), before);
  assert.equal(JSON.stringify(map).includes('NEVER_READ'), false);
  const pages = []; let cursor = '0';
  do { const page = pageDomainMap(map, { cursor, limit: 37 }); pages.push(...page.items); cursor = page.nextCursor; } while (cursor !== null);
  assert.deepEqual(pages, map.records);
});

test('retains conflicting replicas and reports source-scoped missing and ambiguous references', async () => {
  const { pkg } = await fixture(); const map = await buildDomainMap(pkg);
  const prompt = map.records.find(row => row.domain === 'prompts' && row.origin.replica === 'workspace');
  const copies = map.identities.find(identity => identity.key === prompt.identity);
  assert.equal(copies.candidates.length, 3); assert.equal(copies.divergent, true);
  const run = map.records.find(row => row.domain === 'evaluations' && row.origin.replica === 'evaluations');
  assert.equal(run.references.find(ref => ref.domain === 'prompts').status, 'ambiguous');
  const versions = run.references.find(ref => ref.domain === 'prompt-versions');
  assert.equal(versions.candidates.length, 3);
  assert.ok(versions.candidates.every(key => map.records.find(row => row.key === key).value.original === 'version 40'));
  const folder = map.records.find(row => row.domain === 'folders');
  assert.deepEqual(folder.references[0], { path: ['parentId'], domain: 'folders', sourceId: 'unavailable-parent', candidates: [], status: 'missing' });
  assert.ok(map.records.filter(row => row.domain === 'scratch-notes').every(row => row.references[0].status === 'missing'));
  const current = prompt.references.find(ref => ref.path[0] === 'currentVersionId');
  assert.ok(current.candidates.includes(prompt.key));
  const candidate = prompt.references.find(ref => ref.domain === 'evaluation-candidates');
  assert.equal(candidate.status, 'resolved');
  assert.equal(map.records.find(row => row.key === candidate.candidates[0]).value.content, 'candidate text');
  const trace = map.records.find(row => row.domain === 'execution-traces' && row.sourceId === 'export-trace');
  assert.equal(trace.references.find(ref => ref.path[0] === 'parent_run_id').status, 'resolved');
  assert.equal(trace.references.find(ref => ref.path[0] === 'fork_of_run_id').status, 'missing');
});

test('identical workspace bytes from unrelated origins keep distinct identities and reference targets', async () => {
  const first = await fixture({ sourceIdentity: 'origin-a' });
  const second = await fixture({ sourceIdentity: 'origin-b', parents: [first.pkg.head] });
  second.pkg.objects = { ...first.pkg.objects, ...second.pkg.objects };
  const map = await buildDomainMap(second.pkg);
  const workspaces = map.records.filter(row => row.domain === 'source-stores' && row.origin.replica === 'workspace');
  assert.equal(workspaces.length, 2); assert.equal(workspaces[0].origin.object, workspaces[1].origin.object);
  assert.notEqual(workspaces[0].key, workspaces[1].key);
  for (const row of map.records) for (const ref of row.references) for (const key of ref.candidates) {
    assert.equal(map.records.find(candidate => candidate.key === key).origin.binding, row.origin.binding);
  }
});

test('corrupt, malformed, absent and unavailable stores remain distinguishable and recoverable', async () => {
  const f = await fixture({ alterEntries: entries => {
    entries['pl2-pads'] = '{interrupted'; entries['pl2-test-case-fallback'] = '{}'; entries['pl2-experiment-fallback'] = 'null';
    entries['pl2-loaded-packs'] = null; entries['pl2-recent-artwork'] = 'null';
  }, indexedOverride: async ({ store }) => {
    if (store === 'runs') throw new Error('private error must not appear');
    return { state: 'absent', reason: 'Existing store absent.' };
  } });
  const map = await buildDomainMap(f.pkg);
  assert.ok(map.issues.some(issue => issue.code === 'INVALID_STORE_JSON'));
  assert.ok(map.issues.some(issue => issue.code === 'INVALID_STORE_SHAPE'));
  assert.ok(map.issues.some(issue => issue.code === 'SOURCE_NOT_COMPLETE'));
  assert.ok(map.stores.some(store => store.domain === 'loaded-packs' && store.state === 'absent'));
  assert.ok(map.records.some(row => row.value === '{interrupted'));
  assert.ok(map.records.some(row => row.domain === 'unmapped' && row.value === null));
  assert.equal(JSON.stringify(map).includes('private error'), false);
  for (const row of map.records) assert.deepEqual(row.value, originalValue(f.pkg, row));
});

test('prototype keys and duplicate IDs remain addressable without overwriting or invented identities', async () => {
  const f = await fixture({ alterEntries: entries => {
    entries['pl2-packs'] = '{"__proto__":{"future":true},"constructor":{"id":"constructor"}}';
    entries['pl2-test-case-fallback'] = '[{"id":"same","promptId":false},{"id":"same"},{"id":7},{"input":"no ID"}]';
  } });
  const map = await buildDomainMap(f.pkg);
  assert.ok(map.records.some(row => row.domain === 'packs' && row.sourceId === '__proto__' && row.value.future));
  const duplicate = map.records.filter(row => row.domain === 'test-cases' && row.sourceId === 'same');
  assert.equal(duplicate.length, 2); assert.notEqual(duplicate[0].key, duplicate[1].key);
  assert.equal(map.identities.find(identity => identity.key === duplicate[0].identity).candidates.length, 2);
  assert.ok(map.records.some(row => row.domain === 'test-cases' && row.sourceId === null && row.identity === null));
  assert.ok(map.issues.some(issue => issue.code === 'INVALID_RECORD_ID'));
  assert.equal(duplicate.find(row => row.references.length).references[0].status, 'invalid');
});

test('extension draft values and missing archive bytes are retained without invention', async () => {
  const { pkg } = await fixture({ surface: 'extension' }); const map = await buildDomainMap(pkg);
  assert.equal(map.counts['journal-records'], undefined);
  assert.equal(map.records.filter(row => row.domain === 'drafts' && row.origin.replica === 'extension-drafts').length, 2);
  assert.ok(map.records.some(row => row.domain === 'backups' && row.value.available === false));
});

test('unbound legacy archives are readable and retain every earlier workspace', async () => {
  const a = await createPackage('{"library":[{"id":"p1","original":"old"}],"future":9}', { libraryId: 'l', operationId: 'a' });
  const b = await createPackage('{"library":[{"id":"p1","original":"new"}]}', { libraryId: 'l', operationId: 'b', parents: [a.head] });
  b.objects = { ...a.objects, ...b.objects };
  const map = await buildDomainMap(b);
  assert.equal(map.counts.prompts, 2); assert.equal(map.issues.filter(issue => issue.code === 'UNBOUND_WORKSPACE').length, 2);
  assert.ok(map.records.every(row => row.origin.sourceIdentity === null));
});

test('tampered retained captures fail integrity verification before domain reads', async () => {
  const { pkg } = await fixture();
  const capture = Object.values(pkg.objects).find(row => row.kind === 'source-capture' && row.data.id === 'execution-traces');
  capture.data.records = [];
  await assert.rejects(buildDomainMap(pkg), { code: 'HASH_MISMATCH' });
});

async function serviceFixture() {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const preview = await service.preview({ libraryId: 'l', expectedRevision: null, sourceText: '{"library":[{"id":"p","original":"saved"}],"scratch":{"pads":[{"id":"n","content":"notes"}]}}' });
  const receipt = await service.apply({ ...preview, idempotencyKey: 'first' });
  return { adapter, service, revision: receipt.revision };
}

test('shared record reads pin revision, filter and paginate, and cannot mutate the archive', async () => {
  const { adapter, service, revision } = await serviceFixture();
  const input = { libraryId: 'l', expectedRevision: revision, domain: 'prompts', limit: 1 };
  const before = adapter.read(), page = await service.records(input);
  assert.equal(page.total, 1); assert.equal(page.items[0].value.original, 'saved'); assert.equal(page.nextCursor, null);
  page.items[0].value.original = 'mutated response';
  assert.deepEqual(adapter.read(), before);
  for (const patch of [{ cursor: '01' }, { cursor: '-1' }, { cursor: '9007199254740992' }, { limit: 0 }, { limit: 101 }, { domain: '' }, { currentOnly: true }]) {
    await assert.rejects(service.records({ ...input, ...patch }), { code: 'INVALID_REQUEST' });
  }
  await assert.rejects(service.records({ ...input, libraryId: 'other' }), { code: 'WRONG_LIBRARY' });
  await assert.rejects(service.records({ ...input, expectedRevision: null }), { code: 'REVISION_CONFLICT' });
  const reconstructed = createCommandService(createMemoryAdapter(before));
  assert.deepEqual(await reconstructed.records(input), await service.records(input));
  const map = await buildDomainMap({ format: FORMAT, schemaVersion: VERSION, libraryId: 'l', head: revision, objects: before.objects });
  assert.deepEqual(await service.records(input), pageDomainMap(map, input));
});

test('record preparation rechecks the live revision after async object verification', async () => {
  const { adapter, revision } = await serviceFixture(); let reads = 0;
  const service = createCommandService({ read: () => {
    const state = adapter.read(); if (++reads > 1) state.revision = 'sha256:' + '0'.repeat(64); return state;
  } });
  await assert.rejects(service.records({ libraryId: 'l', expectedRevision: revision }), { code: 'REVISION_CONFLICT' });
});

test('restored selections do not hide retained records or silently make the preserved view active', async () => {
  const f = await fixture(), service = createCommandService(createMemoryAdapter());
  const publish = async (revision, key) => {
    const preview = await service.preview({ libraryId: 'l', expectedRevision: revision,
      sourceText: JSON.stringify(f.workspace), sourceInventory: f.inventory });
    return service.apply({ ...preview, idempotencyKey: key });
  };
  const first = await publish(null, 'first'), second = await publish(first.revision, 'second');
  const preview = await service.previewRestore({ libraryId: 'l', expectedRevision: second.revision, checkpointId: first.revision });
  assert.equal(preview.commitAvailable, true);
  const restored = await service.apply({ ...preview, idempotencyKey: 'restore' });
  const page = await service.records({ libraryId: 'l', expectedRevision: restored.revision, domain: 'prompts' });
  assert.equal(page.total, 3); assert.equal(page.view, 'preserved'); assert.equal(page.activationReady, false);
  assert.ok(preview.restorePlan.manifest.groups.every(group => group.selected === null));
  const state = await service.read();
  assert.deepEqual(await createCommandService(createMemoryAdapter(state)).records({ libraryId: 'l', expectedRevision: restored.revision, domain: 'prompts' }), page);
});

test('read-scoped HTTP record route matches the shared service and rejects invalid queries and unauthorized reads', async t => {
  const { adapter, revision } = await serviceFixture();
  const token = 'r'.repeat(40), writeToken = 'w'.repeat(40);
  const api = createLocalApi({ adapter, libraryId: 'l', credentials: [
    { token, scopes: ['read'], expiresAt: Date.now() + 60_000 }, { token: writeToken, scopes: ['write'], expiresAt: Date.now() + 60_000 },
  ] });
  const base = await api.listen(); t.after(() => api.close());
  const path = `/v1/library/records?revision=${encodeURIComponent(revision)}&domain=scratch-notes&limit=1`;
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), await api.service.records({ libraryId: 'l', expectedRevision: revision, domain: 'scratch-notes', limit: 1 }));
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await fetch(base + path, { headers: { Authorization: `Bearer ${writeToken}` } })).status, 403);
  for (const query of ['&limit=2', '&unknown=true', '&cursor=01']) assert.equal((await fetch(base + path + query, { headers: { Authorization: `Bearer ${token}` } })).status, 400);
  assert.equal((await fetch(base + '/v1/library/records', { headers: { Authorization: `Bearer ${token}` } })).status, 409);
});


test('coordinated client buffers remain separate addressable drafts through package reads', async () => {
  const clientBuffers = [
    { clientId: 'window-a', buffers: [{ id: 'editor', value: { raw: 'First', future: ['$&', '{{input}}'] } }] },
    { clientId: 'window-b', buffers: [{ id: 'editor', value: { raw: 'Second' } }] },
  ];
  const { pkg } = await fixture({ clientBuffers });
  const before = canonical(pkg), map = await buildDomainMap(pkg);
  const rows = map.records.filter(row => row.domain === 'drafts' && row.origin.replica === 'client-buffers');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => originalValue(pkg, row)).sort((a, b) => a.raw.localeCompare(b.raw)), clientBuffers.map(client => client.buffers[0].value));
  assert.equal(canonical(pkg), before);
});
