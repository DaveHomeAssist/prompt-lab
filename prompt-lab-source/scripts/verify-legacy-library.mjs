import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Reuse the historical web export already consumed by native interchange tests.
export const legacyLibraryFixture = JSON.parse(readFileSync(new URL('../../prompt-lab-ios/PromptLabTests/Fixtures/web-library-export-1.7.0.json', import.meta.url), 'utf8'));

export function verifyLegacyLibrary(library) {
  for (const source of legacyLibraryFixture.library) {
    const matches = library.filter(row => row.id === source.id);
    assert.equal(matches.length, 1, 'Legacy identity survives exactly once');
    const actual = matches[0];
    for (const field of ['title', 'original', 'enhanced', 'notes', 'tags', 'collection', 'createdAt', 'updatedAt', 'currentVersionId', 'inputs']) {
      assert.deepEqual(actual[field], source[field], `Legacy ${source.id}: ${field}`);
    }
    assert.deepEqual(actual.variants.map(({ label, content }) => ({ label, content })), source.variants);
    assert.equal(actual.versions.length, source.versions.length);
    for (const version of source.versions) {
      const saved = actual.versions.find(row => row.id === version.id);
      assert.ok(saved, 'Historical version identity survives');
      for (const field of ['original', 'enhanced', 'notes', 'savedAt', 'changeNote']) assert.deepEqual(saved[field], version[field]);
    }
    assert.equal(actual.goldenResponse.text, source.goldenResponse.text);
    assert.deepEqual(actual.testCases, source.testCases);
    for (const field of ['owner', 'purpose', 'status', 'compatibility', 'riskLevel', 'customField']) assert.deepEqual(actual.metadata[field], source.metadata[field]);
    assert.equal(actual.metadata.followUpOrigin.sourcePromptId, 'external-parent');
    assert.equal(actual.metadata.followUpOrigin.sourceRunId, 'external-run');
  }
}
