// Read a private export in place; exercise disposable in-memory records only.
// Emit counts and hashes, never prompt content or failed assertion values.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizeEntry, restorePromptVersion, updatePromptEntry } from '../prompt-lab-extension/src/lib/promptSchema.js';

const check = condition => { if (!condition) throw new Error('VERIFICATION_FAILED'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const reopen = record => normalizeEntry(JSON.parse(JSON.stringify(record)));

async function main() {
  check(process.argv.length === 3);
  const started = Date.now(), path = process.argv[2], bytes = await readFile(path);
  const original = JSON.parse(bytes.toString('utf8'));
  check(Array.isArray(original.library) && original.library.length > 0);
  let originalHistory = 0, retainedHistory = 0, restoredPrompts = 0;
  for (const raw of original.library) {
    const input = structuredClone(raw), before = normalizeEntry(input);
    check(before !== null && before.versions.length === (raw.versions?.length ?? 0));
    originalHistory += before.versions.length;
    const saved = updatePromptEntry(input, { enhanced: `${before.enhanced}\nSynthetic preservation verification.` });
    const reopened = reopen(saved);
    check(reopened.id === before.id && reopened.versions.length === before.versions.length + 1);
    check(isDeepStrictEqual(reopened.versions.slice(0, -1), reopen(before).versions));
    for (const key of Object.keys(before)) {
      if (['enhanced', 'updatedAt', 'updated_at', 'currentVersionId', 'versions'].includes(key)) continue;
      check(isDeepStrictEqual(reopened[key], reopen(before)[key]));
    }
    const restored = reopen(restorePromptVersion(reopened, reopened.versions.at(-1)));
    check(restored.enhanced === before.enhanced && restored.original === before.original);
    check(restored.versions.length === before.versions.length + 2);
    check(isDeepStrictEqual(restored.versions.slice(0, -1), reopened.versions));
    check(isDeepStrictEqual(input, raw));
    retainedHistory += reopened.versions.length;
    restoredPrompts++;
  }
  let longHistory = normalizeEntry(structuredClone(original.library[0]));
  const priorCount = longHistory.versions.length;
  for (let n = 0; n < 32; n++) longHistory = reopen(updatePromptEntry(longHistory, { enhanced: `Synthetic retained edit ${n}` }));
  check(longHistory.versions.length === priorCount + 32);
  check(digest(await readFile(path)) === digest(bytes));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, elapsedMs: Date.now() - started,
    sourceBytes: bytes.length, sourceSha256: digest(bytes), originalUnchanged: true,
    promptsSavedAndReopened: original.library.length, originalHistory, historyAfterOneSave: retainedHistory,
    promptsRestoredWithoutPruning: restoredPrompts, sequentialEditsRetained: 32,
    scope: 'App prompt normalization, save and content restore using in-memory copies; known-field normalization still applies.',
    installedAppAcceptance: false, privateDataTransferred: false }, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ verified: false, error: error.code ?? error.name ?? 'VERIFICATION_FAILED' })); process.exitCode = 1; });
