import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hash } from './contract.mjs';
import { planLosslessImport, verifyImportPlan } from './import-plan.mjs';

const empty = () => ({ library: [] });
const prompt = (id, title, enhanced) => ({ id, title, enhanced });
const key = (source, ...path) => JSON.stringify([source, ...path]);
const readPath = (value, path) => path.reduce((result, segment) => result[segment], value);

test('exact body matching retains both raw members, 83 versions and every source field', async () => {
  const existing = { library: [{ ...prompt('local', 'Local title', 'Hello world'), currentVersionId: 'current',
    versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, enhanced: `old ${i}`, extra: { i } })), future: 'local metadata' }],
    assets: { bytes: 'AAE=' }, futureRoot: { local: true } };
  const incoming = { library: [{ ...prompt('remote', 'Other title', '  HELLO\nworld '), currentVersionId: 'current',
    versions: Array.from({ length: 42 }, (_, i) => ({ id: `v${i}`, enhanced: `remote ${i}`, future: i })), future: 'remote metadata' }],
    futureRoot: { remote: true }, runs: [{ id: 'r1', promptId: 'remote', promptVersionId: 'v40', unknown: { retain: true } }] };
  const before = structuredClone({ existing, incoming });
  const plan = await planLosslessImport(existing, incoming);
  assert.deepEqual({ existing, incoming }, before);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].selected, key('existing', 'library', 0));
  assert.deepEqual(plan.groups[0].members, [key('existing', 'library', 0), key('incoming', 'library', 0)]);
  assert.equal(plan.nodes.filter(node => node.kind === 'version').length, 83);
  for (const node of plan.nodes) assert.equal(node.hash, await hash(readPath(before[node.source], node.path)));
  assert.equal(plan.sources.incoming, await hash(incoming));
  const versionLink = plan.references.find(link => link.kind === 'version');
  assert.equal(versionLink.target, key('incoming', 'library', 0, 'versions', 40));
  assert.equal(versionLink.groupId, plan.groups[0].id);
  assert.equal(plan.activationReady, false);
  assert.deepEqual(await verifyImportPlan(plan, existing, incoming), plan);
});

test('title and ID conflicts require choices; keep and replace have distinct selected members', async () => {
  const existing = { library: [prompt('a', 'My title', 'first')] };
  const incoming = { library: [prompt('a', ' My  TITLE ', 'second')] };
  const pending = await planLosslessImport(existing, incoming);
  assert.equal(pending.unresolved, 1);
  assert.equal(pending.rows[0].kind, 'conflict');
  const keep = await planLosslessImport(existing, incoming, { a: { action: 'keep' } });
  assert.equal(keep.groups.length, 2);
  const replace = await planLosslessImport(existing, incoming, { a: { action: 'replace', existingId: 'a' } });
  assert.equal(replace.unresolved, 0);
  assert.equal(replace.groups.length, 1);
  assert.equal(replace.groups[0].selected, key('incoming', 'library', 0));
  assert.equal(replace.groups[0].members.length, 2);
  assert.notEqual(keep.fingerprint, replace.fingerprint);
});

test('incoming duplicates share a group and replacement can target an earlier incoming member', async () => {
  const incoming = { library: [prompt('a', 'Alpha', 'same'), prompt('b', 'Beta', 'SAME'), prompt('c', 'Alpha', 'changed')] };
  const plan = await planLosslessImport(empty(), incoming, { c: { action: 'replace', existingId: 'a', targetSource: 'incoming' } });
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].members.length, 3);
  assert.equal(plan.groups[0].selected, key('incoming', 'library', 2));
  assert.deepEqual(plan.rows.map(row => row.kind), ['new', 'duplicate', 'conflict']);
});

test('skipping a conflicting prompt retains related records and marks the inactive association', async () => {
  const existing = { library: [prompt('a', 'Shared', 'local')] };
  const incoming = { library: [prompt('a', 'Shared', 'incoming')], runs: [{ id: 'r', promptId: 'a' }],
    testCases: [{ id: 'c', promptId: 'a', input: 'case' }], scratch: { pads: [{ id: 'n', content: 'note', linkedPromptId: 'a' }] } };
  const plan = await planLosslessImport(existing, incoming, { a: { action: 'skip' } });
  assert.equal(plan.groups[0].members.length, 1);
  assert.equal(plan.nodes.filter(node => node.source === 'incoming').length, 4);
  assert.equal(plan.references.length, 3);
  assert.ok(plan.references.every(link => link.reason === 'prompt-not-selected' && link.groupId === null));
});

test('coincident destination IDs never invent missing incoming references', async () => {
  const existing = { library: [{ ...prompt('missing', 'Local', 'local'), currentVersionId: 'v' }],
    runs: [{ id: 'r', promptId: 'missing' }], testCases: [{ id: 'c', promptId: 'missing' }] };
  const incoming = { library: [{ ...prompt('new', 'New', 'new'), resultMeta: { runId: 'r' },
    metadata: { followUpOrigin: { sourcePromptId: 'missing', sourcePromptVersionId: 'v', sourceRunId: 'r' } } }],
    runs: [{ id: 'r2', promptId: 'missing', promptVersionId: 'v', testCaseId: 'c' }],
    scratch: { pads: [{ id: 'n', linkedPrompts: [{ id: 'missing', unknown: 'keep' }] }] } };
  const plan = await planLosslessImport(existing, incoming);
  const links = plan.references.filter(link => link.from.startsWith('["incoming"'));
  assert.equal(links.length, 8);
  assert.ok(links.every(link => link.target === null && link.reason === 'missing-source-reference'));
});

test('current-version collisions are exposed instead of silently choosing a history row', async () => {
  const incoming = { library: [{ ...prompt('p', 'Title', 'current'), currentVersionId: 'v', versions: [{ id: 'v', enhanced: 'old' }] }],
    runs: [{ id: 'r', promptId: 'p', promptVersionId: 'v' }] };
  const plan = await planLosslessImport(empty(), incoming);
  assert.equal(plan.references.find(link => link.kind === 'version').reason, 'ambiguous-current-version');
  assert.equal(plan.nodes.length, 3);
});

test('empty bodies and absent IDs remain distinct and deterministic without invented content', async () => {
  const incoming = { library: [{ future: 'one' }, { future: 'two' }] };
  const plan = await planLosslessImport(empty(), incoming);
  assert.equal(plan.groups.length, 2);
  assert.deepEqual(await planLosslessImport(empty(), incoming), plan);
  assert.ok(plan.nodes.every(node => node.sourceId === null));
});

test('legacy content aliases reuse body matching without adding normalized fields', async () => {
  const incoming = { library: [{ id: 'b', content: 'Same BODY', future: 'keep' }] };
  const plan = await planLosslessImport({ library: [prompt('a', 'A', 'same body')] }, incoming);
  assert.equal(plan.rows[0].kind, 'duplicate');
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.nodes.find(node => node.source === 'incoming').hash, await hash(incoming.library[0]));
  assert.equal(Object.hasOwn(incoming.library[0], 'enhanced'), false);
});

test('a duplicate of an unresolved incoming conflict waits for that decision', async () => {
  const existing = { library: [prompt('a', 'Shared', 'old')] };
  const incoming = { library: [prompt('b', 'Shared', 'new'), prompt('c', 'Other', 'NEW')] };
  const unresolved = await planLosslessImport(existing, incoming);
  assert.equal(unresolved.unresolved, 2);
  assert.equal(unresolved.rows[1].dependsOn, key('incoming', 'library', 0));
  const reviewed = await planLosslessImport(existing, incoming, { b: { action: 'replace', existingId: 'a' } });
  assert.equal(reviewed.unresolved, 0);
  assert.equal(reviewed.groups.length, 1);
  assert.equal(reviewed.groups[0].members.length, 3);
});

test('invalid, ambiguous and unlisted decisions fail without mutating sources', async () => {
  const existing = { library: [prompt('a', 'Title', 'local')] };
  const incoming = { library: [prompt('b', 'Title', 'incoming'), prompt('c', 'Title', 'third')] };
  const before = structuredClone(incoming);
  for (const choices of [
    { absent: { action: 'keep' } }, { b: { action: 'delete' } }, { b: { action: 'replace' } },
    { b: { action: 'replace', existingId: 'wrong' } },
    { b: { action: 'replace', existingId: 'a' }, c: { action: 'replace', existingId: 'a' } },
  ]) await assert.rejects(planLosslessImport(existing, incoming, choices), { code: 'INVALID_RESOLUTIONS' });
  assert.deepEqual(incoming, before);
  await assert.rejects(planLosslessImport(empty(), { library: [prompt('a', 'A', 'one'), prompt('a', 'B', 'two')] }), { code: 'AMBIGUOUS_ID' });
  await assert.rejects(planLosslessImport(empty(), { library: [], credentials: {} }), { code: 'EXCLUDED_STORE' });
  await assert.rejects(planLosslessImport(empty(), { library: [], runs: [{ id: 'r', promptId: 1 }] }), { code: 'INVALID_REFERENCE' });
});

test('source, graph and choice tampering invalidate the review fingerprint', async () => {
  const existing = empty(), incoming = { library: [prompt('__proto__', 'A', 'one')] };
  const choices = JSON.parse('{"__proto__":{"action":"keep"}}');
  const plan = await planLosslessImport(existing, incoming, choices);
  const changed = structuredClone(plan);
  changed.groups[0].members = [];
  await assert.rejects(verifyImportPlan(changed, existing, incoming, choices), { code: 'IMPORT_PLAN_MISMATCH' });
  await assert.rejects(verifyImportPlan(plan, existing, { ...incoming, future: true }, choices), { code: 'IMPORT_PLAN_MISMATCH' });
  await assert.rejects(verifyImportPlan(plan, existing, incoming, JSON.parse('{"__proto__":{"action":"skip"}}')), { code: 'IMPORT_PLAN_MISMATCH' });
});

test('published API schemas stay identical to the shared preservation contract', async () => {
  const schema = JSON.parse(await readFile(new URL('./schema-v1.json', import.meta.url), 'utf8'));
  const api = JSON.parse(await readFile(new URL('./openapi-v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(api.components.schemas, JSON.parse(JSON.stringify(schema.$defs).replaceAll('#/$defs/', '#/components/schemas/')));
  assert.equal(schema.$defs.ImportPlan.properties.activationReady.const, false);
});

test('review snapshots input before yielding and fingerprints the supplied choices', async () => {
  const incoming = { library: [prompt('a', 'A', 'before')] };
  const choices = { a: { action: 'keep' } };
  const original = structuredClone(incoming);
  const pending = planLosslessImport(empty(), incoming, choices);
  incoming.library[0].enhanced = 'after';
  choices.a.action = 'skip';
  const plan = await pending;
  assert.equal(plan.sources.incoming, await hash(original));
  assert.equal(plan.resolutions.a.action, 'keep');
  assert.equal(plan.nodes[0].hash, await hash(original.library[0]));
  await assert.rejects(verifyImportPlan(plan, empty(), original), { code: 'IMPORT_PLAN_MISMATCH' });
});
