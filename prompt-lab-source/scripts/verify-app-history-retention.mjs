// Exercise real app stores with disposable memory. Never emit private content.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeEntry } from '../prompt-lab-extension/src/lib/promptSchema.js';

const check = condition => { if (!condition) throw new Error('VERIFICATION_FAILED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  check(process.argv.length === 3);
  const started = Date.now(), path = process.argv[2], bytes = await readFile(path);
  const original = JSON.parse(bytes.toString('utf8'));
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const store = await import('../prompt-lab-extension/src/experimentStore.js');
  const runs = original.runs || [], cases = original.testCases || [];
  for (const row of runs) {
    await store.saveEvalRun(structuredClone(row));
    const saved = await store.getEvalRunById(row.id);
    for (const key of Object.keys(row)) check(isDeepStrictEqual(saved[key], row[key]));
  }
  for (const row of cases) await store.saveTestCase(structuredClone(row));
  for (const row of cases) {
    const saved = (await store.listTestCases({ limit: null })).find(item => item.id === row.id);
    for (const key of Object.keys(row)) check(isDeepStrictEqual(saved[key], row[key]));
  }
  const prompts = [...original.library, ...(original.trash || [])];
  for (const row of prompts) {
    const saved = normalizeEntry(JSON.parse(JSON.stringify(row)));
    check(isDeepStrictEqual(saved.resultMeta, row.resultMeta));
    check(saved.versions.length === row.versions.length);
    for (const field of ['original', 'enhanced', 'notes']) check(saved[field] === row[field]);
  }
  // Reopen serialized fallback storage with a fresh module instance.
  const serialized = JSON.stringify([...values]);
  values.clear();
  for (const [key, value] of JSON.parse(serialized)) values.set(key, value);
  const reopened = await import(`../prompt-lab-extension/src/experimentStore.js?reopened=${Date.now()}`);
  for (const row of runs) {
    const saved = await reopened.getEvalRunById(row.id);
    for (const key of Object.keys(row)) check(isDeepStrictEqual(saved[key], row[key]));
  }
  check(digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version,
    elapsedMs: Date.now() - started, sourceBytes: bytes.length, sourceSha256: digest(bytes), originalUnchanged: true,
    runsSavedAndReopened: runs.length, casesSavedAndRead: cases.length, promptAndTrashMetadataChecked: prompts.length,
    scope: 'Actual app fallback stores and prompt normalization using isolated memory; no installed app acceptance.',
    privateDataTransferred: false }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' })); process.exitCode = 1; });
