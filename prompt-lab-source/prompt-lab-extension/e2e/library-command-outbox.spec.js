import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryAdapter } from '../../library-storage/contract.mjs';
import { createLocalApi } from '../../library-storage/local-api.mjs';
import { captureSourceInventory } from '../../library-storage/source-inventory.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const storePath = '/prompt-lab-extension/src/lib/libraryCommandOutbox.js';
const modulePaths = [storePath, ...['command-client', 'command-outbox', 'contract', 'content-keys', 'edit-request', 'create-request', 'lifecycle-request', 'record-request', 'folder-request'].map(name => `/library-storage/${name}.mjs`)];
const content = { library: [{ id: 'prompt', original: 'Complete $& {{input}}', unknown: { preserved: true },
  versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, original: `Version ${n}` })) }],
  runs: Array.from({ length: 1002 }, (_, n) => ({ id: `r${n}`, output: `Run ${n}`, unknown: n })), backups: [{ name: 'Preserved' }] };
let server, origin;
test.use({ channel: 'chromium' });
test.beforeAll(async () => {
  const modules = new Map(await Promise.all(modulePaths.map(async path => [path, await readFile(resolve(sourceRoot, path.slice(1)))])));
  server = createServer((req, res) => {
    const body = req.url === '/' ? '<!doctype html><title>Disposable pending command acceptance</title>' : modules.get(req.url);
    res.writeHead(body ? 200 : 404, { 'Content-Type': req.url === '/' ? 'text/html' : 'text/javascript' }); res.end(body ?? 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

async function fixture() {
  const credential = { token: 'disposable-browser-credential-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 };
  const adapter = createMemoryAdapter(), api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const baseUrl = await api.listen();
  const request = { libraryId: 'lib', expectedRevision: null, mode: 'snapshot', sourceText: JSON.stringify(content) };
  const review = await api.service.preview(request);
  return { api, adapter, credential, options: { baseUrl, libraryId: 'lib', token: credential.token }, args: { request, review, operationId: 'operation' } };
}
async function boot(page, options) {
  await page.goto(origin);
  await page.evaluate(async ({ options, storePath }) => {
    const { createIndexedCommandStore } = await import(storePath);
    const { createCommandOutbox } = await import('/library-storage/command-outbox.mjs');
    const { createLoopbackTransport } = await import('/library-storage/command-client.mjs');
    window.store = createIndexedCommandStore(); window.outbox = createCommandOutbox(store);
    window.transport = createLoopbackTransport({ ...options, getToken: () => options.token });
    window.durability = [];
    const transact = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = transact.apply(this, args);
      if (this.name === 'prompt_lab_command_outbox' && args[1] === 'readwrite') durability.push(transaction.durability);
      return transaction;
    };
  }, { options, storePath });
}

const valueCases = {
  'draft-update': { domain: 'drafts', action: 'update', field: 'draft' },
  'asset-create': { domain: 'assets', action: 'create', value: ['Complete record', { unknown: true }] },
  'recovery-replace': { domain: 'recovery', action: 'replace', value: 'Complete record' },
  'loaded-pack-delete': { domain: 'loaded-packs', action: 'delete' },
};
for (const mode of ['edit', 'create', 'trash', 'restore', 'delete', 'record-create', 'record-update', 'record-delete', 'pack-create', 'pack-update', 'pack-delete', ...Object.keys(valueCases)]) test(`an ordinary ${mode} command survives browser restart and commits through the shared API once`, async () => {
  const credential = { token: 'disposable-edit-browser-token-'.repeat(2), scopes: ['read', 'write'], expiresAt: Date.now() + 60_000 };
  const adapter = createMemoryAdapter(), api = createLocalApi({ adapter, libraryId: 'lib', credentials: [credential], allowedOrigins: [origin] });
  const baseUrl = await api.listen(), options = { baseUrl, libraryId: 'lib', token: credential.token };
  const profile = await mkdtemp(resolve(tmpdir(), 'promptlab-edit-outbox-')); let context;
  try {
    const lifecycle = ['trash', 'restore', 'delete'].includes(mode), initiallyTrashed = ['restore', 'delete'].includes(mode);
    const valueCase = valueCases[mode], pack = mode.startsWith('pack-'), recordDomain = valueCase?.domain ?? (pack ? 'packs' : 'evaluations');
    const recordAction = valueCase?.action ?? (pack ? mode.slice(5) : mode.startsWith('record-') ? mode.slice(7) : null);
    const field = valueCase?.field ?? (pack ? 'title' : 'output');
    const workspace = { ...content, packs: { p0: { id: 'p0', title: 'Before', unknown: 0 } }, loadedPacks: ['p0'], assets: { art: 'Existing artwork' }, library: initiallyTrashed ? [] : content.library, trash: initiallyTrashed ? content.library : [], runs: content.runs.slice(0, 1) };
    const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': JSON.stringify(workspace.trash),
      'pl2-session-pl2-session': JSON.stringify({ draft: 'Before', unknown: 0 }), 'pl2-draft-reset-recovery-v1': JSON.stringify('Recovery before') };
    const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'synthetic-browser-origin',
      localStorage: { length: Object.keys(entries).length, key: n => Object.keys(entries)[n], getItem: key => entries[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic absent store.' }), archives: { reviewed: true, records: [] } });
    const imported = await api.service.preview({ libraryId: 'lib', expectedRevision: null, sourceText: JSON.stringify(workspace), sourceInventory, mode: 'import' });
    const importedReceipt = await api.service.apply({ ...imported, idempotencyKey: 'import' });
    const selected = await api.service.previewCurrentView({ libraryId: 'lib', expectedRevision: importedReceipt.revision });
    const selectedReceipt = await api.service.apply({ ...selected, idempotencyKey: 'select' });
    const records = await api.service.currentRecords({ libraryId: 'lib', expectedRevision: selectedReceipt.revision, domain: recordAction ? recordDomain : initiallyTrashed ? 'trash' : 'prompts' });
    const row = records.items[0], group = records.groups.find(group => group.selected === row.key);
    const request = recordAction ? { libraryId: 'lib', expectedRevision: selectedReceipt.revision, domain: recordDomain, action: recordAction,
      changedAt: '2026-10-29T12:00:00.000Z', mode: 'record', ...(recordAction === 'create'
        ? { sourceBinding: imported.sourceBinding, ...(valueCase ? { recordId: 'created-record', record: valueCase.value }
          : { record: { id: 'created-record', [field]: 'Complete record', unknown: 0 } }) }
        : { groupId: group.id, expectedRecordHash: row.valueHash, ...(recordAction === 'delete' ? { confirmPermanentDeletion: true }
          : recordAction === 'replace' ? { value: valueCase.value } : { updates: [{ path: [field], value: 'Complete record' }] }) }) }
      : lifecycle ? { libraryId: 'lib', expectedRevision: selectedReceipt.revision, groupId: group.id, expectedRecordHash: row.valueHash,
      action: mode, changedAt: '2026-10-29T12:00:00.000Z', confirmPermanentDeletion: mode === 'delete', mode: 'lifecycle' } : mode === 'create' ? { libraryId: 'lib', expectedRevision: selectedReceipt.revision, sourceBinding: imported.sourceBinding,
      creationId: 'browser-created', createdAt: '2026-10-29T12:00:00.000Z', record: { original: 'Browser creation with $& {{input}}', unknown: { preserved: true } }, mode }
      : { libraryId: 'lib', expectedRevision: selectedReceipt.revision, groupId: group.id, expectedRecordHash: row.valueHash,
      editedAt: '2026-10-29T12:00:00.000Z', updates: [{ path: ['original'], value: 'Browser edit with $& {{input}}' }], mode: 'edit' };
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
    let page = await context.newPage(); await boot(page, options);
    const queued = await page.evaluate(async request => outbox.enqueue({ request, review: await transport.preview(request), operationId: 'browser-edit' }), request);
    expect(queued.state).toBe('pending'); expect(await page.evaluate(() => durability)).toEqual(['strict']);
    await context.close(); context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
    page = await context.newPage(); await boot(page, options);
    expect((await page.evaluate(() => outbox.read('lib', 'browser-edit'))).request).toEqual(request);
    const committed = await page.evaluate(() => outbox.replay('lib', 'browser-edit', transport));
    expect(committed.state).toBe('committed');
    expect(await page.evaluate(() => outbox.replay('lib', 'browser-edit', transport))).toEqual(committed);
    if (recordAction) {
      const current = await api.service.currentRecords({ libraryId: 'lib', expectedRevision: committed.receipt.revision, domain: recordDomain });
      expect(current.total).toBe(recordAction === 'create' ? 2 : recordAction === 'delete' ? 0 : 1);
      if (recordAction !== 'delete') {
        const result = current.items.find(item => item.sourceId === (recordAction === 'create' ? 'created-record' : row.sourceId));
        if (valueCase && ['create', 'replace'].includes(recordAction)) expect(result.value).toEqual(valueCase.value);
        else { expect(result.value[field]).toBe('Complete record'); expect(result.value.unknown).toBe(0); }
      }
      const prompts = await api.service.currentRecords({ libraryId: 'lib', expectedRevision: committed.receipt.revision, domain: 'prompts' });
      expect(prompts.items[0].value).toEqual(content.library[0]);
      expect(Object.keys((await adapter.read()).operations)).toHaveLength(3);
      return;
    }
    const current = await api.service.currentRecords({ libraryId: 'lib', expectedRevision: committed.receipt.revision, domain: mode === 'trash' ? 'trash' : 'prompts' });
    const result = mode === 'create' ? current.items.find(item => item.sourceId !== 'prompt') : current.items[0];
    expect(current.total).toBe(mode === 'delete' ? 0 : mode === 'create' ? 2 : 1);
    if (mode !== 'delete') {
      expect(result.value.original).toBe(mode === 'create' ? 'Browser creation with $& {{input}}' : mode === 'edit' ? 'Browser edit with $& {{input}}' : content.library[0].original);
      expect(result.value.versions).toHaveLength(mode === 'create' ? 0 : mode === 'edit' ? 42 : 41);
      expect(result.value.unknown).toEqual(content.library[0].unknown);
    }
    if (lifecycle) {
      const other = await api.service.currentRecords({ libraryId: 'lib', expectedRevision: committed.receipt.revision, domain: mode === 'trash' ? 'prompts' : 'trash' });
      expect(other.total).toBe(0);
    }
    if (mode === 'create') expect(current.items.find(item => item.sourceId === 'prompt').value).toEqual(workspace.library[0]);
    expect(Object.keys((await adapter.read()).operations)).toHaveLength(3);
  } finally { await context?.close(); await api.close(); await rm(profile, { recursive: true, force: true }); }
});

test('complete commands and receipts survive separate browser processes and lost responses', async () => {
  const f = await fixture(), profile = await mkdtemp(resolve(tmpdir(), 'promptlab-outbox-'));
  let context;
  const reopen = async () => {
    await context?.close();
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
    const page = await context.newPage(); await boot(page, f.options); return page;
  };
  try {
    let page = await reopen();
    expect((await page.evaluate(args => outbox.enqueue(args), f.args)).state).toBe('pending');
    expect(await page.evaluate(() => durability)).toEqual(['strict']);
    expect((await f.adapter.read()).revision).toBeNull();
    page = await reopen();
    expect(JSON.parse((await page.evaluate(() => outbox.read('lib', 'operation'))).request.sourceText)).toEqual(content);
    expect(await page.evaluate(async () => {
      const lostResponse = { ...transport, apply: async input => { await transport.apply(input); throw new Error('Synthetic response loss after commit'); } };
      try { await outbox.replay('lib', 'operation', lostResponse); } catch { return (await outbox.read('lib', 'operation')).state; }
    })).toBe('failed');
    const committed = await f.adapter.read();
    page = await reopen();
    const recovered = await page.evaluate(() => outbox.replay('lib', 'operation', transport));
    expect(recovered.state).toBe('committed'); expect(recovered.receipt.revision).toBe(committed.revision);
    expect(await f.adapter.read()).toEqual(committed);
    expect(JSON.stringify(recovered)).not.toContain(f.credential.token);
    page = await reopen();
    expect(await page.evaluate(() => outbox.read('lib', 'operation'))).toEqual(recovered);
    expect(Object.keys(committed.operations)).toHaveLength(1);
  } finally { await context?.close(); await f.api.close(); await rm(profile, { recursive: true, force: true }); }
});

test('aborted IndexedDB command and receipt transactions remain recoverable', async ({ page }) => {
  const f = await fixture();
  try {
    await boot(page, f.options);
    await page.evaluate(() => {
      window.abortNext = true;
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        const result = put.apply(this, args);
        if (this.transaction.db.name === 'prompt_lab_command_outbox' && window.abortNext) { window.abortNext = false; this.transaction.abort(); }
        return result;
      };
    });
    expect(await page.evaluate(async args => { try { await outbox.enqueue(args); } catch (e) { return e.code; } }, f.args)).toBe('OUTBOX_WRITE_FAILED');
    expect(await page.evaluate(() => outbox.list('lib'))).toEqual([]);
    expect((await f.adapter.read()).revision).toBeNull();
    await page.evaluate(args => outbox.enqueue(args), f.args);
    await page.evaluate(() => { window.abortNext = true; });
    expect(await page.evaluate(async () => { try { await outbox.replay('lib', 'operation', transport); } catch (e) { return e.code; } })).toBe('OUTBOX_WRITE_FAILED');
    const committed = await f.adapter.read(); expect(committed.revision).not.toBeNull();
    await page.reload(); await boot(page, f.options);
    expect((await page.evaluate(() => outbox.replay('lib', 'operation', transport))).state).toBe('committed');
    expect(await f.adapter.read()).toEqual(committed);
  } finally { await f.api.close(); }
});

test('two windows share one durable identity and revoked access retains the command', async ({ page, context }) => {
  const f = await fixture();
  try {
    await boot(page, f.options); const other = await context.newPage(); await boot(other, f.options);
    const queued = await Promise.all([page.evaluate(args => outbox.enqueue(args), f.args), other.evaluate(args => outbox.enqueue(args), f.args)]);
    expect(queued[0]).toEqual(queued[1]); f.credential.revoked = true;
    expect(await page.evaluate(async () => { try { await outbox.replay('lib', 'operation', transport); } catch (e) { return e.code; } })).toBe('UNAUTHORIZED');
    expect((await f.adapter.read()).revision).toBeNull();
    expect(JSON.parse((await other.evaluate(() => outbox.read('lib', 'operation'))).request.sourceText)).toEqual(content);
    f.credential.revoked = false;
    const saved = await Promise.all([page.evaluate(() => outbox.replay('lib', 'operation', transport)), other.evaluate(() => outbox.replay('lib', 'operation', transport))]);
    expect(saved[0].receipt).toEqual(saved[1].receipt); expect(Object.keys((await f.adapter.read()).operations)).toHaveLength(1);
  } finally { await f.api.close(); }
});

test('unavailable, newer-format and corrupt storage fails closed without deleting data', async ({ page }) => {
  const f = await fixture();
  try {
    await boot(page, f.options); await page.evaluate(args => outbox.enqueue(args), f.args);
    const result = await page.evaluate(async storePath => {
      const { createIndexedCommandStore } = await import(storePath);
      const failed = async fn => { try { await fn(); } catch (e) { return e.code; } };
      const unavailable = await failed(() => createIndexedCommandStore({ indexedDB: null }).list('lib'));
      const original = await store.read('lib', 'operation'), corrupt = { ...original, sourceHash: 'corrupt' };
      await store.write(corrupt, original.version);
      const corruption = await failed(() => outbox.read('lib', 'operation'));
      const retained = await store.read('lib', 'operation');
      await store.close();
      await new Promise((resolve, reject) => { const r = indexedDB.open('prompt_lab_command_outbox', 2); r.onerror = () => reject(r.error); r.onsuccess = () => { r.result.close(); resolve(); }; });
      const newer = await failed(() => createIndexedCommandStore().list('lib'));
      const readback = await new Promise((resolve, reject) => { const r = indexedDB.open('prompt_lab_command_outbox', 2); r.onerror = () => reject(r.error); r.onsuccess = () => {
        const db = r.result, tx = db.transaction('commands'), get = tx.objectStore('commands').get(['lib', 'operation']);
        tx.oncomplete = () => { db.close(); resolve(get.result); };
      }; });
      return { unavailable, corruption, newer, retained, readback };
    }, storePath);
    expect(result.unavailable).toBe('OUTBOX_UNAVAILABLE'); expect(result.corruption).toBe('OUTBOX_CORRUPT'); expect(result.newer).toBe('OUTBOX_UNAVAILABLE');
    expect(result.readback).toEqual(result.retained); expect(result.retained.sourceHash).toBe('corrupt');
    expect((await f.adapter.read()).revision).toBeNull();
  } finally { await f.api.close(); }
});
