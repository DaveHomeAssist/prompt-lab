import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter, inspectPackage, makeObject, canonical, FORMAT, VERSION } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { createLocalApi } from './local-api.mjs';

const pkg = state => ({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
const query = async service => ({ libraryId: 'lib', expectedRevision: (await service.read()).revision });
const fixture = () => ({ library: [{ id: 'p', original: 'Current prompt', currentVersionId: 'current', future: { retained: true },
  versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, original: `History ${n}`, unknown: n })),
  variants: [{ id: 'variant', content: 'Variant', future: false }], testCases: [{ id: 'embedded', input: 'Embedded case' }] }],
  trash: [{ id: 'trash', original: 'Trashed prompt' }], collections: ['Work'], folders: [{ id: 'folder', name: 'Work', parentId: 'missing' }],
  packs: { pack: { id: 'pack', future: 2 } }, loadedPacks: ['pack'], scratch: { pads: [{ id: 'note', content: 'Scratch' }], tombstones: {} },
  runs: [{ id: 'eval', promptId: 'p', promptVersionId: 'v40', output: 'Evaluation', future: 'retained' }],
  testCases: [{ id: 'case', promptId: 'p', input: 'Case' }], experiments: [{ id: 'experiment', variants: [{ id: 'ev', text: 'Original' }] }],
  traceRuns: [{ run_id: 'trace', prompt_id: 'p', output: 'Trace' }], assets: { asset: { bytes: 'data:application/octet-stream;base64,AA==' } },
  backups: [{ name: 'Original archive', available: false }], future: { notDropped: ['unknown'] } });
async function capture(content, { sourceIdentity = 'origin', entries: overrides = {}, indexed = {}, surface = 'web' } = {}) {
  const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []), ...overrides };
  return captureSourceInventory({ surface, sourceIdentity,
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async ({ store }) => indexed[store] === 'unavailable' ? Promise.reject(new Error('private details'))
      : indexed[store] ? { state: 'present', records: indexed[store] } : { state: 'absent', reason: 'Synthetic absent store.' },
    archives: { reviewed: true, records: [] }, capturedAt: '2026-10-29T00:00:00Z' });
}
async function publish(service, content = fixture(), idempotencyKey = 'import', options = {}) {
  const input = { ...await query(service), sourceText: JSON.stringify(content), sourceInventory: await capture(content, options), mode: 'import' };
  let preview = await service.preview(input);
  const pending = preview.importPlan.rows.filter(row => !row.choice);
  if (pending.length) preview = await service.preview({ ...input, resolutions: Object.fromEntries(pending.map(row => [row.member, { action: 'replace', target: row.matches[0] }])) });
  assert.equal(preview.commitAvailable, true);
  return service.apply({ ...preview, idempotencyKey });
}
async function select(service, resolutions = {}, idempotencyKey = 'select') {
  const preview = await service.previewCurrentView({ ...await query(service), resolutions });
  assert.equal(preview.commitAvailable, true, canonical(preview.currentViewPlan.blocked));
  return { preview, receipt: await service.apply({ ...preview, idempotencyKey }) };
}

test('all domain families, complete history and missing references are available from one reviewed revision', async () => {
  const service = createCommandService(createMemoryAdapter()), content = fixture();
  content.traceRuns = Array.from({ length: 1002 }, (_, n) => ({ run_id: `trace${n}`, prompt_id: 'p', future: n }));
  await publish(service, content, 'import', { entries: { 'pl2-session-pl2-session': '{"text":"draft"}',
    'pl2-draft-reset-recovery-v1': '{"text":"recoverable"}', 'pl2-pad': 'legacy Scratch' } });
  const before = await service.read();
  await assert.rejects(service.currentRecords(await query(service)), { code: 'SELECTION_REQUIRED' });
  const { preview, receipt } = await select(service), after = await service.read();
  assert.equal(receipt.operation, 'select'); assert.equal(receipt.checkpointId, before.revision);
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  const items = []; let cursor = '0';
  do { const page = await service.currentRecords({ ...await query(service), cursor }); items.push(...page.items); cursor = page.nextCursor; } while (cursor !== null);
  for (const domain of ['prompts', 'trash', 'prompt-versions', 'prompt-variants', 'embedded-test-cases', 'collections', 'folders', 'packs',
    'loaded-packs', 'scratch', 'scratch-notes', 'scratch-legacy', 'evaluations', 'test-cases', 'experiments', 'experiment-variants', 'execution-traces', 'assets', 'drafts', 'recovery', 'backups']) {
    assert.ok(items.some(row => row.domain === domain), domain);
  }
  assert.equal(items.filter(row => row.domain === 'prompt-versions').length, 41);
  assert.equal(items.filter(row => row.domain === 'execution-traces').length, 1002);
  assert.deepEqual(items.find(row => row.domain === 'prompts').value, content.library[0]);
  assert.equal(items.find(row => row.domain === 'folders').references[0].status, 'missing');
  const rebuilt = await inspectTransfer(await createTransfer(after)); assert.deepEqual(rebuilt.state, after);
  const reopened = createCommandService(createMemoryAdapter(rebuilt.state));
  assert.deepEqual(await reopened.apply({ ...preview, idempotencyKey: 'select' }), receipt);
  assert.deepEqual(await reopened.currentRecords(await query(reopened)), await service.currentRecords(await query(service)));
});

test('unequal replicas require explicit review and preserve both copies after choosing one', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, fixture(), 'import', { indexed: { eval_runs: [{ id: 'eval', output: 'Different indexed result' }] } });
  const pending = await service.previewCurrentView(await query(service));
  const group = pending.currentViewPlan.groups.find(row => row.domain === 'evaluations');
  assert.equal(group.decision, 'unresolved'); assert.equal(group.candidates.length, 2);
  const before = await service.read();
  await assert.rejects(service.apply({ ...pending, idempotencyKey: 'unreviewed' }), { code: 'UNRESOLVED_SELECTION' });
  assert.deepEqual(await service.read(), before);
  const preserved = await service.records({ ...await query(service), domain: 'evaluations' });
  const chosen = preserved.items.find(row => row.origin.replica === 'evaluations').key;
  await select(service, { [group.id]: chosen });
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'evaluations' })).items[0].value.output, 'Different indexed result');
  assert.equal((await service.records({ ...await query(service), domain: 'evaluations' })).items.length, 2);
});

test('absence in another capture needs an explicit decision and cannot silently reactivate an old record', async () => {
  const service = createCommandService(createMemoryAdapter()), original = fixture();
  await publish(service, original);
  await publish(service, { ...original, testCases: [] }, 'later');
  const pending = await service.previewCurrentView(await query(service));
  const group = pending.currentViewPlan.groups.find(row => row.domain === 'test-cases');
  assert.equal(group.decision, 'unresolved'); assert.equal(group.absentBindings.length, 1);
  const choices = Object.fromEntries(pending.currentViewPlan.groups.filter(row => row.decision === 'unresolved').map(row => [row.id, null]));
  await select(service, choices);
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'test-cases' })).total, 0);
  assert.equal((await service.records({ ...await query(service), domain: 'test-cases' })).total, 1);
});

test('prompt import decisions and permanent deletion cannot be overridden by a current-view choice', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, fixture(), 'import', { entries: { 'pl2-library-deleted:p': '1' } });
  const preview = await service.previewCurrentView(await query(service)), prompt = preview.currentViewPlan.groups.find(row => row.domain === 'prompts');
  assert.equal(prompt.selected, null);
  await assert.rejects(service.previewCurrentView({ ...await query(service), resolutions: { [prompt.id]: prompt.candidates[0] } }), { code: 'INVALID_RESOLUTIONS' });
  await select(service);
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'prompts' })).total, 0);
  assert.equal((await service.records({ ...await query(service), domain: 'prompt-versions' })).total, 82);
});

test('a divergent prompt journal requires import review before selecting the current view', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, fixture(), 'import', { surface: 'desktop', indexed: { journal: [{ id: 'library', revision: 1,
    entries: { 'pl2-library': JSON.stringify([{ id: 'p', original: 'Different journal text' }]) } }] } });
  const preview = await service.previewCurrentView(await query(service));
  assert.equal(preview.commitAvailable, false);
  assert.ok(preview.currentViewPlan.blocked.some(issue => issue.code === 'PROMPT_REPLICA_REQUIRES_IMPORT'));
});

test('permanent clear suppresses old trash without discarding its preserved record', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, fixture(), 'import', { entries: { 'pl2-library-clear:0000000000000001:abc': '1' } });
  await select(service);
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'trash' })).total, 0);
  assert.equal((await service.records({ ...await query(service), domain: 'trash' })).total, 2);
});

test('explicitly skipped prompts stay retained and identical kept IDs retain their source positions', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, { library: [{ id: 'same', original: 'Existing' }] });
  const content = { library: [{ id: 'same', original: 'Skipped changed text' }, { id: 'duplicate', original: 'Kept' }, { id: 'duplicate', original: 'Kept' }] };
  const input = { ...await query(service), sourceText: JSON.stringify(content), sourceInventory: await capture(content), mode: 'import' };
  const pending = await service.preview(input), rows = pending.importPlan.rows;
  const preview = await service.preview({ ...input, resolutions: { [rows[0].member]: { action: 'skip' }, [rows[1].member]: { action: 'keep' }, [rows[2].member]: { action: 'keep' } } });
  await service.apply({ ...preview, idempotencyKey: 'reviewed-import' });
  await select(service);
  const current = await service.currentRecords({ ...await query(service), domain: 'prompts' });
  assert.deepEqual(current.items.map(row => row.value.original).sort(), ['Existing', 'Kept', 'Kept']);
  assert.ok((await service.records({ ...await query(service), domain: 'prompts' })).items.some(row => row.value.original === 'Skipped changed text'));
});

test('branch reconciliation preserves committed views and requires a fresh current view', async () => {
  const left = createCommandService(createMemoryAdapter()); await publish(left, { library: [{ id: 'p', original: 'Base' }] });
  const right = createCommandService(createMemoryAdapter(await left.read()));
  await select(left, {}, 'left-view');
  await publish(right, { library: [{ id: 'p', original: 'Changed on right' }] }, 'right-change');
  await select(right, {}, 'right-view');
  const preview = await left.previewReconcile({ ...await query(left), incoming: await createTransfer(await right.read()) });
  assert.equal(preview.commitAvailable, true); await left.apply({ ...preview, idempotencyKey: 'merge' });
  await assert.rejects(left.currentRecords(await query(left)), { code: 'SELECTION_REQUIRED' });
  await select(left, {}, 'merged-view');
  assert.equal((await left.currentRecords({ ...await query(left), domain: 'prompts' })).items[0].value.original, 'Changed on right');
  await inspectTransfer(await createTransfer(await left.read()));
});

test('Scratch deletion evidence blocks an older selected container', async () => {
  const service = createCommandService(createMemoryAdapter());
  await publish(service, fixture(), 'import', { entries: { 'pl2-pads': JSON.stringify({ pads: [], tombstones: { note: 123 } }) } });
  const pending = await service.previewCurrentView(await query(service)), group = pending.currentViewPlan.groups.find(row => row.domain === 'scratch');
  const all = (await service.records({ ...await query(service), domain: 'scratch' })).items;
  const older = all.find(row => row.origin.replica === 'workspace'), newer = all.find(row => row.value.pads.length === 0);
  const unsafe = await service.previewCurrentView({ ...await query(service), resolutions: { [group.id]: older.key } });
  assert.ok(unsafe.currentViewPlan.blocked.some(issue => issue.code === 'SCRATCH_DELETION_CONFLICT'));
  await assert.rejects(service.apply({ ...unsafe, idempotencyKey: 'unsafe' }), { code: 'UNRESOLVED_SELECTION' });
  await select(service, { [group.id]: newer.key });
  assert.equal((await service.currentRecords({ ...await query(service), domain: 'scratch-notes' })).total, 0);
});

test('corrupt and unavailable sources block selection and preserve their evidence', async () => {
  for (const options of [{ entries: { 'pl2-pads': '{invalid' } }, { indexed: { eval_runs: 'unavailable' } }]) {
    const service = createCommandService(createMemoryAdapter()); await publish(service, fixture(), 'import', options);
    const before = await service.read(), preview = await service.previewCurrentView(await query(service));
    assert.equal(preview.commitAvailable, false); assert.ok(preview.currentViewPlan.blocked.length);
    assert.equal(JSON.stringify(preview).includes('private details'), false);
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'unsafe' }), { code: 'UNRESOLVED_SELECTION' });
    assert.deepEqual(await service.read(), before);
  }
});

test('unknown choices, stale and expired reviews, mutation and operation reuse fail safely', async () => {
  let now = 0; const service = createCommandService(createMemoryAdapter(), { now: () => now, previewLifetimeMs: 10 });
  await publish(service);
  await assert.rejects(service.previewCurrentView({ ...await query(service), resolutions: { missing: null } }), { code: 'INVALID_RESOLUTIONS' });
  await assert.rejects(service.previewCurrentView({ ...await query(service), bypass: true }), { code: 'INVALID_REQUEST' });
  const expired = await service.previewCurrentView(await query(service)); now = 11;
  await assert.rejects(service.apply({ ...expired, idempotencyKey: 'expired' }), { code: 'PREVIEW_EXPIRED' });
  const first = await service.previewCurrentView(await query(service)), original = structuredClone(first);
  first.currentViewPlan.selected.length = 0;
  const receipt = await service.apply({ ...first, idempotencyKey: 'select' });
  assert.ok((await service.currentRecords(await query(service))).items.length);
  assert.deepEqual(await service.apply({ ...original, idempotencyKey: 'select' }), receipt);
  await assert.rejects(service.currentRecords({ libraryId: 'lib', expectedRevision: original.expectedRevision }), { code: 'REVISION_CONFLICT' });
  const next = await service.previewCurrentView(await query(service));
  await assert.rejects(service.apply({ ...next, idempotencyKey: 'select' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await publish(service, { ...fixture(), future: 'changed' }, 'later');
  await assert.rejects(service.apply({ ...next, idempotencyKey: 'stale' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.currentRecords(await query(service)), { code: 'SELECTION_REQUIRED' });
});

test('forged selection objects fail reinspection even with valid object hashes', async () => {
  const service = createCommandService(createMemoryAdapter()); await publish(service); await select(service);
  const state = await service.read(), commit = state.objects[state.revision].data, plan = structuredClone(state.objects[commit.currentViewPlan].data);
  plan.selected = [];
  const changed = await makeObject('current-view-plan', plan), revised = await makeObject('commit', { ...commit, currentViewPlan: changed.hash });
  await assert.rejects(inspectPackage({ ...pkg(state), head: revised.hash, objects: { ...state.objects, [changed.hash]: changed.object, [revised.hash]: revised.object } }), { code: 'SELECTION_MISMATCH' });
});

test('API read and write scopes share reviewed current records and source identity', async t => {
  const adapter = createMemoryAdapter(), service = createCommandService(adapter); await publish(service);
  const token = 'a'.repeat(40), readToken = 'b'.repeat(40), api = createLocalApi({ adapter, libraryId: 'lib', credentials: [
    { token, scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 }, { token: readToken, scopes: ['read'], expiresAt: Date.now() + 60_000 } ] });
  const url = await api.listen(); t.after(() => api.close());
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const request = { method: 'POST', headers, body: JSON.stringify(await query(service)) };
  assert.equal((await fetch(`${url}/v1/library/current-views`, { ...request, headers: { ...headers, Authorization: `Bearer ${readToken}` } })).status, 403);
  const response = await fetch(`${url}/v1/library/current-views`, request); assert.equal(response.status, 201);
  const preview = await response.json();
  const committed = await fetch(`${url}/v1/library/commits`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'api-select' }, body: JSON.stringify(preview) });
  assert.equal(committed.status, 201);
  const receipt = await committed.json(), page = await fetch(`${url}/v1/library/current-records?revision=${encodeURIComponent(receipt.revision)}&domain=prompts`, { headers });
  assert.equal(page.status, 200);
  assert.deepEqual(await page.json(), await service.currentRecords({ ...await query(service), domain: 'prompts' }));
  assert.equal((await fetch(`${url}/v1/library/current-records?revision=${encodeURIComponent(receipt.revision)}&limit=1&limit=2`, { headers })).status, 400);
});

for (const point of ['before-flush', 'before-publication', 'after-publication']) {
  test(`selection interruption at ${point} preserves old state or the complete receipt`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'promptlab-current-view-')); t.after(() => rm(directory, { recursive: true, force: true }));
    let fail = false;
    const service = createCommandService(await createFolderAdapter(directory, { fault: async phase => { if (fail && point === phase) throw new Error('injected selection interruption'); } }));
    await publish(service); const before = await service.read(), preview = await service.previewCurrentView(await query(service)); fail = true;
    await assert.rejects(service.apply({ ...preview, idempotencyKey: 'select' }), /injected selection interruption/);
    const reopened = createCommandService(await createFolderAdapter(directory));
    if (point === 'after-publication') assert.equal((await reopened.apply({ ...preview, idempotencyKey: 'select' })).operation, 'select');
    else { assert.deepEqual(await reopened.read(), before); await select(reopened); }
    assert.equal((await reopened.currentRecords({ ...await query(reopened), domain: 'prompts' })).total, 1);
    const restore = await reopened.previewRestore({ ...await query(reopened), checkpointId: before.revision });
    await reopened.apply({ ...restore, idempotencyKey: 'restore' });
    await assert.rejects(reopened.currentRecords(await query(reopened)), { code: 'SELECTION_REQUIRED' });
    await inspectTransfer(await createTransfer(await reopened.read()));
  });
}
