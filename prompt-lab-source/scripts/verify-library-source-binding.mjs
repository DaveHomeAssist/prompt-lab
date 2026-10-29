// Explicit private export stays on this host. Only aggregate evidence is printed.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createCommandService, inspectPackage, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { captureSourceInventory } from '../library-storage/source-inventory.mjs';
import { collectDeletionEvidence, inspectSourceBinding } from '../library-storage/source-binding.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';
import { writeBackup, readBackup } from '../library-storage/backup-file.mjs';

const path = process.argv[2];
if (!path) throw new Error('Provide one explicit workspace-export path.');
const bytes = await readFile(path), sourceText = bytes.toString('utf8');
assert.deepEqual(Buffer.from(sourceText), bytes);
const workspace = JSON.parse(sourceText);
const digest = value => createHash('sha256').update(value).digest('hex');
const root = await realpath(await mkdtemp(join(tmpdir(), 'promptlab-private-source-binding-')));
const live = join(root, 'source-library'), destination = join(root, 'reconstructed-library');
const libraryId = globalThis.crypto.randomUUID(), sourceIdentity = 'disposable-test-origin';
const markerId = 'test-only-permanent-deletion';
async function inventory(withMarker) {
  // This is a synthetic storage fixture populated from exported rows. It does
  // not claim to have captured the user's actual browser or desktop stores.
  const values = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-library-trash': JSON.stringify(workspace.trash ?? []),
    ...(withMarker ? { [`pl2-library-deleted:${markerId}`]: '1' } : {}) };
  return captureSourceInventory({ surface: 'web', sourceIdentity,
    localStorage: { length: Object.keys(values).length, key: i => Object.keys(values)[i], getItem: key => values[key] ?? null },
    readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic export fixture has no IndexedDB.' }),
    archives: { reviewed: true, records: [] },
  });
}
const service = createCommandService(await createFolderAdapter(live));
const firstInventory = await inventory(false);
const input = { libraryId, expectedRevision: null, mode: 'import', sourceText, sourceInventory: firstInventory };
const review = await service.preview(input);
const resolutions = Object.fromEntries(review.importPlan.rows.filter(row => !row.choice).map(row => [row.member, { action: 'keep' }]));
const preview = await service.preview({ ...input, resolutions });
const first = await service.apply({ ...preview, idempotencyKey: 'bound-import' });
const secondInventory = await inventory(true);
const repeat = await service.preview({ ...input, expectedRevision: first.revision, sourceInventory: secondInventory });
const second = await service.apply({ ...repeat, idempotencyKey: 'bound-repeat' });
const before = await service.read();
for (const [receipt, expected] of [[first, firstInventory], [second, secondInventory]]) {
  assert.deepEqual((await inspectSourceBinding(before.objects, receipt.sourceBinding)).inventory, expected);
}
const graph = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: before.revision, objects: before.objects });
const deletion = await collectDeletionEvidence(before.objects, graph.sourceBindings);
assert.equal(deletion.scopes.length, 1); assert.equal(deletion.scopes[0].complete, true);
assert.deepEqual(deletion.scopes[0].deletedIds, [markerId]);
const transfer = await service.transfer({ libraryId, expectedRevision: second.revision });
const backup = await writeBackup(join(root, 'independent.plbackup'), transfer, { liveDirectory: live });
const recovered = await readBackup(backup.path, { expectedManifestHash: backup.manifestHash, expectedFileHash: backup.fileSha256 });
assert.deepEqual(recovered.state, before);
const adapter = await createFolderAdapter(destination);
await adapter.transact(state => { Object.assign(state, recovered.state); return { reconstructed: true }; });
const reopened = createCommandService(await createFolderAdapter(destination));
assert.deepEqual(await reopened.read(), before);
assert.deepEqual(await reopened.apply({ ...repeat, idempotencyKey: 'bound-repeat' }), second);
for (const source of graph.manifest.sources) {
  assert.equal(recovered.state.objects[source.source].data, sourceText);
  assert.deepEqual(recovered.state.objects[source.workspace].data, workspace);
}
assert.equal(digest(await readFile(path)), digest(bytes));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, directory: root,
  sourceSha256: digest(bytes), sourceBytes: bytes.length, originalUnchanged: true,
  backupPath: backup.path, manifestHash: backup.manifestHash, backupSha256: backup.fileSha256, backupBytes: backup.bytes,
  counts: backup.counts, records: graph.manifest.nodes.length, historyRecords: graph.manifest.nodes.filter(node => node.kind === 'version').length,
  sourceBindings: graph.sourceBindings.length, retainedCaptureObjects: Object.values(before.objects).filter(object => object.kind === 'source-capture').length,
  syntheticDeletionEvidenceVerified: true, completeStateEqual: true, operationReplayVerified: true,
  actualAppStoresCaptured: false, actualDeletionStateKnown: false, reviewedRestoreExercised: false,
  personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
