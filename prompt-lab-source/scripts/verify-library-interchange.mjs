import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import libraryFixture from '../../contracts/promptlab-library-v2.json' with { type: 'json' };
import { normalizeWorkspaceImportSource } from '../prompt-lab-extension/src/lib/workspaceImportPreview.js';
import { prepareWorkspaceImport } from '../prompt-lab-extension/src/lib/workspaceImport.js';

export { libraryFixture };

export function verifyNativeCreatedLibrary(document) {
  const source = document.library[0];
  assert.equal(document.library.length, 1);
  assert.ok(source.id && source.currentVersionId);
  assert.equal(source.original, 'Native created compatibility record.');
  assert.equal(source.enhanced, 'Native revised compatibility record.');
  assert.equal(source.versions.length, 1);
  assert.equal(source.versions[0].enhanced, source.original);
  assert.notEqual(source.versions[0].id, source.currentVersionId);
  assert.match(source.createdAt, /\.\d{3}Z$/);
  const plan = prepareWorkspaceImport(normalizeWorkspaceImportSource(document));
  for (const key of ['id', 'title', 'original', 'enhanced', 'createdAt', 'updatedAt', 'currentVersionId']) assert.deepEqual(plan.library[0][key], source[key]);
  assert.equal(plan.library[0].versions[0].id, source.versions[0].id);
  assert.equal(plan.library[0].versions[0].enhanced, source.versions[0].enhanced);
  assert.deepEqual(prepareWorkspaceImport(normalizeWorkspaceImportSource(document), plan).library.map(row => row.id), [source.id]);
  return { prompts: 1, historicalVersions: 1 };
}

// Both adapters consume the same artifact. Expected values come from the shared
// fixture, not another implementation of native serialization.
export function verifyLibraryInterchange(document, { nativeEdit = false, nativeParentEdit = false } = {}) {
  const expected = structuredClone(libraryFixture);
  if (nativeEdit) {
    expected.library[0].notes = 'Edited on native; preserve lineage.';
    expected.library[0].updatedAt = '2026-09-20T10:30:00.321Z';
    expected.library[0].updated_at = expected.library[0].updatedAt;
  }
  if (nativeParentEdit) {
    const parent = expected.library[1];
    const actual = document.library[1];
    assert.ok(actual.currentVersionId && actual.currentVersionId !== parent.currentVersionId, 'Native edits receive a new stable version');
    assert.ok(Date.parse(actual.updatedAt) > Date.parse(parent.updatedAt), 'Native edit timestamp advances');
    parent.versions.push({
      id: parent.currentVersionId, original: parent.original, enhanced: parent.enhanced,
      variants: parent.variants, notes: parent.notes, resultMeta: parent.resultMeta,
      savedAt: parent.updatedAt, source: 'manual_save', changeNote: 'Edited in the native app',
    });
    parent.enhanced = 'Native revision of the parent prompt.';
    parent.currentVersionId = actual.currentVersionId;
    parent.updatedAt = actual.updatedAt;
    parent.updated_at = actual.updatedAt;
  }
  assert.deepEqual(document.library.map(row => row.id), expected.library.map(row => row.id), 'Manual order and identity');
  for (const [index, row] of document.library.entries()) {
    for (const field of ['id', 'title', 'original', 'enhanced', 'notes', 'variants', 'tags', 'collection', 'createdAt', 'updatedAt', 'updated_at', 'metadata', 'versions', 'currentVersionId']) {
      assert.deepEqual(row[field], expected.library[index][field], `${row.id}: ${field}`);
    }
  }
  for (const field of ['schemaVersion', 'trash', 'collections', 'packs', 'scratch', 'runs', 'testCases']) {
    assert.deepEqual(document[field], expected[field], `Workspace ${field}`);
  }
  const source = normalizeWorkspaceImportSource(document);
  const plan = prepareWorkspaceImport(source);
  assert.deepEqual(plan.library.map(row => row.id), expected.library.map(row => row.id));
  assert.equal(plan.library[0].metadata.followUpOrigin.sourcePromptId, 'contract-parent');
  assert.equal(plan.library[0].metadata.followUpOrigin.sourcePromptVersionId, 'parent-v2');
  assert.equal(plan.runs[0].promptId, 'contract-parent');
  assert.equal(plan.runs[0].promptVersionId, 'parent-v2');
  assert.equal(plan.testCases[0].promptId, 'contract-parent');
  assert.deepEqual(plan.warnings, []);
  const repeated = prepareWorkspaceImport(source, plan);
  assert.deepEqual(repeated.library.map(row => row.id), plan.library.map(row => row.id), 'Repeated imports reuse prompt identities');
  return { prompts: plan.library.length, trash: plan.trash.length, runs: plan.runs.length, testCases: plan.testCases.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const document = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(JSON.stringify(process.argv.includes('--native-created') ? verifyNativeCreatedLibrary(document) : verifyLibraryInterchange(document, {
    nativeEdit: process.argv.includes('--native-edit'),
    nativeParentEdit: process.argv.includes('--native-parent-edit'),
  })));
}
