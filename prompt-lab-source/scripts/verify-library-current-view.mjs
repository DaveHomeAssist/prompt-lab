// Private export is read only on its existing host. Emit counts/hashes only.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, createCommandService, createMemoryAdapter } from '../library-storage/contract.mjs';
import { captureSourceInventory } from '../library-storage/source-inventory.mjs';
import { createTransfer, inspectTransfer } from '../library-storage/transfer.mjs';

const check = condition => { if (!condition) throw new Error('VERIFICATION_FAILED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  check(process.argv.length === 3);
  const started = Date.now(), path = process.argv[2], bytes = await readFile(path), sourceText = bytes.toString('utf8');
  const original = JSON.parse(sourceText), libraryId = crypto.randomUUID();
  const entries = { 'pl2-library': JSON.stringify(original.library), 'pl2-library-trash': JSON.stringify(original.trash ?? []) };
  const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'private-export-test',
    localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Isolated export fixture; live stores are not claimed.' }),
    archives: { reviewed: true, records: [] } });
  const service = createCommandService(createMemoryAdapter()), input = { libraryId, expectedRevision: null, sourceText, sourceInventory, mode: 'import' };
  const review = await service.preview(input);
  // The fixture explicitly retains every supplied prompt, including duplicates.
  const imported = await service.apply({ ...await service.preview({ ...input,
    resolutions: Object.fromEntries(review.importPlan.rows.map(row => [row.member, { action: 'keep' }])) }), idempotencyKey: 'import-all' });
  const before = await service.read();
  const preview = await service.previewCurrentView({ libraryId, expectedRevision: imported.revision });
  check(preview.commitAvailable);
  const receipt = await service.apply({ ...preview, idempotencyKey: 'current-view' });
  const rows = []; let cursor = '0';
  do { const page = await service.currentRecords({ libraryId, expectedRevision: receipt.revision, domain: 'prompts', cursor });
    rows.push(...page.items); cursor = page.nextCursor; } while (cursor !== null);
  check(rows.length === original.library.length);
  for (const row of rows) check(canonical(row.value) === canonical(original.library[row.origin.path[1]]));
  const history = await service.currentRecords({ libraryId, expectedRevision: receipt.revision, domain: 'prompt-versions' });
  check(history.total === [...original.library, ...(original.trash ?? [])].reduce((n, row) => n + (row.versions?.length ?? 0), 0));
  const after = await service.read();
  for (const [id, object] of Object.entries(before.objects)) check(canonical(after.objects[id]) === canonical(object));
  const rebuilt = await inspectTransfer(await createTransfer(after)); check(canonical(rebuilt.state) === canonical(after));
  const reopened = createCommandService(createMemoryAdapter(rebuilt.state));
  check(canonical(await reopened.apply({ ...preview, idempotencyKey: 'current-view' })) === canonical(receipt));
  check((await reopened.currentRecords({ libraryId, expectedRevision: receipt.revision, domain: 'prompts' })).total === original.library.length);
  check(digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, elapsedMs: Date.now() - started,
    sourceBytes: bytes.length, sourceSha256: digest(bytes), originalUnchanged: true, selectedPrompts: rows.length,
    selectedHistoricalVersions: history.total, selectedValuesEqualOriginal: true, everySourceObjectRetained: true,
    completeTransferRoundTrip: true, restartedRetryEqual: true, privateDataTransferred: false,
    liveStoresCaptured: false, personalLibraryActivated: false, installedAppAcceptance: false }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' })); process.exitCode = 1; });
