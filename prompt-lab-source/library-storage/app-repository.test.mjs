import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, createCommandService, createMemoryAdapter, LibraryError } from './contract.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createCommandOutbox } from './command-outbox.mjs';
import { createServiceTransport } from './command-client.mjs';
import { createAppLibraryRepository, APP_RECORD_VERSION } from '../prompt-lab-extension/src/lib/appLibraryRepository.js';
import { createExperimentStore } from '../prompt-lab-extension/src/experimentStore.js';
import { retryPendingWrites } from '../prompt-lab-extension/src/lib/writeRecovery.js';
import { createPromptLibraryStore } from '../prompt-lab-extension/src/lib/promptLibraryStore.js';

globalThis.window = { dispatchEvent() {} };
const stamp = '2026-10-29T21:00:00.000Z';
function commandStore() {
  const rows = new Map();
  return { rows,
    async read(lib, op) { return structuredClone(rows.get(canonical([lib, op])) ?? null); },
    async list(lib) { return structuredClone([...rows.values()].filter(row => row.libraryId === lib)); },
    async write(row, version) {
      const key = canonical([row.libraryId, row.operationId]);
      if ((rows.get(key)?.version ?? null) !== version) throw new LibraryError('OUTBOX_CONFLICT', 'Synthetic conflict');
      rows.set(key, structuredClone(row));
    },
  };
}
async function fixture(promptFields = {}) {
  const workspace = { library: [{ id: 'prompt', title: 'Preserved prompt', original: 'Preserved prompt', enhanced: 'Preserved prompt',
    variants: [], notes: '', tags: [], collection: '', future: { keep: true }, versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `v${i}` })), ...promptFields }],
    scratch: { pads: [{ id: 'note', title: 'Source note', content: 'Keep note', future: { keep: true } }], activeId: 'note', revision: 1 },
    evaluations: [{ id: 'original-eval', input: 'Input', output: 'Original', createdAt: stamp, future: { keep: 9, edit: 1 } }],
    testCases: [{ id: 'original-case', promptId: 'prompt', input: 'Original case', createdAt: stamp, updatedAt: stamp }],
    traceRuns: [{ run_id: 'original-trace', trace_id: 'trace', outputs: { text: 'Original trace' } }],
    experiments: [{ id: 'original-experiment', label: 'Original experiment', variants: [], createdAt: stamp }] };
  const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': '[]', 'pl2-pads': JSON.stringify(workspace.scratch) };
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'fixture-origin', capturedAt: stamp,
    localStorage: { length: 3, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter());
  const review = await service.preview({ libraryId: 'lib', expectedRevision: null, mode: 'import', sourceText: JSON.stringify(workspace), sourceInventory: inventory });
  const receipt = await service.apply({ ...review, idempotencyKey: 'import' });
  const selection = await service.previewCurrentView({ libraryId: 'lib', expectedRevision: receipt.revision });
  assert.equal(selection.commitAvailable, true);
  await service.apply({ ...selection, idempotencyKey: 'select' });
  const transport = createServiceTransport(service, { libraryId: 'lib' }), store = commandStore();
  const options = { libraryId: 'lib', sourceBinding: receipt.sourceBinding, transport, outbox: createCommandOutbox(store), now: () => Date.parse(stamp), pageSize: 100 };
  const repository = createAppLibraryRepository(options); await repository.open();
  return { service, transport, store, options, repository, app: createExperimentStore(repository) };
}
const read = async (f, domain) => f.service.currentRecords({ libraryId: 'lib', expectedRevision: (await f.service.read()).revision, domain });

test('unchanged legacy prompts retain the displayed version identity without creating a receipt', async () => {
  const f = await fixture(), app = createPromptLibraryStore(f.repository); await app.open();
  const version = app.library[0].currentVersionId;
  const saved = await app.doSave({ editingId: 'prompt', expectedVersionId: version, raw: 'Preserved prompt', title: 'Preserved prompt' });
  assert.equal(saved.unchanged, true); assert.equal(saved.versionId, version); assert.equal(saved.operationId, null);
  assert.equal(Object.keys((await f.service.read()).operations).length, 2);
  const edited = await app.doSave({ editingId: 'prompt', expectedVersionId: saved.versionId, raw: 'Next edit' });
  assert.ok(edited.operationId); assert.notEqual(edited.versionId, version);
});

test('editing a title preserves legacy values that the UI normalizes for display', async () => {
  const input = { variants: [{ label: 'Future variant', content: '', opaque: { keep: true } }],
    tags: [' padded ', 'padded'], metadata: { future: { keep: true } } };
  const f = await fixture(input), app = createPromptLibraryStore(f.repository); await app.open();
  const displayed = app.library[0]; assert.equal(displayed.variants.length, 0);
  const saved = await app.doSave({ editingId: displayed.id, expectedVersionId: displayed.currentVersionId,
    raw: displayed.original, enhanced: displayed.enhanced, title: 'Only the title changed',
    variants: displayed.variants, tags: displayed.tags, notes: displayed.notes, collection: displayed.collection,
    metadata: displayed.metadata, resultMeta: displayed.resultMeta });
  assert.ok(saved.operationId);
  const current = await f.repository.readRecord('prompts', 'prompt');
  for (const [key, value] of Object.entries(input)) assert.deepEqual(current[key], value);
  assert.equal(current.title, 'Only the title changed'); assert.equal(current.versions.length, 42);
});

test('prompt store creates once, edits through the service and keeps complete history and unknown fields', async () => {
  const f = await fixture(), before = await f.service.read(), messages = [];
  const app = createPromptLibraryStore(f.repository, { notify: m => messages.push(m), newId: () => 'draft-one' }); await app.open();
  const original = app.library.find(row => row.id === 'prompt');
  const versionId = original.currentVersionId;
  assert.equal((await app.refresh()).library[0].id, 'prompt');
  assert.equal(app.library.find(row => row.id === 'prompt').currentVersionId, versionId);
  const saved = await app.doSave({ editingId: 'prompt', expectedVersionId: versionId, raw: 'Editor update', title: 'Updated' });
  assert.equal(saved.libraryId, 'lib'); assert.ok(saved.revision); assert.ok(saved.operationId);
  const changed = (await read(f, 'prompts')).items.find(row => row.sourceId === 'prompt').value;
  assert.equal(changed.original, 'Editor update'); assert.equal(changed.versions.length, 42);
  assert.equal(changed.versions.at(-1).original, 'Preserved prompt'); assert.deepEqual(changed.future, { keep: true });
  const args = { raw: 'New editor prompt', title: 'New prompt' };
  const first = app.doSave(args), second = app.doSave(args); assert.equal(first, second);
  const created = await first;
  assert.equal(created.versionNumber, 1); assert.equal(app.library.length, 2);
  assert.equal(Object.keys((await f.service.read()).operations).length, 4);
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual((await f.service.read()).objects[key], value);
  assert.equal(messages.filter(m => m.startsWith('Saved')).length, 2);
  const unchanged = await app.doSave({ ...args, editingId: created.id, expectedVersionId: created.versionId });
  assert.equal(unchanged.unchanged, true); assert.equal(unchanged.operationId, null);
  assert.equal(Object.keys((await f.service.read()).operations).length, 4);
});

test('prompt editor preserves a failed offline intent and an identical retry after reconstructed recovery', async () => {
  const f = await fixture(); let offline = false;
  const repository = createAppLibraryRepository({ ...f.options, transport: { ...f.transport,
    identity: async () => { if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Offline'); return f.transport.identity(); },
  } });
  const app = createPromptLibraryStore(repository); await app.open();
  const args = { editingId: 'prompt', expectedVersionId: app.library[0].currentVersionId, raw: 'Offline draft', title: 'Offline title' };
  const before = await f.service.read(); offline = true;
  assert.equal(await app.doSave(args), null); assert.match(app.saveError, /draft is still available/);
  const pending = (await repository.pending())[0]; assert.equal(pending.request.mode, 'edit'); assert.equal(pending.reviewHash, null);
  assert.deepEqual(await f.service.read(), before);
  assert.equal(await app.doSave({ ...args, raw: 'Different draft' }), null);
  const recovered = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(f.store) }); await recovered.open();
  offline = false;
  const result = await app.doSave(args); assert.equal(result.versionNumber, 43);
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
  assert.equal((await recovered.readRecord('prompts', 'prompt')).original, 'Offline draft');
});

test('prompt lifecycle retains bytes through Trash, restore and confirmed deletion', async () => {
  const f = await fixture(), before = await f.service.read();
  const row = await f.repository.readRecord('prompts', 'prompt');
  await f.repository.changePromptLifecycle('trash', row);
  let library = await f.repository.readPromptLibrary(); assert.equal(library.library.length, 0); assert.equal(library.trash.length, 1);
  const trashed = library.trash[0];
  await assert.rejects(f.repository.changePromptLifecycle('delete', trashed), { code: 'INVALID_LIFECYCLE' });
  await f.repository.changePromptLifecycle('restore', trashed);
  assert.equal((await f.repository.readPromptLibrary()).library[0].versions.length, 41);
  await f.repository.changePromptLifecycle('trash', (await f.repository.readPromptLibrary()).library[0]);
  const target = (await f.repository.readPromptLibrary()).trash[0];
  await f.repository.changePromptLifecycle('delete', target, { confirmPermanentDeletion: true });
  await f.repository.changePromptLifecycle('delete', target, { confirmPermanentDeletion: true });
  library = await f.repository.readPromptLibrary(); assert.equal(library.library.length, 0); assert.equal(library.trash.length, 0);
  const after = await f.service.read(); for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  assert.equal(Object.keys(after.operations).length, 6);
});

test('a stale prompt editor cannot replace an API edit or create a replacement for a deleted target', async () => {
  const f = await fixture(), app = createPromptLibraryStore(f.repository); await app.open();
  const version = app.library[0].currentVersionId;
  const other = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(commandStore()) }); await other.open();
  await other.editPrompt(await other.readRecord('prompts', 'prompt'), { original: 'API edit' });
  assert.equal(await app.doSave({ editingId: 'prompt', expectedVersionId: version, raw: 'Stale editor' }), null);
  assert.equal((await read(f, 'prompts')).items[0].value.original, 'API edit');
  assert.equal((await f.repository.pending()).filter(row => row.state !== 'committed').length, 1);
  const blank = createPromptLibraryStore(other); await blank.open();
  assert.equal(await blank.doSave({ editingId: 'missing', expectedVersionId: version, raw: 'Do not create' }), null);
  assert.equal((await read(f, 'prompts')).items.length, 1);
});

test('connected prompt associations update the shared run and Scratch record without a local fallback', async () => {
  const f = await fixture(), app = createPromptLibraryStore(f.repository, { newId: () => 'linked-prompt' }); await app.open();
  const saved = await app.doSave({ raw: 'Linked prompt', sourceNoteId: 'note' });
  await app.linkSavedPrompt(saved, { runId: 'original-eval', sourceNoteId: 'note' });
  assert.equal((await f.repository.readRecord('evaluations', 'original-eval')).promptId, saved.id);
  const note = await f.repository.readRecord('scratch-notes', 'note'); assert.equal(note.linkedPromptId, saved.id);
  assert.deepEqual(note.future, { keep: true }); assert.equal(note.content, 'Keep note');
});

test('failed prompt intent storage never publishes, and response loss retries the same creation', async () => {
  const f = await fixture(), before = await f.service.read();
  let rejectWrite = true, loseResponse = true;
  const repository = createAppLibraryRepository({ ...f.options,
    outbox: createCommandOutbox({ ...f.store, async write(...args) {
      if (rejectWrite) throw new LibraryError('OUTBOX_WRITE_FAILED', 'Synthetic rejected transaction');
      return f.store.write(...args);
    } }),
    transport: { ...f.transport, async apply(input) {
      const receipt = await f.transport.apply(input);
      if (loseResponse) throw new Error('Synthetic lost response');
      return receipt;
    } },
  });
  const app = createPromptLibraryStore(repository, { newId: () => 'retained-creation' }); await app.open();
  const args = { raw: 'Complete retained draft' };
  assert.equal(await app.doSave(args), null);
  assert.deepEqual(await f.service.read(), before); assert.equal((await repository.pending()).length, 0);
  rejectWrite = false;
  assert.equal(await app.doSave(args), null); assert.equal(app.library.length, 1);
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
  loseResponse = false;
  assert.ok((await app.doSave(args)).operationId); assert.equal(app.library.length, 2);
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
});

test('a retained completed save cannot relink the editor after a later API edit', async () => {
  const f = await fixture(); let failRead = false;
  const app = createPromptLibraryStore({ ...f.repository, async readPromptLibrary() {
    if (failRead) throw new Error('Synthetic readback failure');
    return f.repository.readPromptLibrary();
  } }, { newId: () => 'readback-creation' });
  await app.open(); failRead = true;
  const args = { raw: 'First content' };
  assert.equal(await app.doSave(args), null);
  const created = (await f.repository.readPromptLibrary()).library.find(row => row.id !== 'prompt');
  await f.repository.editPrompt(created, { original: 'Later API content' });
  failRead = false;
  assert.equal(await app.doSave(args), null); assert.match(app.saveError, /Another change followed/);
  assert.equal((await f.repository.readRecord('prompts', created.id)).original, 'Later API content');
  assert.equal(Object.keys((await f.service.read()).operations).length, 4);
});

test('prompt edits reject identity and history replacement before retaining an intent', async () => {
  const f = await fixture(), before = await f.service.read();
  const row = await f.repository.readRecord('prompts', 'prompt');
  for (const changes of [{ id: 'replacement' }, { versions: [] }, { currentVersionId: 'replacement' }]) {
    await assert.rejects(f.repository.editPrompt(row, changes));
  }
  assert.equal((await f.repository.pending()).length, 0); assert.deepEqual(await f.service.read(), before);
});

test('actual experiment store reads and writes all four domains through the shared service', async () => {
  const f = await fixture(), before = await f.service.read();
  globalThis.localStorage = { getItem() { throw new Error('Must not read local fallback'); }, setItem() { throw new Error('Must not write local fallback'); } };
  const run = await f.app.saveEvalRun({ id: 'new-eval', promptId: 'prompt', input: 'Input', output: 'Full output', future: { nested: true } });
  assert.equal(run.output, 'Full output'); assert.ok(run[APP_RECORD_VERSION]);
  assert.equal((await read(f, 'evaluations')).items.find(row => row.sourceId === 'new-eval').value.future.nested, true);
  await f.app.saveTestCase({ id: 'new-case', promptId: 'prompt', input: 'Test input' });
  await f.app.saveRunRecord({ run_id: 'new-trace', trace_id: 'trace', outputs: { text: 'Complete trace' } });
  await f.app.saveExperiment({ id: 'new-experiment', label: 'New experiment', variants: [{ id: 'variant', raw: 'full' }] });
  assert.equal((await f.app.listEvalRuns({ limit: 'all' })).length, 2);
  assert.equal((await f.app.listTestCases({ limit: 'all' })).length, 2);
  assert.equal((await f.app.listRunsByTrace('trace')).length, 2);
  assert.equal((await f.app.listExperiments({ search: 'New experiment' })).length, 1);
  const existing = await f.app.getEvalRunById('original-eval');
  await f.app.saveEvalRun({ ...existing, output: 'Changed', future: { edit: 2 }, metadata: { newObject: true } });
  assert.deepEqual((await read(f, 'evaluations')).items.find(row => row.sourceId === 'original-eval').value.future, { keep: 9, edit: 2 });
  assert.deepEqual((await read(f, 'evaluations')).items.find(row => row.sourceId === 'original-eval').value.metadata, { newObject: true });
  const observedCase = (await f.app.listTestCases({ limit: 'all' })).find(row => row.id === 'new-case');
  await f.app.deleteTestCase('new-case', observedCase);
  assert.equal((await read(f, 'test-cases')).items.length, 1);
  const after = await f.service.read();
  for (const [key, value] of Object.entries(before.objects)) assert.deepEqual(after.objects[key], value);
  assert.equal((await f.repository.pending()).filter(row => row.state !== 'committed').length, 0);
});

test('API edits appear through real store reads while stale observed objects cannot overwrite them', async () => {
  const f = await fixture(), stale = await f.app.getEvalRunById('original-eval');
  const other = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(commandStore()) }); await other.open();
  const fresh = await other.readRecord('evaluations', stale.id);
  await other.saveRecord('evaluations', { ...fresh, output: 'API edit' });
  assert.equal((await f.app.getEvalRunById(stale.id)).output, 'API edit');
  await assert.rejects(f.repository.saveRecord('evaluations', { ...stale, output: 'Stale edit' }), { code: 'RECORD_CONFLICT' });
  assert.equal((await read(f, 'evaluations')).items[0].value.output, 'API edit');
});

test('unchanged revisions reuse validated pages but every read checks the service and detects an API change', async () => {
  const f = await fixture(); let identities = 0, pages = 0;
  const repository = createAppLibraryRepository({ ...f.options, transport: { ...f.transport,
    identity: async () => { identities++; return f.transport.identity(); },
    currentRecords: async input => { pages++; return f.transport.currentRecords(input); },
  } });
  await repository.open();
  const initialPages = pages, initialIdentities = identities;
  const first = await repository.readRecord('evaluations', 'original-eval'); first.future.keep = 'caller edit';
  assert.equal((await repository.readDomain('evaluations'))[0].future.keep, 9);
  assert.equal(pages, initialPages); assert.equal(identities, initialIdentities + 2);
  const changed = await f.repository.readRecord('evaluations', 'original-eval');
  await f.repository.saveRecord('evaluations', { ...changed, output: 'API changed' });
  assert.equal((await repository.readRecord('evaluations', 'original-eval')).output, 'API changed');
  assert.ok(pages > initialPages);
});

test('lost acknowledgement persists one command and reconstructed repository resumes it without fallback', async () => {
  const f = await fixture();
  const broken = createAppLibraryRepository({ ...f.options, transport: { ...f.transport, apply: async value => {
    await f.transport.apply(value); throw new Error('Synthetic lost response');
  } } }); await broken.open();
  const app = createExperimentStore(broken);
  await assert.rejects(app.saveEvalRun({ id: 'recovered', input: 'Input', output: 'Preserve output', createdAt: stamp }), /Synthetic lost response/);
  const committed = await f.service.read(); assert.equal(Object.keys(committed.operations).length, 3);
  const restarted = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(f.store) }); await restarted.open();
  assert.equal((await restarted.readRecord('evaluations', 'recovered')).output, 'Preserve output');
  assert.deepEqual(await f.service.read(), committed);
  // The older in-memory UI retry finds the stored receipt and never reexecutes.
  await retryPendingWrites();
  assert.deepEqual(await f.service.read(), committed);
});

test('failed durable queueing never publishes or falls back to browser storage', async () => {
  const f = await fixture(), before = await f.service.read(); let writes = 0, network = 0;
  const rejecting = { ...f.store, async write() { writes++; throw new LibraryError('OUTBOX_WRITE_FAILED', 'Synthetic quota failure'); } };
  const repository = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(rejecting), transport: { ...f.transport,
    identity: async () => { network++; return f.transport.identity(); }, preview: async request => { network++; return f.transport.preview(request); },
  } }); await repository.open(); network = 0;
  await assert.rejects(repository.saveRecord('evaluations', { id: 'not-saved', output: 'Keep draft' }), { code: 'OUTBOX_WRITE_FAILED' });
  assert.equal(writes, 1); assert.equal(network, 0); assert.deepEqual(await f.service.read(), before);
});

test('actual app patch is durable before service review and a reconstructed repository resumes it', async () => {
  const f = await fixture(), before = await f.service.read(); let offline = false;
  const repository = createAppLibraryRepository({ ...f.options, transport: { ...f.transport,
    identity: async () => { if (offline) throw new LibraryError('SERVICE_UNAVAILABLE', 'Synthetic offline'); return f.transport.identity(); },
  } });
  await repository.open(); offline = true;
  const app = createExperimentStore(repository);
  await assert.rejects(app.patchEvalRun('original-eval', { output: 'Retained offline patch' }), { code: 'SERVICE_UNAVAILABLE' });
  const pending = (await repository.pending())[0];
  assert.equal(pending.reviewHash, null); assert.equal(pending.sourceHash, null);
  assert.equal(pending.request.expectedRevision, before.revision);
  assert.ok(pending.request.updates.some(u => u.path[0] === 'output' && u.value === 'Retained offline patch'));
  assert.deepEqual(await f.service.read(), before);
  const restarted = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(f.store) });
  await restarted.open();
  const saved = await restarted.readRecord('evaluations', 'original-eval');
  assert.equal(saved.output, 'Retained offline patch'); assert.deepEqual(saved.future, { keep: 9, edit: 1 });
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
  assert.equal((await restarted.pending())[0].state, 'committed');
  offline = false; await retryPendingWrites();
  assert.equal(Object.keys((await f.service.read()).operations).length, 3);
});

test('an offline app edit never rebases over a later API update', async () => {
  const f = await fixture();
  const repository = createAppLibraryRepository({ ...f.options, transport: { ...f.transport, preview: async () => { throw new Error('Offline preview'); } } });
  await repository.open();
  await assert.rejects(repository.saveRecord('evaluations', { ...await repository.readObservedRecord('evaluations', 'original-eval'), output: 'Offline edit' }), /Offline preview/);
  const other = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(commandStore()) }); await other.open();
  await other.saveRecord('evaluations', { ...await other.readRecord('evaluations', 'original-eval'), output: 'API edit' });
  const latest = await f.service.read();
  const restarted = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(f.store) });
  await assert.rejects(restarted.open(), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await f.service.read(), latest);
  assert.equal((await restarted.pending()).find(e => e.state !== 'committed').request.updates[0].value, 'Offline edit');
});

test('page identity, cursor and record hashes are checked before app data is returned', async () => {
  const f = await fixture();
  for (const corrupt of [page => ({ ...page, libraryId: 'foreign' }), page => ({ ...page, nextCursor: '0' }),
    page => ({ ...page, items: page.items.map((row, i) => i ? row : { ...row, valueHash: 'sha256:' + '0'.repeat(64) }) }),
    page => ({ ...page, total: page.total + 1 })]) {
    const repository = createAppLibraryRepository({ ...f.options, pageSize: 2, transport: { ...f.transport,
      currentRecords: async value => corrupt(await f.transport.currentRecords(value)) } });
    await assert.rejects(repository.open(), { code: 'INVALID_RESPONSE' });
  }
});

test('a read does not mix revisions and its returned values cannot mutate the retained snapshot', async () => {
  const f = await fixture(); let reads = 0;
  const repository = createAppLibraryRepository({ ...f.options, transport: { ...f.transport, identity: async () => {
    const value = await f.transport.identity(); return ++reads === 2 ? { ...value, revision: 'sha256:' + '0'.repeat(64) } : value;
  } } });
  await assert.rejects(repository.open(), { code: 'REVISION_CONFLICT' });
  const row = await f.repository.readRecord('evaluations', 'original-eval'); row.future.keep = 'mutated';
  assert.equal((await f.repository.readRecord('evaluations', 'original-eval')).future.keep, 9);
});

test('disconnect rejects queued reads and writes while retaining pending commands', async () => {
  const f = await fixture(), before = await f.service.read(); f.repository.disconnect();
  await assert.rejects(f.app.listExperiments(), { code: 'DISCONNECTED' });
  await assert.rejects(f.repository.saveRecord('evaluations', { id: 'closed', output: 'Draft' }), { code: 'DISCONNECTED' });
  assert.deepEqual(await f.service.read(), before); assert.deepEqual(await f.repository.pending(), []);
});

test('missing provenance and stale deletion cannot change a selected record', async () => {
  const f = await fixture(), before = await f.service.read();
  await assert.rejects(f.repository.saveRecord('evaluations', { id: 'original-eval', output: 'Unobserved edit' }), { code: 'RECORD_CONFLICT' });
  await assert.rejects(f.repository.deleteRecord('test-cases', 'original-case'), { code: 'RECORD_CONFLICT' });
  assert.deepEqual(await f.service.read(), before);
});

test('an unchanged stale record and a stale missing-record deletion are not acknowledged', async () => {
  const f = await fixture(), observed = await f.repository.readRecord('evaluations', 'original-eval');
  const other = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(commandStore()) }); await other.open();
  const fresh = await other.readRecord('evaluations', observed.id);
  await other.saveRecord('evaluations', { ...fresh, output: 'Newer API version' });
  await assert.rejects(f.repository.saveRecord('evaluations', observed), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.repository.deleteRecord('test-cases', 'missing'), { code: 'REVISION_CONFLICT' });
});

test('a newer API edit between commit and readback keeps the caller edit unacknowledged', async () => {
  const f = await fixture(); let interfere = true;
  const transport = { ...f.transport, apply: async input => {
    const receipt = await f.transport.apply(input);
    if (interfere) {
      interfere = false;
      const other = createAppLibraryRepository({ ...f.options, outbox: createCommandOutbox(commandStore()) }); await other.open();
      const row = await other.readRecord('evaluations', 'original-eval');
      await other.saveRecord('evaluations', { ...row, output: 'Concurrent API edit' });
    }
    return receipt;
  } };
  const repository = createAppLibraryRepository({ ...f.options, transport }); await repository.open();
  const observed = await repository.readRecord('evaluations', 'original-eval');
  await assert.rejects(repository.saveRecord('evaluations', { ...observed, output: 'App edit' }), { code: 'RECORD_CONFLICT' });
  assert.equal((await read(f, 'evaluations')).items[0].value.output, 'Concurrent API edit');
  assert.equal((await repository.pending())[0].state, 'committed');
});
