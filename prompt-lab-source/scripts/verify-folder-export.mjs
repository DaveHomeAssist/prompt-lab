import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';
import { createCommandService, inspectPackage, FORMAT, VERSION } from '../library-storage/contract.mjs';

// Only explicit input files are read. Private source bytes stay in a disposable local package.
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/verify-folder-export.mjs /absolute/path/to/export.json');
const input = resolve(sourcePath);
const bytes = await readFile(input);
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceSha256 = digest(bytes);
const sourceText = bytes.toString('utf8');
assert.deepEqual(Buffer.from(sourceText, 'utf8'), bytes, 'Source must be valid UTF-8 without replacement.');
const expected = JSON.parse(sourceText);
const directory = await mkdtemp(join(tmpdir(), 'promptlab-private-export-'));
const adapter = await createFolderAdapter(directory);
const service = createCommandService(adapter);
const preview = await service.preview({ libraryId: 'export-acceptance', expectedRevision: null, sourceText });
const request = { ...preview, idempotencyKey: 'export-roundtrip' };
const receipt = await service.apply(request);
const reopened = await createFolderAdapter(directory);
const restarted = createCommandService(reopened);
assert.deepEqual(await restarted.apply(request), receipt);
const state = await reopened.read();
const restored = await inspectPackage({ format: FORMAT, schemaVersion: VERSION, libraryId: state.libraryId, head: state.revision, objects: state.objects });
assert.deepEqual(restored.workspace, expected, 'Whole workspace must survive without normalization.');
assert.equal(restored.sourceText, sourceText, 'Source formatting must survive too.');
assert.equal(digest(await readFile(input)), sourceSha256, 'Original export must remain unchanged.');
const recovered = join(directory, 'recovered-export.json');
await writeFile(recovered, restored.sourceText, { mode: 0o600, flag: 'wx' });
const report = {
  state: 'pass', scope: 'isolated folder adapter round trip only; no application or iCloud acceptance',
  sourceSha256, recoveredSha256: digest(await readFile(recovered)), sourceBytes: bytes.length,
  libraryEntries: expected.library.length, trashEntries: expected.trash?.length ?? 0,
  promptVersions: [...expected.library, ...(expected.trash ?? [])].reduce((n, row) => n + (row.versions?.length ?? 0), 0),
  maxVersions: Math.max(0, ...expected.library.map(row => row.versions?.length ?? 0)),
  directory, recovered, revision: receipt.revision, duplicateRetryCommits: Object.keys(state.operations).length,
};
await writeFile(join(directory, 'acceptance-report.json'), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
