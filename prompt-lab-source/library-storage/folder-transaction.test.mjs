import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from './contract.mjs';
import { planFolderTransaction } from './folder-transaction.mjs';

const fixture = () => ({
  library: [
    { id: 'parent-prompt', collection: 'Ops', folderId: 'root', original: 'Long text '.repeat(5000), future: { retain: [false, null] },
      versions: Array.from({ length: 31 }, (_, i) => ({ id: `v${i}`, content: `History ${i}`, collection: 'Old', future: i })) },
    { id: 'child-prompt', collection: 'Ops/Shows', favorite: true },
    { id: 'id-only', folderId: 'child', metadata: { keep: 'yes' } },
    { id: 'unrelated', collection: 'Archive', original: 'Unchanged' },
  ],
  folders: [
    { id: 'root', name: 'Ops', parentId: null, collection: 'Ops', future: { keep: [1, 2] }, artwork: { image: 'opaque-future-format', emoji: '📁', future: true } },
    { id: 'child', name: 'Shows', parentId: 'root', collection: 'Ops/Shows', color: 'blue' },
    { id: 'archive', name: 'Archive', parentId: null, collection: 'Archive' },
  ],
  collections: ['Archive', 'Ops/Shows', 'Ops'], trash: [{ id: 'trashed', collection: 'Ops', unknown: true }],
  scratch: { pads: [{ id: 'note', content: 'Keep' }] }, packs: { pack: { future: 1 } },
  runs: [{ id: 'run', promptId: 'parent-prompt', promptVersionId: 'v9' }], extension: { nested: [1, 'keep'] },
});
async function input(workspace, action = 'change', folderId = 'root', changes = { name: 'Production' }) {
  return { action, expectedStateHash: await hash(workspace), folderId,
    expectedFolderHash: await hash(workspace.folders.find(folder => folder.id === folderId)),
    ...(action === 'change' ? { changes } : { confirmRemoval: true }) };
}
function unchangedDomains(before, after) {
  for (const key of Object.keys(before).filter(key => !['folders', 'collections', 'library'].includes(key))) assert.deepEqual(after[key], before[key]);
  for (const [index, prompt] of before.library.entries()) {
    const { collection, folderId, ...rest } = prompt;
    const { collection: nextCollection, folderId: nextFolderId, ...nextRest } = after.library[index];
    assert.deepEqual(nextRest, rest);
  }
}

test('folder rename plans every descendant path and prompt assignment without trimming history or unknown fields', async () => {
  const workspace = fixture(), before = structuredClone(workspace);
  const plan = await planFolderTransaction(workspace, await input(workspace));
  assert.deepEqual(workspace, before); assert.equal(plan.activationReady, false);
  assert.equal(plan.beforeHash, await hash(before)); assert.equal(plan.afterHash, await hash(plan.workspace));
  assert.deepEqual(plan.workspace.collections, ['Archive', 'Production/Shows', 'Production']);
  assert.deepEqual(plan.workspace.library.map(row => row.collection), ['Production', 'Production/Shows', 'Production/Shows', 'Archive']);
  assert.deepEqual(plan.workspace.folders[0], { ...before.folders[0], name: 'Production', collection: 'Production' });
  assert.deepEqual(plan.workspace.folders[1], { ...before.folders[1], collection: 'Production/Shows' });
  assert.deepEqual(plan.workspace.folders[2], before.folders[2]);
  assert.deepEqual(plan.changes.prompts.map(row => row.index), [0, 1, 2]);
  assert.equal(plan.changes.folders.length, 2); unchangedDomains(before, plan.workspace);
});

test('moving a parent keeps stable identities and updates nested compatibility paths together', async () => {
  const workspace = fixture(); const plan = await planFolderTransaction(workspace, await input(workspace, 'change', 'root', { parentId: 'archive' }));
  assert.equal(plan.workspace.folders[0].parentId, 'archive');
  assert.equal(plan.workspace.folders[1].parentId, 'root');
  assert.equal(plan.workspace.library[0].folderId, 'root');
  assert.equal(plan.workspace.library[1].collection, 'Archive/Ops/Shows');
  assert.equal(plan.workspace.folders[2].collection, 'Archive'); unchangedDomains(workspace, plan.workspace);
});

test('creating a folder preserves its extra fields and does not modify unrelated records', async () => {
  const workspace = fixture(); const folder = { id: 'new', name: '  Future  ', parentId: 'root', future: { a: false }, artwork: { bytes: 'keep' } };
  const plan = await planFolderTransaction(workspace, { action: 'create', expectedStateHash: await hash(workspace), folder });
  assert.deepEqual(plan.workspace.folders.at(-1), { ...folder, name: 'Future', collection: 'Ops/Future' });
  assert.deepEqual(plan.workspace.folders.slice(0, -1), workspace.folders);
  assert.deepEqual(plan.workspace.library, workspace.library); assert.deepEqual(plan.changes.prompts, []);
  assert.deepEqual(plan.workspace.collections, [...workspace.collections, 'Ops/Future']); unchangedDomains(workspace, plan.workspace);
});

test('removing a leaf keeps every prompt, clears its ID/path and leaves historical Trash evidence unchanged', async () => {
  const workspace = fixture(); const plan = await planFolderTransaction(workspace, await input(workspace, 'remove', 'child'));
  assert.equal(plan.workspace.library.length, workspace.library.length);
  assert.equal(plan.workspace.library[1].collection, ''); assert.equal(plan.workspace.library[2].folderId, '');
  assert.equal(plan.workspace.library[2].collection, '');
  assert.deepEqual(plan.workspace.collections, ['Archive', 'Ops']); unchangedDomains(workspace, plan.workspace);
  await assert.rejects(planFolderTransaction(workspace, await input(workspace, 'remove')), { code: 'FOLDER_HAS_CHILDREN' });
  await assert.rejects(planFolderTransaction(workspace, { ...await input(workspace, 'remove', 'child'), confirmRemoval: false }), { code: 'INVALID_FOLDER_COMMAND' });
});

test('literal legacy paths stay literal until their exact folder is changed', async () => {
  const workspace = fixture(); workspace.folders.push({ id: 'legacy', name: 'A/B', collection: 'A/B', parentId: null, future: 1 });
  workspace.collections.push('A/B'); workspace.library.push({ id: 'legacy-prompt', collection: 'A/B' });
  const other = await planFolderTransaction(workspace, await input(workspace));
  assert.deepEqual(other.workspace.folders.at(-1), workspace.folders.at(-1));
  const plan = await planFolderTransaction(workspace, await input(workspace, 'change', 'legacy', { name: 'Literal renamed' }));
  assert.equal(plan.workspace.library.at(-1).collection, 'Literal renamed');
  assert.equal(plan.workspace.folders.at(-1).id, 'legacy');
});

test('stale workspace and target hashes reject without altering the source', async () => {
  const workspace = fixture(), request = await input(workspace), stale = structuredClone(workspace);
  stale.extension.concurrent = true;
  await assert.rejects(planFolderTransaction(stale, request), { code: 'REVISION_CONFLICT' });
  await assert.rejects(planFolderTransaction(workspace, { ...request, expectedFolderHash: 'sha256:' + '0'.repeat(64) }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(planFolderTransaction(workspace, await input(workspace, 'change', 'root', { name: 'Ops' })), { code: 'NO_CHANGE' });
  assert.deepEqual(workspace, fixture());
});

test('invalid parents, cycles and sibling/path collisions reject before planning a successor', async () => {
  const workspace = fixture();
  for (const changes of [{ parentId: 'child' }, { parentId: 'missing' }, { name: 'Archive' }, { name: 'A/B' }, { name: ' ' }]) {
    await assert.rejects(planFolderTransaction(workspace, await input(workspace, 'change', 'root', changes)), { code: 'INVALID_FOLDER_GRAPH' });
  }
  for (const folder of [{ id: 'root', name: 'New', parentId: null }, { id: 'new', name: 'archive', parentId: null }]) {
    await assert.rejects(planFolderTransaction(workspace, { action: 'create', expectedStateHash: await hash(workspace), folder }),
      { code: folder.id === 'root' ? 'IDENTITY_CONFLICT' : 'INVALID_FOLDER_GRAPH' });
  }
});

test('incomplete projection and contradictory prompt references require explicit source repair', async () => {
  for (const mutate of [x => x.collections.push('Missing'), x => x.collections.push('Ops'),
    x => x.folders[0].parentId = 'child', x => x.library[0].folderId = 'missing',
    x => x.library[0].collection = 'Archive', x => x.library[1].collection = 'Missing']) {
    const workspace = fixture(); mutate(workspace); const original = structuredClone(workspace);
    await assert.rejects(planFolderTransaction(workspace, await input(workspace)), /Review|review|acyclic/);
    assert.deepEqual(workspace, original);
  }
});

test('caller mutation during hashing cannot change the captured request or workspace', async () => {
  const workspace = fixture(), request = await input(workspace), pending = planFolderTransaction(workspace, request);
  workspace.library[0].original = 'Late caller edit'; request.changes.name = 'Late name';
  const plan = await pending;
  assert.equal(plan.workspace.folders[0].name, 'Production');
  assert.equal(plan.workspace.library[0].original, fixture().library[0].original);
});

test('commands cannot replace identities, inject paths, add options or omit the explicit creation parent', async () => {
  const workspace = fixture();
  for (const changes of [{ id: 'replacement' }, { collection: 'Injected' }, { name: false }, { parentId: false }, {}]) {
    await assert.rejects(planFolderTransaction(workspace, await input(workspace, 'change', 'root', changes)), { code: 'INVALID_FOLDER_COMMAND' });
  }
  await assert.rejects(planFolderTransaction(workspace, { ...await input(workspace), bypass: true }), { code: 'INVALID_FOLDER_COMMAND' });
  await assert.rejects(planFolderTransaction(workspace, { action: 'create', expectedStateHash: await hash(workspace), folder: { id: 'new', name: 'New' } }), { code: 'INVALID_FOLDER_COMMAND' });
});
