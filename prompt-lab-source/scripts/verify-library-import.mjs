// Explicit private input only. Output is aggregate evidence; source records stay
// in a fresh disposable directory on this host, never in Git or on a runner.
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createCommandService, inspectPackage, hash, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';

const input = process.argv[2];
if (!input) throw new Error('Provide one explicit workspace-export file path.');
const before = await readFile(input);
const sourceText = before.toString('utf8');
assert.deepEqual(Buffer.from(sourceText, 'utf8'), before, 'Input must be lossless UTF-8');
const original = JSON.parse(sourceText);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await mkdtemp(join(tmpdir(), 'promptlab-private-import-'));
const libraryId = globalThis.crypto.randomUUID();
const service = createCommandService(await createFolderAdapter(directory));
const previewInput = { mode: 'import', libraryId, expectedRevision: null, sourceText };
let preview = await service.preview(previewInput);
const resolutions = {};
// Keep is a disposable test choice, not approval to reconcile the personal
// library. Every original record and all alternate histories remain archived.
for (const row of preview.importPlan.rows.filter(row => !row.choice)) {
  Object.defineProperty(resolutions, row.member, { value: { action: 'keep' }, enumerable: true });
}
preview = await service.preview({ ...previewInput, resolutions });
assert.equal(preview.importPlan.unresolved, 0, 'Disposable Keep choices must resolve every row');
const first = await service.apply({ ...preview, idempotencyKey: 'private-import' });
const next = await service.preview({ ...previewInput, expectedRevision: first.revision, sourceText: sourceText + '\n' });
const second = await service.apply({ ...next, idempotencyKey: 'encoding-import' });
const reopened = createCommandService(await createFolderAdapter(directory));
assert.deepEqual(await reopened.apply({ ...next, idempotencyKey: 'encoding-import' }), second);
assert.deepEqual(await reopened.operation('private-import'), first);
const state = await reopened.read();
const inspected = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId, head: state.revision, objects: state.objects });
assert.equal(inspected.commits, 2);
assert.equal(Object.keys(state.operations).length, 2);
assert.equal(inspected.manifest.sources.length, 2);
assert.deepEqual(inspected.manifest.groups, preview.importPlan.manifest.groups);
assert.deepEqual(inspected.manifest.nodes, preview.importPlan.manifest.nodes);
assert.deepEqual(inspected.manifest.references, preview.importPlan.manifest.references);
for (const [i, source] of inspected.manifest.sources.entries()) {
  assert.deepEqual(state.objects[source.workspace].data, original);
  assert.equal(state.objects[source.source].data, sourceText + (i ? '\n' : ''));
}
for (const node of inspected.manifest.nodes) {
  const value = node.path.reduce((value, segment) => value[segment], original);
  assert.equal(await hash(value), node.hash);
}
assert.equal(digest(await readFile(input)), digest(before));
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, directory,
  sourceSha256: digest(before), bytes: before.length, originalUnchanged: true,
  disposableKeepChoices: Object.keys(resolutions).length, sources: inspected.manifest.sources.length,
  records: inspected.manifest.nodes.length, historyRecords: inspected.manifest.nodes.filter(node => node.kind === 'version').length,
  groups: inspected.manifest.groups.length, missingSourceReferences: inspected.manifest.references.filter(link => link.reason === 'missing-source-reference').length,
  commits: inspected.commits, receipts: Object.keys(state.operations).length, checkpointCount: state.checkpoints.length,
  sourceBytesVerified: true, fullJsonVerified: true, everyRecordHashVerified: true, graphUnchangedAfterRepeat: true,
  receiptReplayVerified: true, personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
