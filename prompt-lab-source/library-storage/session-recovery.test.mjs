import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandService, createMemoryAdapter } from './contract.mjs';
import { createFolderAdapter } from './folder-adapter.mjs';
import { captureSourceInventory } from './source-inventory.mjs';
import { createTransfer, inspectTransfer } from './transfer.mjs';

test('per-client raw and live recovery survive interrupted import, reopen and complete backup transfer', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'promptlab-session-recovery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = 'pl2-draft-reset-recovery-v1';
  const clients = ['first', 'second'].map((clientId, index) => ({ clientId, buffers: [
    { id: 'draft-recovery-store', value: { storage: 'sessionStorage', entries: {
      [key]: index ? '{"editor":{"raw":"Interrupted previous draft"},' : ' {"editor":{"raw":"Stored older draft"},"future":[null,false]}\n',
    } } },
    { id: 'draft-recovery:1', value: { editor: { raw: clientId + ' live draft $& {{input}}',
      variants: Array.from({ length: 41 }, (_, id) => ({ id, text: 'Complete text '.repeat(1000) })) },
      future: { opaque: [null, false, { retained: clientId }] } } },
  ] }));
  const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'shared-browser-origin',
    localStorage: { length: 0, key: () => null, getItem: () => null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Isolated synthetic source.' }),
    archives: { reviewed: true, records: [] }, clientBuffers: clients, capturedAt: '2026-10-29T19:00:00.000Z' });
  let failure;
  const service = createCommandService(await createFolderAdapter(directory, { fault: async point => {
    if (failure === point) throw new Error('Injected session recovery import interruption');
  } }));
  const before = await service.read();
  const review = await service.preview({ libraryId: 'lib', expectedRevision: before.revision, mode: 'import',
    sourceText: JSON.stringify({ library: [] }), sourceInventory: inventory });
  assert.equal(review.commitAvailable, true);
  for (failure of ['before-flush', 'before-publication']) {
    await assert.rejects(service.apply({ ...review, idempotencyKey: 'recovery-import' }));
    assert.deepEqual(await service.read(), before);
  }
  failure = 'after-publication';
  await assert.rejects(service.apply({ ...review, idempotencyKey: 'recovery-import' }));
  const reopened = createCommandService(await createFolderAdapter(directory));
  const receipt = await reopened.operation('recovery-import');
  assert.deepEqual(await reopened.apply({ ...review, idempotencyKey: 'recovery-import' }), receipt);
  const selected = await reopened.previewCurrentView({ libraryId: 'lib', expectedRevision: receipt.revision });
  assert.equal(selected.commitAvailable, true);
  await reopened.apply({ ...selected, idempotencyKey: 'recovery-select' });
  const current = await reopened.read();
  const page = await reopened.currentRecords({ libraryId: 'lib', expectedRevision: current.revision, domain: 'drafts' });
  assert.equal(page.items.length, 4);
  for (const client of clients) for (const buffer of client.buffers) {
    assert.deepEqual(page.items.find(row => row.sourceId === `${client.clientId}/${buffer.id}`).value, buffer.value);
  }
  const transfer = await createTransfer(current), restored = (await inspectTransfer(transfer)).state;
  assert.deepEqual(restored, current);
  const backupService = createCommandService(createMemoryAdapter(restored));
  assert.deepEqual(await backupService.currentRecords({ libraryId: 'lib', expectedRevision: restored.revision, domain: 'drafts' }), page);
  assert.equal(current.objects[inventory.manifest.sources.find(source => source.id === 'client-buffers').hash].data.records.length, 2);
});
