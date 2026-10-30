// Read private exports only on their existing host. Report aggregates, never content.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, createCommandService, createMemoryAdapter, LibraryError, readObject } from '../library-storage/contract.mjs';
import { createCommandOutbox } from '../library-storage/command-outbox.mjs';
import { createServiceTransport } from '../library-storage/command-client.mjs';
import { createTransfer, inspectTransfer } from '../library-storage/transfer.mjs';

const check = value => { if (!value) throw new Error('VERIFICATION_FAILED'); };
const digest = value => createHash('sha256').update(value).digest('hex');
// Isolated verification double. Production outbox storage is strict IndexedDB.
const fixtureStore = initial => {
  let rows = structuredClone(initial);
  return {
    async read(libraryId, operationId) { return structuredClone(rows.find(row => row.libraryId === libraryId && row.operationId === operationId) ?? null); },
    async list(libraryId) { return structuredClone(rows.filter(row => row.libraryId === libraryId)); },
    async write(row, expectedVersion) {
      const i = rows.findIndex(value => value.libraryId === row.libraryId && value.operationId === row.operationId);
      if ((rows[i]?.version ?? null) !== expectedVersion) throw new LibraryError('OUTBOX_CONFLICT', 'Verification transaction conflict.');
      if (i < 0) rows.push(structuredClone(row)); else rows[i] = structuredClone(row);
    },
  };
};
async function main() {
  check(process.argv.length === 3);
  const started = Date.now(), path = process.argv[2], bytes = await readFile(path), sourceText = bytes.toString('utf8'), original = JSON.parse(sourceText);
  const libraryId = crypto.randomUUID(), adapter = createMemoryAdapter(), service = createCommandService(adapter);
  const request = { libraryId, expectedRevision: null, sourceText, mode: 'snapshot' };
  const transport = createServiceTransport(service, { libraryId }), store = fixtureStore([]), outbox = createCommandOutbox(store);
  const pending = await outbox.enqueue({ request, review: await transport.preview(request), operationId: 'private-export' });
  check(pending.state === 'pending' && (await adapter.read()).revision === null);
  check(pending.request.sourceText === sourceText);
  const retained = fixtureStore(await store.list(libraryId)), restarted = createCommandOutbox(retained);
  let lost = false;
  try { await restarted.replay(libraryId, 'private-export', { ...transport, apply: async input => {
    await transport.apply(input); throw new LibraryError('TEST_RESPONSE_LOST', 'Injected lost response after successful commit.');
  } }); } catch (error) { check(error.code === 'TEST_RESPONSE_LOST'); lost = true; }
  check(lost);
  const before = await service.read(), transfer = await inspectTransfer(await createTransfer(before));
  check(canonical(transfer.state) === canonical(before));
  const reopened = createCommandService(createMemoryAdapter(transfer.state));
  const saved = await createCommandOutbox(retained).replay(libraryId, 'private-export', createServiceTransport(reopened, { libraryId }));
  check(saved.state === 'committed' && saved.receipt.revision === before.revision);
  check(canonical(await reopened.read()) === canonical(before));
  const stored = await readObject(before.objects, saved.receipt.stateHash, 'workspace');
  check(canonical(stored) === canonical(original));
  check(saved.request.sourceText === sourceText && digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, elapsedMs: Date.now() - started,
    sourceBytes: bytes.length, sourceSha256: digest(bytes), originalUnchanged: true,
    prompts: original.library?.length ?? 0, trash: original.trash?.length ?? 0, runs: original.runs?.length ?? 0,
    completeQueuedSourceBytesEqual: true, completeCommittedValuesEqual: true, responseLossRecoveredByReceipt: true,
    operationCount: Object.keys(before.operations).length, completeTransferRoundTrip: true,
    testStorage: 'isolated memory fixture with reconstructed command and service instances',
    privateDataTransferred: false, personalLibraryActivated: false, installedAppAcceptance: false }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' })); process.exitCode = 1; });
