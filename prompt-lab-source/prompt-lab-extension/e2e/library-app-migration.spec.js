import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalApi } from '../../library-storage/local-api.mjs';
import { createFolderAdapter } from '../../library-storage/folder-adapter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appModules = ['libraryAppMigration', 'libraryCommandOutbox', 'librarySourceCapture', 'libraryWriteCoordinator',
  'libraryOriginCapture', 'libraryEditBuffers', 'draftRecoveryCapture', 'libraryMatching', 'promptSchema',
  'utils', 'tagSchema', 'enhancementResult', 'followUpProvenance', 'collectionFolders', 'libraryPresentation',
  'appLibraryRepository', 'promptLibraryStore', 'appRecordVersion', 'logger', 'diagnostics', 'writeRecovery', 'evalSchema'];
let server, origin;
test.use({ channel: 'chromium' });
test.beforeAll(async () => {
  const paths = ['/prompt-lab-extension/src/constants.js', '/prompt-lab-extension/src/experimentStore.js',
    ...appModules.map(name => `/prompt-lab-extension/src/lib/${name}.js`),
    ...(await readdir(resolve(root, 'library-storage'))).filter(name => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).map(name => `/library-storage/${name}`)];
  const modules = new Map(await Promise.all(paths.map(async path => [path, await readFile(resolve(root, path.slice(1)))])));
  server = createServer((req, res) => {
    const body = req.url === '/' ? '<!doctype html><title>Disposable app migration</title>' : modules.get(req.url);
    res.writeHead(body ? 200 : 404, { 'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript' }); res.end(body ?? 'Not found');
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test('connected experiment store uses folder commands and recovers across a real browser restart', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-app-repository-'));
  const credential = { token: 'synthetic-repository-credential-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 };
  const adapter = await createFolderAdapter(resolve(directory, 'library'));
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const options = { baseUrl: await api.listen(), libraryId: 'lib', token: credential.token };
  const responses = [];
  const observe = page => page.on('response', response => {
    if (response.url().startsWith(options.baseUrl) && response.request().method() !== 'OPTIONS') {
      responses.push({ path: new URL(response.url()).pathname, status: response.status() });
    }
  });
  let context;
  try {
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    let page = await context.newPage(); observe(page); await boot(page, options);
    const sourceBinding = await page.evaluate(async () => {
      localStorage.setItem('pl2-library', '[{"id":"prompt","original":"Keep original","unknown":true}]');
      buffers.register('editor', () => ({ raw: 'Retained draft' }));
      const ids = { libraryId: 'lib', operationId: 'copy' };
      await migration.prepare({ ...ids, sourceIdentity: 'disposable-origin', archives: { reviewed: true, records: [] } });
      const copied = await migration.copy({ ...ids, reviewed: await migration.review(ids) });
      const review = await transport.preview({ mode: 'select', libraryId: 'lib', expectedRevision: copied.copiedRevision });
      await transport.apply({ ...review, idempotencyKey: 'select' });
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const { createExperimentStore } = await import('/prompt-lab-extension/src/experimentStore.js');
      window.repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding: copied.sourceBinding, transport });
      await repository.open(); window.records = createExperimentStore(repository);
      await records.saveEvalRun({ id: 'eval', promptId: 'prompt', output: 'Entire output', future: { keep: true } });
      await records.saveTestCase({ id: 'case', promptId: 'prompt', input: 'Complete test input' });
      await records.saveRunRecord({ run_id: 'trace', trace_id: 'parent', outputs: { text: 'Complete trace' } });
      await records.saveExperiment({ id: 'experiment', label: 'Browser experiment', variants: [{ id: 'variant', unknown: true }] });
      const apply = transport.apply;
      transport.apply = async input => { await apply(input); throw new Error('Synthetic lost response'); };
      try { await records.saveEvalRun({ id: 'lost-response', output: 'Keep after restart' }); throw new Error('Expected response loss'); }
      catch (error) { if (error.message !== 'Synthetic lost response') throw error; }
      return copied.sourceBinding;
    });
    expect(Object.keys((await adapter.read()).operations)).toHaveLength(7);
    await context.close();
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    page = await context.newPage(); observe(page); await boot(page, options);
    const recovered = await page.evaluate(async sourceBinding => {
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const { createExperimentStore } = await import('/prompt-lab-extension/src/experimentStore.js');
      window.repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding, transport });
      await repository.open(); window.records = createExperimentStore(repository);
      const runs = await records.listEvalRuns({ limit: 'all' });
      const cases = await records.listTestCases({ limit: 'all' });
      const traces = await records.listRunsByTrace('parent');
      const experiments = await records.listExperiments();
      await records.patchEvalRun('eval', { notes: 'Updated through real app store' });
      const observed = (await records.listTestCases({ limit: 'all' }))[0];
      await records.deleteTestCase('case', observed);
      return { outputs: runs.map(row => row.output).sort(), cases: cases.length, traces: traces.length,
        experiments: experiments.length, remainingCases: (await records.listTestCases({ limit: 'all' })).length,
        localOriginal: localStorage.getItem('pl2-library'),
        fallbackValues: ['pl2-eval-run-fallback', 'pl2-test-case-fallback', 'pl2-run-fallback', 'pl2-experiment-fallback'].map(key => localStorage.getItem(key)),
        pending: (await repository.pending()).filter(row => row.state !== 'committed').length };
    }, sourceBinding);
    expect(recovered).toEqual({ outputs: ['Entire output', 'Keep after restart'], cases: 1, traces: 1,
      experiments: 1, remainingCases: 0, localOriginal: '[{"id":"prompt","original":"Keep original","unknown":true}]',
      fallbackValues: [null, null, null, null], pending: 0 });
    const reopened = await (await createFolderAdapter(resolve(directory, 'library'))).read();
    expect(Object.keys(reopened.operations)).toHaveLength(9);
  } finally {
    console.log('Connected store HTTP requests:', JSON.stringify({ count: responses.length,
      rejected: responses.filter(response => response.status >= 400 && response.status !== 404) }));
    await context?.close(); await api.close(); await rm(directory, { recursive: true, force: true });
  }
});
test('offline app patch survives browser restart before its first service review', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-offline-intent-'));
  const credential = { token: 'synthetic-offline-credential-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 };
  const adapter = await createFolderAdapter(resolve(directory, 'library'));
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const options = { baseUrl: await api.listen(), libraryId: 'lib', token: credential.token };
  let context;
  try {
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    let page = await context.newPage(); await boot(page, options);
    const sourceBinding = await page.evaluate(async () => {
      localStorage.setItem('pl2-library', '[{"id":"prompt","original":"Original source"}]');
      const ids = { libraryId: 'lib', operationId: 'copy' };
      await migration.prepare({ ...ids, sourceIdentity: 'offline-fixture', archives: { reviewed: true, records: [] } });
      const copied = await migration.copy({ ...ids, reviewed: await migration.review(ids) });
      await transport.apply({ ...await transport.preview({ mode: 'select', libraryId: 'lib', expectedRevision: copied.copiedRevision }), idempotencyKey: 'select' });
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const { createExperimentStore } = await import('/prompt-lab-extension/src/experimentStore.js');
      window.repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding: copied.sourceBinding, transport });
      await repository.open(); window.records = createExperimentStore(repository);
      await records.saveEvalRun({ id: 'edit-offline', output: 'Before disconnection', future: { keep: true } });
      return copied.sourceBinding;
    });
    const before = await adapter.read();
    await context.setOffline(true);
    const retained = await page.evaluate(async () => {
      let code;
      try { await records.patchEvalRun('edit-offline', { output: 'Complete offline edit' }); }
      catch (error) { code = error.code; }
      const rows = (await repository.pending()).filter(row => row.state !== 'committed');
      return { code, rows: rows.map(row => ({ state: row.state, schemaVersion: row.schemaVersion, reviewHash: row.reviewHash,
        sourceHash: row.sourceHash, receipt: row.receipt, updates: row.request.updates })) };
    });
    expect(retained.code).toBe('SERVICE_UNAVAILABLE');
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0]).toMatchObject({ state: 'failed', schemaVersion: 3, reviewHash: null, sourceHash: null, receipt: null });
    expect(retained.rows[0].updates).toContainEqual({ path: ['output'], value: 'Complete offline edit' });
    expect(await adapter.read()).toEqual(before);
    await context.close();
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    page = await context.newPage(); await boot(page, options);
    const restored = await page.evaluate(async sourceBinding => {
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding, transport });
      await repository.open(); await repository.resume();
      const row = await repository.readRecord('evaluations', 'edit-offline');
      return { output: row.output, future: row.future, pending: (await repository.pending()).filter(r => r.state !== 'committed').length,
        original: localStorage.getItem('pl2-library'), fallback: localStorage.getItem('pl2-eval-run-fallback') };
    }, sourceBinding);
    expect(restored).toEqual({ output: 'Complete offline edit', future: { keep: true }, pending: 0,
      original: '[{"id":"prompt","original":"Original source"}]', fallback: null });
    expect(Object.keys((await adapter.read()).operations)).toHaveLength(4);
  } finally {
    await context?.close(); await api.close(); await rm(directory, { recursive: true, force: true });
  }
});
test('prompt store recovers an offline version through a real browser restart and retains Trash history', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-prompt-store-'));
  const credential = { token: 'synthetic-prompt-store-credential-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 };
  const adapter = await createFolderAdapter(resolve(directory, 'library'));
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const options = { baseUrl: await api.listen(), libraryId: 'lib', token: credential.token };
  let context;
  try {
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    let page = await context.newPage(); await boot(page, options);
    const prepared = await page.evaluate(async () => {
      localStorage.setItem('pl2-library', JSON.stringify([{ id: 'prompt', original: 'Retained original', future: { keep: true },
        variants: [{ content: '', opaque: true }],
        versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}` })) }]));
      const ids = { libraryId: 'lib', operationId: 'copy' };
      await migration.prepare({ ...ids, sourceIdentity: 'prompt-fixture', archives: { reviewed: true, records: [] } });
      const copied = await migration.copy({ ...ids, reviewed: await migration.review(ids) });
      await transport.apply({ ...await transport.preview({ mode: 'select', libraryId: 'lib', expectedRevision: copied.copiedRevision }), idempotencyKey: 'select' });
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const { createPromptLibraryStore } = await import('/prompt-lab-extension/src/lib/promptLibraryStore.js');
      window.repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding: copied.sourceBinding, transport });
      window.prompts = createPromptLibraryStore(repository, { newId: () => 'browser-draft' }); await prompts.open();
      const saved = await prompts.doSave({ raw: 'New browser prompt' });
      if (!saved?.operationId) throw new Error(prompts.saveError);
      return { sourceBinding: copied.sourceBinding, source: localStorage.getItem('pl2-library'),
        version: prompts.library.find(row => row.id === 'prompt').currentVersionId };
    });
    const before = await adapter.read(); await context.setOffline(true);
    const retained = await page.evaluate(async version => {
      const saved = await prompts.doSave({ editingId: 'prompt', expectedVersionId: version, raw: 'Offline complete edit' });
      return { saved, error: prompts.saveError, pending: (await repository.pending()).filter(row => row.state !== 'committed') };
    }, prepared.version);
    expect(retained.saved).toBeNull(); expect(retained.error).toContain('draft is still available');
    expect(retained.pending).toHaveLength(1); expect(retained.pending[0]).toMatchObject({ schemaVersion: 3, reviewHash: null, request: { mode: 'edit' } });
    expect(await adapter.read()).toEqual(before);
    await context.close();
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    page = await context.newPage(); await boot(page, options);
    const recovered = await page.evaluate(async sourceBinding => {
      const { createAppLibraryRepository } = await import('/prompt-lab-extension/src/lib/appLibraryRepository.js');
      const { createPromptLibraryStore } = await import('/prompt-lab-extension/src/lib/promptLibraryStore.js');
      const repository = createAppLibraryRepository({ libraryId: 'lib', sourceBinding, transport });
      const prompts = createPromptLibraryStore(repository); await prompts.open();
      const row = prompts.library.find(row => row.id === 'prompt');
      await prompts.changeLifecycle('trash', row.id); await prompts.changeLifecycle('restore', row.id);
      const raw = await repository.readRecord('prompts', row.id);
      return { original: row.original, future: row.future, versions: row.versions.length,
        retainedVariants: raw.variants,
        previous: row.versions.at(-1).original, restored: prompts.library.length, trash: prompts.trash.length,
        pending: (await repository.pending()).filter(row => row.state !== 'committed').length,
        source: localStorage.getItem('pl2-library') };
    }, prepared.sourceBinding);
    expect(recovered).toEqual({ original: 'Offline complete edit', future: { keep: true }, versions: 42,
      retainedVariants: [{ content: '', opaque: true }],
      previous: 'Retained original', restored: 2, trash: 0, pending: 0, source: prepared.source });
    const after = await adapter.read(); expect(Object.keys(after.operations)).toHaveLength(6);
    for (const [key, value] of Object.entries(before.objects)) expect(after.objects[key]).toEqual(value);
  } finally { await context?.close(); await api.close(); await rm(directory, { recursive: true, force: true }); }
});

test.afterAll(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });

async function boot(page, options) {
  await page.goto(origin);
  await page.evaluate(async options => {
    const { createAppLibraryMigration } = await import('/prompt-lab-extension/src/lib/libraryAppMigration.js');
    const { createLoopbackTransport } = await import('/library-storage/command-client.mjs');
    const { startAppCaptureParticipant } = await import('/prompt-lab-extension/src/lib/libraryOriginCapture.js');
    window.buffers = (await import('/prompt-lab-extension/src/lib/libraryEditBuffers.js')).libraryEditBuffers;
    window.transport = createLoopbackTransport({ ...options, getToken: () => options.token });
    window.migration = createAppLibraryMigration({ transport });
    window.participant = await startAppCaptureParticipant();
    window.durability = [];
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (['prompt_lab_library_migrations', 'prompt_lab_command_outbox'].includes(this.name) && args[1] === 'readwrite') {
        durability.push({ database: this.name, durability: tx.durability });
      }
      return tx;
    };
  }, options);
}

for (const scenario of ['restart', 'lost response recovery', 'backup transaction abort']) test(`app capture and migration ${scenario} preserve two editors and all sources`, async () => {
  const loss = scenario === 'lost response recovery';
  const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-app-migration-'));
  const credential = { token: 'synthetic-migration-credential-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 };
  const adapter = await createFolderAdapter(resolve(directory, 'library'));
  const api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const options = { baseUrl: await api.listen(), libraryId: 'lib', token: credential.token };
  const ids = { libraryId: 'lib', operationId: 'migration-copy' };
  const content = { library: [{ id: 'p', original: 'Entire prompt $& {{input}}', unknown: true,
    versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, original: `History ${n}` })) }],
    scratch: { pads: [{ id: 's', text: 'Entire Scratch note', future: [null, false] }], future: true } };
  let context;
  try {
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    let page = await context.newPage(); await boot(page, options);
    const second = await context.newPage(); await boot(second, options);
    await page.evaluate(content => {
      localStorage.setItem('pl2-library', JSON.stringify(content.library));
      localStorage.setItem('pl2-pads', JSON.stringify(content.scratch));
      localStorage.setItem('pl2-library-deleted:removed-id', '1');
      localStorage.setItem('pl2-provider-settings', '{"apiKey":"synthetic-excluded-secret"}');
      sessionStorage.setItem('pl2-draft-reset-recovery-v1', '{"raw":"first previous draft"}');
      buffers.register('editor', () => ({ raw: 'first unsaved draft' }));
    }, content);
    await second.evaluate(() => {
      sessionStorage.setItem('pl2-draft-reset-recovery-v1', '{"raw":"second previous draft"}');
      buffers.register('editor', () => ({ raw: 'second unsaved draft' }));
    });
    await page.evaluate(() => new Promise((done, reject) => {
      const request = indexedDB.open('prompt_lab_local', 1);
      request.onupgradeneeded = () => {
        for (const name of ['experiments', 'eval_runs', 'test_cases', 'runs']) {
          const store = request.result.createObjectStore(name, { keyPath: name === 'runs' ? 'run_id' : 'id' });
          store.put({ [name === 'runs' ? 'run_id' : 'id']: name, future: { raw: 'Complete record' } });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); done(); };
    }));
    if (scenario === 'backup transaction abort') {
      const failed = await page.evaluate(async ids => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.transaction.db.name === 'prompt_lab_library_migrations') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return original.apply(this, args);
        };
        try {
          await migration.prepare({ ...ids, sourceIdentity: 'disposable-origin', archives: { reviewed: true, records: [] } });
          return null;
        } catch (error) { return { code: error.code, message: error.message }; }
        finally { IDBObjectStore.prototype.put = original; }
      }, ids);
      expect(failed.code).toBe('MIGRATION_BACKUP_FAILED');
      expect(failed.message).toContain('Your current library is unchanged');
      expect((await adapter.read()).revision).toBe(null);
      expect(await page.evaluate(async ids => { try { await migration.read(ids.libraryId, ids.operationId); return null; } catch (e) { return e.code; } }, ids))
        .toBe('MIGRATION_BACKUP_MISSING');
      await page.evaluate(() => { durability.length = 0; });
    }
    const prepared = await page.evaluate(ids => migration.prepare({ ...ids, sourceIdentity: 'disposable-origin',
      archives: { reviewed: true, records: [{ name: 'Explicitly selected archive', future: true }] } }), ids);
    const originalBackup = await page.evaluate(ids => migration.read(ids.libraryId, ids.operationId), ids);
    expect(prepared.activationReady).toBe(false);
    expect((await adapter.read()).revision).toBe(null);
    expect(await page.evaluate(() => durability)).toEqual([{ database: 'prompt_lab_library_migrations', durability: 'strict' }]);
    expect(JSON.stringify(originalBackup)).not.toContain('synthetic-excluded-secret');
    const captureObjects = Object.values(originalBackup.sourceInventory.objects);
    const clients = captureObjects.find(item => item.data.id === 'client-buffers').data.records;
    expect(clients).toHaveLength(2);
    expect(clients.flatMap(client => client.buffers.filter(row => row.id === 'editor').map(row => row.value.raw)).sort())
      .toEqual(['first unsaved draft', 'second unsaved draft']);
    if (loss) {
      expect(await page.evaluate(async ids => {
        const { createAppLibraryMigration } = await import('/prompt-lab-extension/src/lib/libraryAppMigration.js');
        const original = transport.apply;
        transport.apply = async input => { await original(input); throw new Error('Synthetic lost response'); };
        const copying = createAppLibraryMigration({ transport });
        try { await copying.copy({ ...ids, reviewed: await copying.review(ids) }); return null; }
        catch (error) { return error.message; }
      }, ids)).toBe('Synthetic lost response');
    }
    await context.close();
    context = await chromium.launchPersistentContext(resolve(directory, 'browser'), { channel: 'chromium', headless: true });
    page = await context.newPage(); await boot(page, options);
    expect(await page.evaluate(ids => migration.read(ids.libraryId, ids.operationId), ids)).toEqual(originalBackup);
    const verified = await page.evaluate(async ({ ids, loss }) => loss ? migration.resume(ids)
      : migration.copy({ ...ids, reviewed: await migration.review(ids) }), { ids, loss });
    expect(verified.sourceReadbackVerified).toBe(true); expect(verified.activationReady).toBe(false);
    expect(verified.backupHash).toBe(prepared.backupHash);
    const reopened = await (await createFolderAdapter(resolve(directory, 'library'))).read();
    expect(Object.keys(reopened.operations)).toEqual(['migration-copy']);
    for (const [key, value] of Object.entries(originalBackup.sourceInventory.objects)) expect(reopened.objects[key]).toEqual(value);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')))).toEqual(content.library);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-pads')))).toEqual(content.scratch);
    expect((await page.evaluate(ids => migration.resume(ids), ids)).copiedRevision).toBe(verified.copiedRevision);
    expect(Object.keys((await adapter.read()).operations)).toHaveLength(1);
  } finally { await context?.close(); await api.close(); await rm(directory, { recursive: true, force: true }); }
});
