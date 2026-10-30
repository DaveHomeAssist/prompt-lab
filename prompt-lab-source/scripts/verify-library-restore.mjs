// Explicit private input stays on this host. Reports contain aggregate evidence.
import { readFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { canonical, createCommandService, inspectPackage, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { captureSourceInventory } from '../library-storage/source-inventory.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';
import { writeBackup, readBackup } from '../library-storage/backup-file.mjs';

const check = (condition, label) => { if (!condition) throw new Error(label); };
const equal = (actual, expected, label) => check(canonical(actual) === canonical(expected), label);
const digest = value => createHash('sha256').update(value).digest('hex');
async function main() {
  const path = process.argv[2];
  check(Boolean(path), 'Provide one explicit workspace export path.');
  const bytes = await readFile(path), sourceText = bytes.toString('utf8');
  check(Buffer.from(sourceText).equals(bytes), 'Input must be exact UTF-8.');
  const workspace = JSON.parse(sourceText);
  let erased, changed;
  const root = await realpath(await mkdtemp(join(tmpdir(), 'promptlab-private-restore-')));
  const live = join(root, 'source-library'), destination = join(root, 'reconstructed-library');
  const libraryId = globalThis.crypto.randomUUID();
  async function inventory(content, withMarker) {
    // These are test-only stores, not evidence of the user's actual app state.
    const entries = { 'pl2-library': JSON.stringify(content.library), 'pl2-library-trash': JSON.stringify(content.trash ?? []),
      ...(withMarker ? { [`pl2-library-deleted:${erased.id}`]: '1' } : {}) };
    return captureSourceInventory({ surface: 'web', sourceIdentity: 'disposable-restore-origin',
      localStorage: { length: Object.keys(entries).length, key: i => Object.keys(entries)[i], getItem: key => entries[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic export fixture has no IndexedDB.' }),
      archives: { reviewed: true, records: [] } });
  }
  const service = createCommandService(await createFolderAdapter(live));
  async function publish(content, text, key, withMarker) {
    const input = { libraryId, expectedRevision: (await service.read()).revision, mode: 'import', sourceText: text, sourceInventory: await inventory(content, withMarker) };
    let preview = await service.preview(input);
    const resolutions = Object.fromEntries(preview.importPlan.rows.filter(row => !row.choice).map(row => [row.member,
      withMarker && row.matches.length === 1 ? { action: 'replace', target: row.matches[0] } : { action: 'keep' }]));
    if (Object.keys(resolutions).length) preview = await service.preview({ ...input, resolutions });
    check(preview.commitAvailable, 'Fixture import requires unresolved evidence or choices.');
    return service.apply({ ...preview, idempotencyKey: key });
  }
  const first = await publish(workspace, sourceText, 'original-import', false);
  async function inspect(state) { return inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: state.revision, objects: state.objects }); }
  function selectedRows(state, graph) {
    const nodes = new Map(graph.manifest.nodes.map(node => [node.key, node]));
    return graph.manifest.groups.filter(group => group.selected !== null).map(group => {
      const node = nodes.get(group.selected);
      return node.path.reduce((value, key) => value[key], state.objects[node.source].data);
    });
  }
  const initial = await service.read();
  const eligible = selectedRows(initial, await inspect(initial)).filter(row => typeof row.id === 'string'
    && workspace.library.filter(other => other.id === row.id).length === 1
    && (row.metadata?.libraryGeneration ?? '0') === '0');
  check(eligible.length >= 2, 'Fixture needs two distinct selected legacy-generation prompts.');
  [erased, changed] = eligible;
  const later = structuredClone(workspace);
  later.library = later.library.filter(row => row.id !== erased.id);
  const edited = later.library.find(row => row.id === changed.id);
  edited.original = edited.enhanced = 'Disposable restore verification edit.';
  const second = await publish(later, JSON.stringify(later), 'changed-import', true);
  const before = await service.read();
  equal(selectedRows(before, await inspect(before)).find(row => row.id === changed.id), edited, 'Fixture edit must be selected before restore.');
  const preview = await service.previewRestore({ libraryId, expectedRevision: second.revision, checkpointId: first.revision });
  check(preview.commitAvailable, 'Restore must have complete test-fixture evidence.');
  check(preview.restorePlan.deletionReview.suppressed.some(item => item.reasons.some(reason => reason.sourceId === erased.id)), 'Test deletion must be reported.');
  equal(await service.read(), before, 'Review must not publish changes.');
  const receipt = await service.apply({ ...preview, idempotencyKey: 'reviewed-restore' });
  check(receipt.checkpointId === second.revision && receipt.restoredCheckpointId === first.revision, 'Restore checkpoint identity differs.');
  check(receipt.revision !== first.revision && receipt.parentRevision === second.revision, 'Restore must append a new revision.');
  const after = await service.read();
  for (const [id, object] of Object.entries(before.objects)) equal(after.objects[id], object, 'Existing object changed.');
  for (const [id, operation] of Object.entries(before.operations)) equal(after.operations[id], operation, 'Existing receipt changed.');
  const graph = await inspect(after), selected = selectedRows(after, graph);
  check(!selected.some(row => row.id === erased.id), 'Restore reselected a permanently deleted prompt.');
  equal(selected.find(row => row.id === changed.id), changed, 'Restore did not recover the original edited prompt.');
  const originalSource = after.objects[first.sourceHash].data;
  check(originalSource === sourceText, 'Original source bytes changed.');
  const initialWorkspace = after.objects[after.objects[first.revision].data.inputState].data;
  equal(initialWorkspace, workspace, 'Original workspace changed.');
  const backup = await writeBackup(join(root, 'independent.plbackup'), await service.transfer({ libraryId, expectedRevision: receipt.revision }), { liveDirectory: live });
  const recovered = await readBackup(backup.path, { expectedManifestHash: backup.manifestHash, expectedFileHash: backup.fileSha256 });
  equal(recovered.state, after, 'Backup differs from the complete restored state.');
  const adapter = await createFolderAdapter(destination);
  await adapter.transact(state => { Object.assign(state, recovered.state); return { reconstructed: true }; });
  const reopened = createCommandService(await createFolderAdapter(destination));
  equal(await reopened.read(), after, 'Reopened backup differs.');
  equal(await reopened.apply({ ...preview, idempotencyKey: 'reviewed-restore' }), receipt, 'Restore replay differs.');
  check(digest(await readFile(path)) === digest(bytes), 'Original input changed.');
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, directory: root,
    sourceSha256: digest(bytes), sourceBytes: bytes.length, originalUnchanged: true,
    backupPath: backup.path, manifestHash: backup.manifestHash, backupSha256: backup.fileSha256, backupBytes: backup.bytes, counts: backup.counts,
    records: graph.manifest.nodes.length, historyRecords: graph.manifest.nodes.filter(node => node.kind === 'version').length,
    sourceBindings: graph.sourceBindings.length, selectedAfter: selected.length, suppressed: preview.restorePlan.counts.suppressed,
    reviewedRestoreVerified: true, preRestoreCheckpointVerified: true, syntheticDeletionSuppressionVerified: true,
    originalEditedPromptRestored: true, completeStateEqual: true, operationReplayVerified: true,
    actualAppStoresCaptured: false, actualDeletionStateKnown: false, personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
}

main().catch(error => {
  // Assertion failures and parser messages must not print private prompt data.
  console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' }));
  process.exitCode = 1;
});
