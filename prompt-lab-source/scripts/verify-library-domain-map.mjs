// Private export verification. Never print raw source content or move the file.
import { readFile, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { canonical, createCommandService, FORMAT, VERSION } from '../library-storage/contract.mjs';
import { buildDomainMap, pageDomainMap } from '../library-storage/domain-map.mjs';
import { createFolderAdapter } from '../library-storage/folder-adapter.mjs';

const check = condition => { if (!condition) throw new Error('VERIFICATION_FAILED'); };
const equal = (a, b) => check(canonical(a) === canonical(b));
const digest = value => createHash('sha256').update(value).digest('hex');
async function main() {
  check(process.argv.length === 3);
  const path = process.argv[2], bytes = await readFile(path), text = bytes.toString('utf8');
  check(Buffer.from(text).equals(bytes));
  const original = JSON.parse(text);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'promptlab-private-domains-')));
  const service = createCommandService(await createFolderAdapter(directory)), libraryId = crypto.randomUUID();
  const preview = await service.preview({ libraryId, expectedRevision: null, sourceText: text });
  const receipt = await service.apply({ ...preview, idempotencyKey: 'original-export' });
  const before = await service.read();
  const reopened = createCommandService(await createFolderAdapter(directory)), state = await reopened.read();
  equal(state, before);
  const map = await buildDomainMap({ format: FORMAT, schemaVersion: VERSION, libraryId, head: state.revision, objects: state.objects });
  equal(map.records.find(row => row.origin.replica === 'workspace' && row.origin.path.length === 0).value, original);
  for (const row of map.records) {
    check(row.origin.decodedPath === null && row.origin.binding === null);
    let value = original;
    for (const key of row.origin.path) { check(Object.hasOwn(value, key)); value = value[key]; }
    equal(row.value, value);
  }
  for (const [section, domain] of [['library', 'prompts'], ['trash', 'trash'], ['runs', 'evaluations'], ['testCases', 'test-cases'], ['collections', 'collections'], ['folders', 'folders']]) {
    if (!Array.isArray(original[section])) continue;
    const rows = map.records.filter(row => row.domain === domain && row.origin.path[0] === section);
    check(rows.length === original[section].length);
    for (const [index, value] of original[section].entries()) {
      const matches = rows.filter(row => row.origin.path.length === 2 && row.origin.path[1] === index);
      check(matches.length === 1); equal(matches[0].value, value);
    }
  }
  const expectedVersions = [...original.library, ...(original.trash ?? [])].reduce((n, row) => n + (row.versions?.length ?? 0), 0);
  check((map.counts['prompt-versions'] ?? 0) === expectedVersions);
  const pages = []; let cursor = '0', pageCount = 0;
  do {
    const page = await reopened.records({ libraryId, expectedRevision: receipt.revision, cursor, limit: 100 });
    equal(page, pageDomainMap(map, { cursor, limit: 100 }));
    pages.push(...page.items); cursor = page.nextCursor; pageCount++;
  } while (cursor !== null);
  equal(pages, map.records);
  equal(await reopened.read(), state);
  check(digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, directory,
    sourceSha256: digest(bytes), sourceBytes: bytes.length, originalUnchanged: true,
    records: map.records.length, counts: map.counts, pages: pageCount,
    everyAddressMatchesOriginal: true, originalContainerEqual: true, reopenedStateEqual: true,
    commandServicePaginationEqual: true, rawSourcesUnchangedByReads: true,
    references: map.records.reduce((n, row) => n + row.references.length, 0),
    missingReferences: map.records.flatMap(row => row.references).filter(ref => ref.status === 'missing').length,
    ambiguousReferences: map.records.flatMap(row => row.references).filter(ref => ref.status === 'ambiguous').length,
    actualAppStoresCaptured: false, migrationBarrierEstablished: false, personalLibraryActivated: false, privateDataTransferred: false }, null, 2));
}
main().catch(error => {
  console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' }));
  process.exitCode = 1;
});
