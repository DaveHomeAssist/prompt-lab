// Private export stays on the execution host. Output contains counts and hashes only.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, createCommandService, createMemoryAdapter, inspectPackage, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { captureSourceInventory } from '../library-storage/source-inventory.mjs';
import { createTransfer, inspectTransfer } from '../library-storage/transfer.mjs';

const check = condition => { if (!condition) throw new Error('VERIFICATION_FAILED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  check(process.argv.length === 3);
  const started = Date.now(), path = process.argv[2], bytes = await readFile(path), text = bytes.toString('utf8');
  check(Buffer.from(text).equals(bytes));
  const original = JSON.parse(text), libraryId = crypto.randomUUID();
  const publish = async (service, workspace, operation, sourceText = JSON.stringify(workspace)) => {
    const entries = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': JSON.stringify(workspace.trash ?? []) };
    // Synthetic source evidence binds this exported dataset only, not a live profile.
    const sourceInventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'private-export-test',
      localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Isolated export fixture.' }), archives: { reviewed: true, records: [] } });
    const input = { libraryId, expectedRevision: (await service.read()).revision, sourceText, sourceInventory, mode: 'import' };
    let preview = await service.preview(input);
    const pending = preview.importPlan.rows.filter(row => !row.choice);
    if (pending.length) preview = await service.preview({ ...input, resolutions: Object.fromEntries(pending.map(row => [row.member, { action: 'keep' }])) });
    check(preview.commitAvailable);
    return service.apply({ ...preview, idempotencyKey: operation });
  };
  const left = createCommandService(createMemoryAdapter());
  await publish(left, original, 'original-export', text);
  const base = await left.read(), right = createCommandService(createMemoryAdapter(base));
  for (const [side, service] of [['left', left], ['right', right]]) {
    const workspace = structuredClone(original);
    workspace.library.push({ id: crypto.randomUUID(), title: `Synthetic reconciliation ${side}`, original: `Synthetic branch content ${crypto.randomUUID()}` });
    await publish(service, workspace, side);
  }
  const before = await left.read(), incoming = await right.read();
  const preview = await left.previewReconcile({ libraryId, expectedRevision: before.revision, incoming: await createTransfer(incoming) });
  check(preview.commitAvailable);
  const receipt = await left.apply({ ...preview, idempotencyKey: 'reconcile-export' }), after = await left.read();
  for (const [id, object] of Object.entries({ ...before.objects, ...incoming.objects })) check(canonical(after.objects[id]) === canonical(object));
  const verified = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: after.revision, objects: after.objects });
  check(Object.values(after.objects).some(object => object.kind === 'source' && object.data === text));
  const rebuilt = await inspectTransfer(await createTransfer(after));
  check(canonical(rebuilt.state) === canonical(after));
  const reopened = createCommandService(createMemoryAdapter(rebuilt.state));
  check(canonical(await reopened.apply({ ...preview, idempotencyKey: 'reconcile-export' })) === canonical(receipt));
  check(digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, elapsedMs: Date.now() - started,
    sourceBytes: bytes.length, sourceSha256: digest(bytes), originalUnchanged: true, originalRawTextRetained: true,
    originalLibraryRows: original.library.length, retainedSources: verified.manifest.sources.length, retainedRecords: verified.manifest.nodes.length,
    retainedHistoryRecords: verified.manifest.nodes.filter(node => node.kind === 'version').length,
    everyBranchObjectRetained: true, completeTransferRoundTrip: true, restartedRetryEqual: true,
    actualAppStoresCaptured: false, realTwoClientSync: false, personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' })); process.exitCode = 1; });
