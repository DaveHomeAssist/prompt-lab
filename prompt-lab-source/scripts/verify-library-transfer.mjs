// Private inputs stay on this host. Only aggregate evidence goes to stdout.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createCommandService, inspectPackage, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';
import { writeBackup, readBackup } from '../library-storage/backup-file.mjs';

const path = process.argv[2];
if (!path) throw new Error('Provide one explicit workspace-export path.');
const bytes = await readFile(path), sourceText = bytes.toString('utf8');
assert.deepEqual(Buffer.from(sourceText), bytes);
const digest = value => createHash('sha256').update(value).digest('hex');
const root = await realpath(await mkdtemp(join(tmpdir(), 'promptlab-private-transfer-')));
const live = join(root, 'source-library'), destination = join(root, 'reconstructed-library');
const libraryId = globalThis.crypto.randomUUID();
const service = createCommandService(await createFolderAdapter(live));
const input = { libraryId, expectedRevision: null, mode: 'import', sourceText };
const review = await service.preview(input);
const resolutions = Object.fromEntries(review.importPlan.rows.filter(row => !row.choice).map(row => [row.member, { action: 'keep' }]));
const preview = await service.preview({ ...input, resolutions });
const first = await service.apply({ ...preview, idempotencyKey: 'private-import' });
const repeat = await service.preview({ ...input, expectedRevision: first.revision, sourceText: sourceText + '\n' });
const second = await service.apply({ ...repeat, idempotencyKey: 'repeat-import' });
const before = await service.read();
const transfer = await service.transfer({ libraryId, expectedRevision: second.revision });
const backup = await writeBackup(join(root, 'independent.plbackup'), transfer, { liveDirectory: live });
const recovered = await readBackup(backup.path, { expectedManifestHash: backup.manifestHash, expectedFileHash: backup.fileSha256 });
assert.deepEqual(recovered.state, before);
const adapter = await createFolderAdapter(destination);
// This explicit new disposable folder tests complete transport parity. It is
// not the public checkpoint restore operation and cannot replace user data.
await adapter.transact(state => { Object.assign(state, recovered.state); return { reconstructed: true }; });
const reopened = createCommandService(await createFolderAdapter(destination));
assert.deepEqual(await reopened.read(), before);
assert.deepEqual(await reopened.apply({ ...repeat, idempotencyKey: 'repeat-import' }), second);
assert.deepEqual(await reopened.operation('private-import'), first);
const graph = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: before.revision, objects: before.objects });
for (const [i, source] of graph.manifest.sources.entries()) {
  assert.equal(recovered.state.objects[source.source].data, sourceText + (i ? '\n' : ''));
  assert.deepEqual(recovered.state.objects[source.workspace].data, JSON.parse(sourceText));
}
assert.deepEqual(await service.read(), before);
assert.equal(digest(await readFile(path)), digest(bytes));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, directory: root,
  sourceSha256: digest(bytes), sourceBytes: bytes.length, originalUnchanged: true, backupPath: backup.path, manifestHash: backup.manifestHash,
  backupSha256: backup.fileSha256, backupBytes: backup.bytes,
  counts: backup.counts, records: graph.manifest.nodes.length, historyRecords: graph.manifest.nodes.filter(node => node.kind === 'version').length,
  missingSourceReferences: graph.manifest.references.filter(link => link.reason === 'missing-source-reference').length,
  disposableKeepChoices: Object.keys(resolutions).length, completeStateEqual: true, originalSourceBytesEqual: true,
  adapterReconstructionVerified: true, operationReplayVerified: true, outsideLiveDirectory: true,
  publicRestoreImplemented: false, personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
