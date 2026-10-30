import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { planLosslessImport, verifyImportPlan } from '../library-storage/import-plan.mjs';
import { hash } from '../library-storage/contract.mjs';

// Read one explicitly supplied export. Emit aggregate evidence only, never
// prompt text or a plan containing source record identities.
if (!process.argv[2]) throw new Error('Usage: node scripts/verify-import-plan.mjs /absolute/path/to/export.json');
const input = resolve(process.argv[2]);
const bytes = await readFile(input);
const digest = value => createHash('sha256').update(value).digest('hex');
const sourceText = bytes.toString('utf8');
assert.deepEqual(Buffer.from(sourceText, 'utf8'), bytes, 'Export must be valid UTF-8.');
const workspace = JSON.parse(sourceText);
const plan = await planLosslessImport({ library: [] }, workspace);
await verifyImportPlan(plan, { library: [] }, workspace);
for (const node of plan.nodes) {
  assert.equal(node.source, 'incoming');
  const raw = node.path.reduce((value, key) => value[key], workspace);
  assert.equal(node.hash, await hash(raw), 'Every indexed record must equal its raw source.');
}
assert.equal(digest(await readFile(input)), digest(bytes), 'Original export must remain unchanged.');
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row[field]))].sort()
  .map(value => [value, rows.filter(row => row[field] === value).length]));
process.stdout.write(JSON.stringify({
  recordedAt: new Date().toISOString(), state: 'pass', node: process.version,
  scope: 'Read-only source and selection graph verification. No import, activation or cloud upload.',
  sourceSha256: digest(bytes), sourceBytes: bytes.length, libraryEntries: workspace.library.length,
  trashEntries: workspace.trash?.length ?? 0, rawNodesVerified: plan.nodes.length,
  historyNodes: plan.nodes.filter(node => node.kind === 'version').length,
  logicalPromptGroups: plan.groups.length, rows: countBy(plan.rows, 'kind'),
  unresolvedChoices: plan.unresolved, referenceIssues: countBy(plan.references.filter(link => link.reason), 'reason'),
  sourceHash: plan.sources.incoming, planFingerprint: plan.fingerprint, originalUnchanged: true,
}, null, 2) + '\n');
