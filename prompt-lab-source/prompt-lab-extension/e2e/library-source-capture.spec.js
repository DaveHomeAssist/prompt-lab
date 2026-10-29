import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readerPath = '/prompt-lab-extension/src/lib/librarySourceCapture.js';
const inventoryPath = '/library-storage/source-inventory.mjs';
const modulePaths = [readerPath, inventoryPath, '/library-storage/contract.mjs'];
let server, origin;
test.use({ channel: 'chromium' });

test.beforeAll(async () => {
  const modules = new Map(await Promise.all(modulePaths.map(async path => [path, await readFile(resolve(sourceRoot, path.slice(1)))])));
  server = createServer((request, response) => {
    const body = request.url === '/' ? '<!doctype html><title>Disposable source capture test</title>' : modules.get(request.url);
    response.writeHead(body ? 200 : 404, { 'Content-Type': request.url === '/' ? 'text/html' : 'text/javascript' });
    response.end(body ?? 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  server?.closeAllConnections();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});

test.beforeEach(async ({ page }) => {
  await page.goto(origin);
  await page.evaluate(async ({ readerPath, inventoryPath }) => {
    window.reader = await import(readerPath);
    window.inventory = await import(inventoryPath);
    window.seed = (name, version, stores) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => {
        for (const [name, rows] of Object.entries(stores)) {
          const store = request.result.createObjectStore(name);
          rows.forEach((row, n) => store.put(row, `raw-key-${n}`));
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
  }, { readerPath, inventoryPath });
});

test('capture in a new origin never creates databases or reads unselected values', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const opened = [], valuesRead = [];
    const originalOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { opened.push(args); return originalOpen(...args); };
    localStorage.setItem('pl2-provider-settings', 'synthetic private settings');
    localStorage.setItem('__clerk_client_jwt', 'synthetic credential');
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function(key) { valuesRead.push(key); return get.call(this, key); };
    const raw = await reader.captureAppLibrarySources({ sourceIdentity: 'empty-web', archives: { reviewed: true, records: [] } });
    const { manifest } = await inventory.inspectSourceInventory(raw);
    return { opened, valuesRead, databases: await indexedDB.databases(), complete: manifest.sourceReadComplete,
      activation: manifest.activationReady, absent: manifest.sources.filter(source => source.state === 'absent').length,
      copiedSecret: JSON.stringify(raw).includes('synthetic credential') };
  });
  expect(result.opened).toEqual([]);
  expect(result.databases).toEqual([]);
  expect(result.valuesRead).not.toContain('pl2-provider-settings');
  expect(result.valuesRead).not.toContain('__clerk_client_jwt');
  expect(result.copiedSecret).toBe(false);
  expect(result.complete).toBe(true);
  expect(result.activation).toBe(false);
  expect(result.absent).toBe(4);
});

test('raw app reader preserves all rows, primary keys, histories and both deletion replicas', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const library = JSON.stringify([{ id: 'p', future: { asset: 'data:image/png;base64,AA==' }, versions: Array.from({ length: 41 }, (_, n) => ({ id: `v${n}`, unknown: n })) }]);
    localStorage.setItem('pl2-library', library);
    localStorage.setItem('pl2-library-deleted:p', '1');
    localStorage.setItem('pl2-library-deleted-batch:malformed', '{broken');
    localStorage.setItem('pl2-library-clear:0000000000000007:abc', '1');
    localStorage.setItem('pl2-pad', 'legacy $& {{input}}');
    localStorage.setItem('pl2-scratch-journal-revision', '12');
    const artwork = JSON.stringify(Array.from({ length: 20 }, (_, n) => ({ image: `data:image/png;base64,AA${n}==`, unknown: n })));
    localStorage.setItem('pl2-recent-artwork', artwork);
    localStorage.setItem('pl2-run-fallback', '[{"unmatched":true}]');
    const stores = {
      experiments: [{ id: 'e', unknown: [1, null] }], eval_runs: [{ id: 'r', promptVersionId: 'missing' }],
      test_cases: [{ id: 't', expectedTraits: ['exact'], unknown: { a: 1 } }],
      runs: Array.from({ length: 1002 }, (_, n) => ({ run_id: `r${n}`, trace_id: 'trace', unknown: n })),
    };
    const journal = [{ id: 'library', revision: 9, entries: { 'pl2-library': '[]', 'pl2-library-deleted:journal-only': '1' }, future: true },
      { id: 'scratch', revision: 12, entries: { 'pl2-pads': '{"pads":[{"id":"s","content":"durable note"}]}' }, unknown: true }];
    await seed('prompt_lab_local', 4, stores);
    await seed('prompt_lab_durable', 1, { journal });
    const modes = [], originalTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args) { modes.push(args[1]); return originalTx.apply(this, args); };
    const raw = await reader.captureAppLibrarySources({ sourceIdentity: 'synthetic-desktop', archives: { reviewed: true, records: [] } }, {
      window: { __TAURI_INTERNALS__: {} }, indexedDB, localStorage,
    });
    const { manifest, captures } = await inventory.inspectSourceInventory(raw);
    const local = captures['local-content'].entries;
    const exact = [['experiments', 'experiments'], ['evaluations', 'eval_runs'], ['test-cases', 'test_cases'], ['execution-traces', 'runs']]
      .every(([id, store]) => {
        // Cursors return primary-key order, not insertion order.
        const expected = stores[store].map((value, n) => ({ value, key: `raw-key-${n}` })).sort((a, b) => a.key < b.key ? -1 : 1);
        return JSON.stringify(captures[id].records) === JSON.stringify(expected.map(row => row.value))
          && JSON.stringify(captures[id].primaryKeys) === JSON.stringify(expected.map(row => row.key));
      });
    return { modes, exact, complete: manifest.sourceReadComplete, activation: manifest.activationReady,
      journalExact: JSON.stringify(captures['durable-journal'].records) === JSON.stringify(journal),
      libraryExact: local['pl2-library'] === library && localStorage.getItem('pl2-library') === library,
      deleted: local['pl2-library-deleted:p'], malformed: local['pl2-library-deleted-batch:malformed'],
      clear: local['pl2-library-clear:0000000000000007:abc'], legacy: local['pl2-pad'],
      artworkExact: local['pl2-recent-artwork'] === artwork, scratchRevision: local['pl2-scratch-journal-revision'], traceCount: captures['execution-traces'].records.length, keyPath: captures['execution-traces'].keyPath,
      version: captures['execution-traces'].databaseVersion };
  });
  expect(result).toEqual({ modes: Array(5).fill('readonly'), exact: true, complete: true, activation: false,
    journalExact: true, libraryExact: true, deleted: '1', malformed: '{broken', clear: '1', legacy: 'legacy $& {{input}}',
    artworkExact: true, scratchRevision: '12', traceCount: 1002, keyPath: null, version: 4 });
});

test('an old database is inspected without upgrading or creating its missing stores', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await seed('prompt_lab_local', 1, { experiments: [{ id: 'legacy', unknown: true }] });
    const { captures } = await inventory.inspectSourceInventory(await reader.captureAppLibrarySources({ sourceIdentity: 'old-web' }));
    return { legacy: captures.experiments.records, missing: captures.evaluations, databases: await indexedDB.databases() };
  });
  expect(result.legacy).toEqual([{ id: 'legacy', unknown: true }]);
  expect(result.missing.state).toBe('absent');
  expect(result.missing.databaseVersion).toBe(1);
  expect(result.databases).toEqual([{ name: 'prompt_lab_local', version: 1 }]);
});

test('a deletion race aborts database creation and reports source changed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await seed('prompt_lab_local', 4, { runs: [{ run_id: 'one' }] });
    let code;
    const idb = {
      databases: async () => {
        const list = await indexedDB.databases();
        await new Promise((resolve, reject) => {
          const request = indexedDB.deleteDatabase('prompt_lab_local');
          request.onsuccess = resolve; request.onerror = () => reject(request.error);
        });
        return list;
      }, open: indexedDB.open.bind(indexedDB),
    };
    try { await reader.readExistingIndexedSource({ database: 'prompt_lab_local', store: 'runs' }, { idb }); } catch (error) { code = error.code; }
    return { code, databases: await indexedDB.databases() };
  });
  expect(result).toEqual({ code: 'SOURCE_CHANGED', databases: [] });
});

test('an aborted cursor read never returns a partial successful inventory', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await seed('prompt_lab_local', 4, { runs: Array.from({ length: 1002 }, (_, n) => ({ run_id: `r${n}` })) });
    const original = IDBDatabase.prototype.transaction;
    let rowsObserved = 0;
    IDBDatabase.prototype.transaction = function(...args) {
      const tx = original.apply(this, args), objectStore = tx.objectStore.bind(tx);
      tx.objectStore = name => {
        const store = objectStore(name), cursor = store.openCursor.bind(store);
        store.openCursor = (...args) => {
          const request = cursor(...args);
          request.addEventListener('success', () => { if (request.result && ++rowsObserved === 1) queueMicrotask(() => tx.abort()); }, { once: true });
          return request;
        };
        return store;
      };
      return tx;
    };
    const raw = await reader.captureAppLibrarySources({ sourceIdentity: 'abort-web', archives: { reviewed: true, records: [] } });
    const { manifest } = await inventory.inspectSourceInventory(raw);
    const source = manifest.sources.find(source => source.id === 'execution-traces');
    return { rowsObserved, source, complete: manifest.sourceReadComplete, partialArchived: Object.values(raw.objects).some(object => object.data.id === 'execution-traces') };
  });
  expect(result.rowsObserved).toBeGreaterThan(0);
  expect(result.source.state).toBe('unavailable');
  expect(result.complete).toBe(false);
  expect(result.partialArchived).toBe(false);
});

test('unsupported structured values remain in the original database and are not coerced', async ({ page }) => {
  const result = await page.evaluate(async () => {
    await seed('prompt_lab_local', 4, { runs: [{ run_id: 'blob', asset: new Blob(['original bytes']) }] });
    const raw = await reader.captureAppLibrarySources({ sourceIdentity: 'blob-web' });
    const source = raw.manifest.sources.find(source => source.id === 'execution-traces');
    const preserved = await new Promise((resolve, reject) => {
      const request = indexedDB.open('prompt_lab_local');
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('runs', 'readonly'), get = tx.objectStore('runs').get('raw-key-0');
        get.onsuccess = async () => resolve(await get.result.asset.text());
        tx.oncomplete = () => db.close();
      };
      request.onerror = () => reject(request.error);
    });
    return { source, preserved };
  });
  expect(result.source.state).toBe('unavailable');
  expect(result.source.code).toBe('INVALID_JSON');
  expect(result.preserved).toBe('original bytes');
});

test('real extension session API captures only editor drafts and leaves credentials untouched', async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), 'promptlab-source-extension-'));
  let context;
  try {
    for (const path of modulePaths) {
      const destination = resolve(fixture, path.slice(1));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readFile(resolve(sourceRoot, path.slice(1))));
    }
    await writeFile(resolve(fixture, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'Disposable source capture', version: '1.0', permissions: ['storage'], background: { service_worker: 'worker.js' } }));
    await writeFile(resolve(fixture, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    await writeFile(resolve(fixture, 'capture.html'), '<!doctype html><title>Disposable capture</title>');
    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`] });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/capture.html`);
    const result = await page.evaluate(async ({ readerPath, inventoryPath }) => {
      const reader = await import(readerPath), inventory = await import(inventoryPath);
      const { canonical } = await import('/library-storage/contract.mjs');
      const original = { 'pl2-session': { raw: 'editor', future: { preserved: true } }, 'pl2-dual-draft': { raw: 'dual' }, 'authToken': 'synthetic private session' };
      await chrome.storage.session.set(original);
      const get = chrome.storage.session.get.bind(chrome.storage.session), requested = [];
      chrome.storage.session.get = (keys, callback) => { requested.push(keys); return get(keys, callback); };
      const raw = await reader.captureAppLibrarySources({ sourceIdentity: 'test-extension', archives: { reviewed: true, records: [] } });
      const { manifest, captures } = await inventory.inspectSourceInventory(raw);
      return { surface: manifest.surface, complete: manifest.sourceReadComplete, requested,
        entries: captures['extension-drafts'].entries, unchanged: canonical(await get(null)) === canonical(original),
        copiedPrivate: JSON.stringify(raw).includes('synthetic private session') };
    }, { readerPath, inventoryPath });
    expect(result.surface).toBe('extension');
    expect(result.complete).toBe(true);
    expect(result.requested).toEqual([['pl2-session', 'pl2-dual-draft']]);
    expect(result.entries).toEqual({ 'pl2-session': { raw: 'editor', future: { preserved: true } }, 'pl2-dual-draft': { raw: 'dual' } });
    expect(result.unchanged).toBe(true);
    expect(result.copiedPrivate).toBe(false);
  } finally {
    await context?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
