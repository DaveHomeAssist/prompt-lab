import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const readerPath = '/prompt-lab-extension/src/lib/librarySourceCapture.js';
const inventoryPath = '/library-storage/source-inventory.mjs';
const modulePaths = [readerPath, inventoryPath, '/library-storage/contract.mjs', '/library-storage/content-keys.mjs',
  ...['lib/libraryWriteCoordinator.js', 'lib/libraryOriginCapture.js', 'lib/libraryEditBuffers.js', 'lib/draftRecoveryCapture.js', 'lib/storage.js', 'lib/libraryDeletion.js', 'lib/libraryJournal.js',
    'lib/scratchJournal.js', 'lib/writeRecovery.js', 'lib/appRecordVersion.js', 'experimentStore.js', 'lib/logger.js', 'lib/diagnostics.js',
    'constants.js', 'lib/evalSchema.js', 'lib/enhancementResult.js', 'lib/tagSchema.js', 'lib/utils.js',
    'lib/sourceLink.js', 'lib/platform.js', 'lib/providerFixture.js'].map(path => `/prompt-lab-extension/src/${path}`)];
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

async function joinCapture(page, label) {
  await page.goto(origin);
  await page.evaluate(async label => {
    window.reader = await import('/prompt-lab-extension/src/lib/librarySourceCapture.js');
    window.inventory = await import('/library-storage/source-inventory.mjs');
    window.editBuffers = (await import('/prompt-lab-extension/src/lib/libraryEditBuffers.js')).libraryEditBuffers;
    window.writeCoordinator = (await import('/prompt-lab-extension/src/lib/libraryWriteCoordinator.js')).libraryWriteCoordinator;
    window.participant = await (await import('/prompt-lab-extension/src/lib/libraryOriginCapture.js')).startAppCaptureParticipant();
    window.draft = { text: label, future: ['$&', '{{input}}'] };
    editBuffers.register('editor', () => window.draft);
    const { DRAFT_RECOVERY_STORAGE_KEY } = await import('/prompt-lab-extension/src/lib/draftRecoveryCapture.js');
    sessionStorage.setItem(DRAFT_RECOVERY_STORAGE_KEY, JSON.stringify({ editor: { raw: label + ' previous' }, future: [null, false] }));
  }, label);
}

test('startup captures raw session recovery before an editor mounts and restart does not duplicate registration', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { startAppCaptureParticipant } = await import('/prompt-lab-extension/src/lib/libraryOriginCapture.js');
    const { libraryEditBuffers } = await import('/prompt-lab-extension/src/lib/libraryEditBuffers.js');
    const raw = '{"editor":{"raw":"raw interrupted draft"},';
    sessionStorage.setItem('pl2-draft-reset-recovery-v1', raw);
    const first = await startAppCaptureParticipant();
    const same = await startAppCaptureParticipant();
    const captured = await first.capture(({ clientBuffers }) => clientBuffers);
    await first.stop();
    const stopped = libraryEditBuffers.read();
    const second = await startAppCaptureParticipant();
    await first.stop();
    const restarted = await second.capture(({ clientBuffers }) => clientBuffers);
    const stillSecond = (await startAppCaptureParticipant()).clientId === second.clientId;
    await second.stop();
    return { same: first.clientId === same.clientId, captured: captured.value, stopped, restarted: restarted.value, stillSecond, raw };
  });
  expect(result.same).toBe(true);
  expect(result.stillSecond).toBe(true);
  expect(result.stopped).toEqual([]);
  for (const clients of [result.captured, result.restarted]) {
    expect(clients).toHaveLength(1);
    expect(clients[0].buffers).toEqual([{ id: 'draft-recovery-store', value: {
      storage: 'sessionStorage', entries: { 'pl2-draft-reset-recovery-v1': result.raw },
    } }]);
  }
});

test('actual app stores retain complete records across database reopen', async ({ page }) => {
  await page.evaluate(async () => {
    const store = await import('/prompt-lab-extension/src/experimentStore.js');
    const text = 'Complete retained text. '.repeat(1200);
    await store.saveEvalRun({ id: 'complete-run', input: text, output: text, notes: text,
      future: { nested: [null, false, 0, 'retained'] },
      candidates: Array.from({ length: 24 }, (_, i) => ({ id: `c${i}`, content: text, future: i })),
      selectedCandidateId: 'c23', usage: { input: 1, output: 2, total: 3, future: 7 } });
    await store.saveTestCase({ id: 'complete-case', promptId: 'p', input: text, notes: text,
      expectedTraits: Array.from({ length: 24 }, (_, i) => `Trait ${i}`), future: ['retained'] });
    await store.saveExperiment({ id: 'complete-experiment', keyInputSnapshot: text, future: 7 });
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const store = await import('/prompt-lab-extension/src/experimentStore.js');
    return { run: await store.getEvalRunById('complete-run'),
      cases: await store.listTestCases({ limit: null }), experiment: await store.getExperimentById('complete-experiment'),
      fallbackKeys: Object.keys(localStorage).filter(key => key.endsWith('-fallback')) };
  });
  const text = 'Complete retained text. '.repeat(1200);
  expect(result.fallbackKeys).toEqual([]);
  expect(result.run).toMatchObject({ input: text, output: text, notes: text, selectedCandidateId: 'c23',
    future: { nested: [null, false, 0, 'retained'] }, usage: { future: 7 } });
  expect(result.run.candidates).toHaveLength(24);
  expect(result.run.candidates[23]).toMatchObject({ id: 'c23', content: text, future: 23 });
  expect(result.cases[0]).toMatchObject({ input: text, notes: text, future: ['retained'] });
  expect(result.cases[0].expectedTraits).toHaveLength(24);
  expect(result.experiment).toMatchObject({ keyInputSnapshot: text, future: 7 });
});

test('two actual windows retain separate unsaved buffers, pause timers and drain real writes', async ({ page, context }) => {
  const other = await context.newPage();
  await joinCapture(page, 'First unsaved draft'); await joinCapture(other, 'Second unsaved draft');
  await other.evaluate(async () => {
    const { writeWithRecovery } = await import('/prompt-lab-extension/src/lib/writeRecovery.js');
    const { saveRunRecord } = await import('/prompt-lab-extension/src/experimentStore.js');
    window.pending = writeWithRecovery('held', () => new Promise(resolve => setTimeout(resolve, 80)));
    window.saved = saveRunRecord({ run_id: 'actual-record', trace_id: 'trace' });
    window.autosaves = 0;
    editBuffers.schedule(() => ++window.autosaves, 250);
  });
  const result = await page.evaluate(async () => {
    const report = await participant.capture(async ({ clientBuffers }) => {
      const captured = await reader.captureAppLibrarySources({ sourceIdentity: 'origin', archives: { reviewed: true, records: [] }, clientBuffers });
      await new Promise(resolve => setTimeout(resolve, 300));
      return captured;
    });
    const inspected = await inventory.inspectSourceInventory(report.value);
    return { clients: inspected.captures['client-buffers'].records,
      records: inspected.captures['execution-traces'].records, coordination: report.coordination, version: report.value.manifest.schemaVersion };
  });
  expect(result.clients.map(client => client.buffers.find(row => row.id === 'editor').value.text).sort()).toEqual(['First unsaved draft', 'Second unsaved draft']);
  expect(result.clients.map(client => JSON.parse(client.buffers.find(row => row.id === 'draft-recovery-store')
    .value.entries['pl2-draft-reset-recovery-v1']).editor.raw).sort()).toEqual(['First unsaved draft previous', 'Second unsaved draft previous']);
  expect(result.records).toEqual([{ run_id: 'actual-record', trace_id: 'trace' }]);
  expect(result.version).toBe(4);
  expect(result.coordination).toMatchObject({ scope: 'cooperating-origin-clients', activationReady: false });
  expect(result.coordination.clientIds).toHaveLength(2);
  expect(await other.evaluate(() => window.autosaves)).toBe(0);
  await expect.poll(() => other.evaluate(() => window.autosaves)).toBe(1);
  const again = await page.evaluate(() => reader.captureAppLibrarySourcesWithOriginDrain({ sourceIdentity: 'again', archives: { reviewed: true, records: [] } }));
  expect(again.inventory.manifest.sourceReadComplete).toBe(true);
  await other.close();
});

test('a new window waits at startup until the existing capture releases membership', async ({ page, context }) => {
  await joinCapture(page, 'Existing');
  await page.evaluate(() => {
    window.capturing = participant.capture(() => new Promise(resolve => { window.releaseCapture = resolve; }));
  });
  await page.waitForFunction(() => window.releaseCapture);
  const other = await context.newPage(); await other.goto(origin);
  const joining = other.evaluate(async () => {
    window.started = false;
    window.participant = await (await import('/prompt-lab-extension/src/lib/libraryOriginCapture.js')).startAppCaptureParticipant();
    window.started = true;
  });
  await expect.poll(() => other.evaluate(() => window.started)).toBe(false);
  await page.evaluate(async () => { window.releaseCapture('snapshot'); await window.capturing; });
  await joining;
  expect(await other.evaluate(() => window.started)).toBe(true);
  await other.close();
});

test('a changed peer buffer or refused peer save rejects capture and a clean retry succeeds', async ({ page, context }) => {
  const other = await context.newPage(); await joinCapture(page, 'First'); await joinCapture(other, 'Second');
  for (const mode of ['buffer', 'write', 'recovery-store']) {
    await page.evaluate(() => {
      window.releaseCapture = null;
      window.capturing = participant.capture(() => new Promise(resolve => { window.releaseCapture = resolve; }), { timeoutMs: 1000 }).catch(error => error.code);
    });
    await page.waitForFunction(() => window.releaseCapture);
    await other.evaluate(async mode => {
      if (mode === 'buffer') window.draft = { ...window.draft, text: 'Changed while capturing' };
      else if (mode === 'recovery-store') sessionStorage.setItem('pl2-draft-reset-recovery-v1', '{"raw":"changed recovery"}');
      else (await import('/prompt-lab-extension/src/lib/storage.js')).saveJson('pl2-library', [{ id: 'refused' }]);
    }, mode);
    expect(await page.evaluate(async () => { window.releaseCapture(); return window.capturing; })).toBe('LIBRARY_CAPTURE_CHANGED');
    expect(await page.evaluate(async () => (await participant.capture(() => 'retry')).value)).toBe('retry');
  }
  await other.close();
});

test('a live participant that does not acknowledge prevents success without hanging writes', async ({ page, context }) => {
  await joinCapture(page, 'Owner');
  const other = await context.newPage(); await other.goto(origin);
  await other.evaluate(async () => {
    const { CAPTURE_LOCKS } = await import('/prompt-lab-extension/src/lib/libraryOriginCapture.js');
    await new Promise(resolve => {
      window.lease = navigator.locks.request(CAPTURE_LOCKS.participant + 'silent-peer', () => new Promise(done => { window.releaseLease = done; resolve(); }));
    });
  });
  expect(await page.evaluate(() => participant.capture(() => 'must not succeed', { timeoutMs: 100 }).catch(error => error.code))).toBe('LIBRARY_CAPTURE_TIMEOUT');
  expect(await page.evaluate(() => writeCoordinator.status().paused)).toBe(false);
  await other.evaluate(async () => { window.releaseLease(); await window.lease; });
  expect(await page.evaluate(async () => (await participant.capture(() => 'recovered')).value)).toBe('recovered');
  await other.close();
});

test('closing the capture owner releases peer pauses at the bounded deadline', async ({ page, context }) => {
  const other = await context.newPage(); await joinCapture(page, 'Owner'); await joinCapture(other, 'Survivor');
  await page.evaluate(() => {
    window.capturing = participant.capture(() => new Promise(() => {}), { timeoutMs: 800 }).catch(() => {});
  });
  await expect.poll(() => other.evaluate(() => writeCoordinator.status().paused)).toBe(true);
  await page.close();
  await expect.poll(() => other.evaluate(() => writeCoordinator.status().paused)).toBe(false);
  expect(await other.evaluate(async () => (await participant.capture(() => 'survived')).value)).toBe('survived');
  await other.close();
});

test('local drain waits for a queued real record write before enumerating IndexedDB', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { writeWithRecovery } = await import('/prompt-lab-extension/src/lib/writeRecovery.js');
    const { saveRunRecord } = await import('/prompt-lab-extension/src/experimentStore.js');
    let release;
    const first = writeWithRecovery('run:queued', () => new Promise(resolve => { release = resolve; }));
    const saved = saveRunRecord({ run_id: 'queued', trace_id: 'trace', future: { retained: true } });
    const capture = reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'queued', archives: { reviewed: true, records: [] } });
    setTimeout(() => release(), 25);
    await Promise.all([first, saved]);
    const report = await capture;
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { records: inspected.captures['execution-traces'].records, coordination: report.coordination,
      activation: report.inventory.manifest.activationReady };
  });
  expect(result.records).toEqual([{ run_id: 'queued', trace_id: 'trace', future: { retained: true } }]);
  expect(result.coordination.writesDrained).toBeGreaterThanOrEqual(2);
  expect(result.coordination.scope).toBe('current-context');
  expect(result.coordination.activationReady).toBe(false);
  expect(result.activation).toBe(false);
});

test('a first database read refused during capture does not poison later durable saves', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { libraryWriteCoordinator: coordinator } = await import('/prompt-lab-extension/src/lib/libraryWriteCoordinator.js');
    const { listExperiments, saveRunRecord } = await import('/prompt-lab-extension/src/experimentStore.js');
    const refused = await coordinator.withPausedWrites(() => listExperiments()).catch(error => error.code);
    const before = await indexedDB.databases();
    await saveRunRecord({ run_id: 'after-read-refusal', trace_id: 'preserved' });
    const report = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'read-refusal', archives: { reviewed: true, records: [] } });
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { refused, before, records: inspected.captures['execution-traces'].records,
      fallback: localStorage.getItem('pl2-run-fallback') };
  });
  expect(result.refused).toBe('LIBRARY_CAPTURE_CHANGED');
  expect(result.before).toEqual([]);
  expect(result.records).toEqual([{ run_id: 'after-read-refusal', trace_id: 'preserved' }]);
  expect(result.fallback).toBeNull();
});

test('local drain includes scheduled Library and strict Scratch journal commits', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = {};
    const { startLibraryJournal } = await import('/prompt-lab-extension/src/lib/libraryJournal.js');
    const { createScratchJournal } = await import('/prompt-lab-extension/src/lib/scratchJournal.js');
    const { saveJson } = await import('/prompt-lab-extension/src/lib/storage.js');
    const library = await startLibraryJournal(); await library.journal.flush();
    const scratch = createScratchJournal({ storage: localStorage, idb: indexedDB });
    saveJson('pl2-pads', { pads: [{ id: 'note', content: 'Keep every byte' }], revision: 1 });
    scratch.commit();
    saveJson('pl2-library', [{ id: 'after-boot', future: [1, 2, 3] }]);
    // No intervening await: the Library journal is still a queued microtask.
    const report = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'journals', archives: { reviewed: true, records: [] } });
    library.stop();
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { local: inspected.captures['local-content'].entries,
      journals: inspected.captures['durable-journal'].records, drained: report.coordination.writesDrained };
  });
  expect(result.drained).toBeGreaterThanOrEqual(3);
  expect(result.journals.find(row => row.id === 'library').entries['pl2-library']).toBe(result.local['pl2-library']);
  expect(result.journals.find(row => row.id === 'scratch').entries['pl2-pads']).toBe(result.local['pl2-pads']);
});

test('real save APIs refuse interference, retain pending records, then recover', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { libraryWriteCoordinator: coordinator } = await import('/prompt-lab-extension/src/lib/libraryWriteCoordinator.js');
    const { saveJson } = await import('/prompt-lab-extension/src/lib/storage.js');
    const { markLibraryDeleted } = await import('/prompt-lab-extension/src/lib/libraryDeletion.js');
    const { saveRunRecord } = await import('/prompt-lab-extension/src/experimentStore.js');
    const recovery = await import('/prompt-lab-extension/src/lib/writeRecovery.js');
    saveJson('pl2-library', [{ id: 'original' }]);
    let release;
    const check = coordinator.withPausedWrites(() => new Promise(resolve => { release = resolve; })).catch(error => error.code);
    const saved = saveJson('pl2-library', [{ id: 'replacement' }]);
    let deleted;
    try { markLibraryDeleted(['original']); } catch (error) { deleted = error.code; }
    const failed = await saveRunRecord({ run_id: 'retry', trace_id: 'trace' }).catch(error => error.code);
    const pending = recovery.getPendingWriteCount();
    const settings = saveJson('pl2-sort-by', 'name');
    release();
    const checkError = await check;
    await recovery.retryPendingWrites();
    const report = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'retried', archives: { reviewed: true, records: [] } });
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { saved, deleted, failed, pending, settings, checkError, left: recovery.getPendingWriteCount(),
      library: inspected.captures['local-content'].entries['pl2-library'], records: inspected.captures['execution-traces'].records };
  });
  expect(result).toMatchObject({ saved: false, deleted: 'LIBRARY_WRITES_PAUSED', failed: 'LIBRARY_WRITES_PAUSED',
    pending: 1, settings: true, checkError: 'LIBRARY_CAPTURE_CHANGED', left: 0 });
  expect(JSON.parse(result.library)).toEqual([{ id: 'original' }]);
  expect(result.records).toEqual([{ run_id: 'retry', trace_id: 'trace' }]);
});

test('a real failed IndexedDB write prevents capture until a newer save succeeds', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { saveRunRecord } = await import('/prompt-lab-extension/src/experimentStore.js');
    const options = { sourceIdentity: 'failed-write', archives: { reviewed: true, records: [] } };
    const failed = await saveRunRecord({ run_id: 'broken', invalid: () => {} }).catch(error => error.name);
    const blocked = await reader.captureAppLibrarySourcesWithLocalDrain(options).catch(error => error.code);
    await saveRunRecord({ run_id: 'broken', trace_id: 'fixed', future: 'kept' });
    const report = await reader.captureAppLibrarySourcesWithLocalDrain(options);
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { failed, blocked, records: inspected.captures['execution-traces'].records };
  });
  expect(result.failed).toBe('DataCloneError');
  expect(result.blocked).toBe('LIBRARY_WRITES_PENDING');
  expect(result.records).toEqual([{ run_id: 'broken', trace_id: 'fixed', future: 'kept' }]);
});

test('refused journal scheduling does not prevent the next automatic durable save', async ({ page }) => {
  const result = await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = {};
    const { libraryWriteCoordinator: coordinator } = await import('/prompt-lab-extension/src/lib/libraryWriteCoordinator.js');
    const { startLibraryJournal } = await import('/prompt-lab-extension/src/lib/libraryJournal.js');
    const { saveJson } = await import('/prompt-lab-extension/src/lib/storage.js');
    const library = await startLibraryJournal(); await library.journal.flush();
    const failed = await coordinator.withPausedWrites(async () => {
      library.journal.note('pl2-library');
    }).catch(error => error.code);
    saveJson('pl2-library', [{ id: 'after-refusal' }]);
    const report = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'automatic-retry', archives: { reviewed: true, records: [] } });
    library.stop();
    const inspected = await inventory.inspectSourceInventory(report.inventory);
    return { failed, journal: inspected.captures['durable-journal'].records.find(row => row.id === 'library') };
  });
  expect(result.failed).toBe('LIBRARY_CAPTURE_CHANGED');
  expect(JSON.parse(result.journal.entries['pl2-library'])).toEqual([{ id: 'after-refusal' }]);
});

test('database creation and upgrade remain tracked after a drain timeout', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const connection = await new Promise(resolve => {
      const request = indexedDB.open('prompt_lab_local', 1);
      request.onsuccess = () => resolve(request.result);
    });
    const { libraryWriteCoordinator: coordinator } = await import('/prompt-lab-extension/src/lib/libraryWriteCoordinator.js');
    const { listExperiments } = await import('/prompt-lab-extension/src/experimentStore.js');
    const pending = listExperiments();
    const options = { sourceIdentity: 'blocked-upgrade', archives: { reviewed: true, records: [] }, drainTimeoutMs: 25 };
    const failed = await reader.captureAppLibrarySourcesWithLocalDrain(options).catch(error => error.code);
    const state = coordinator.status();
    connection.close(); await pending;
    const report = await reader.captureAppLibrarySourcesWithLocalDrain({ ...options, drainTimeoutMs: 1000 });
    return { failed, state, complete: report.inventory.manifest.sourceReadComplete };
  });
  expect(result.failed).toBe('LIBRARY_CAPTURE_TIMEOUT');
  expect(result.state).toMatchObject({ paused: false, active: 1 });
  expect(result.complete).toBe(true);
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
    const refused = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'blob-web', archives: { reviewed: true, records: [] } }).catch(error => error.code);
    return { source, preserved, refused };
  });
  expect(result.source.state).toBe('unavailable');
  expect(result.source.code).toBe('INVALID_JSON');
  expect(result.preserved).toBe('original bytes');
  expect(result.refused).toBe('SOURCE_INCOMPLETE');
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
      const unchanged = canonical(await get(null)) === canonical(original);
      const { sessionSet } = await import('/prompt-lab-extension/src/lib/platform.js');
      const pending = sessionSet({ 'pl2-session': { raw: 'acknowledged draft' } });
      const drained = await reader.captureAppLibrarySourcesWithLocalDrain({ sourceIdentity: 'extension-drained', archives: { reviewed: true, records: [] } });
      const after = await inventory.inspectSourceInventory(drained.inventory);
      return { acknowledgement: await pending, drained: drained.coordination.writesDrained, after: after.captures['extension-drafts'].entries, surface: manifest.surface, complete: manifest.sourceReadComplete, requested,
        entries: captures['extension-drafts'].entries, unchanged,
        copiedPrivate: JSON.stringify(raw).includes('synthetic private session') };
    }, { readerPath, inventoryPath });
    expect(result.surface).toBe('extension');
    expect(result.complete).toBe(true);
    expect(result.requested).toEqual([['pl2-session', 'pl2-dual-draft'], ['pl2-session', 'pl2-dual-draft']]);
    expect(result.acknowledgement).toBe(true);
    expect(result.drained).toBeGreaterThanOrEqual(1);
    expect(result.after['pl2-session']).toEqual({ raw: 'acknowledged draft' });
    expect(result.entries).toEqual({ 'pl2-session': { raw: 'editor', future: { preserved: true } }, 'pl2-dual-draft': { raw: 'dual' } });
    expect(result.unchanged).toBe(true);
    expect(result.copiedPrivate).toBe(false);
  } finally {
    await context?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
