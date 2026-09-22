import { describe, expect, it } from 'vitest';
import { libraryFixture, verifyLibraryInterchange } from '../../../scripts/verify-library-interchange.mjs';
import { normalizeWorkspaceImportSource } from '../lib/workspaceImportPreview.js';
import { prepareWorkspaceImport } from '../lib/workspaceImport.js';

describe('shared Library artifact', () => {
  it('preserves content, identity, manual order, dates and provenance through the shared adapter', () => {
    expect(verifyLibraryInterchange(libraryFixture)).toEqual({ prompts: 2, trash: 1, runs: 1, testCases: 1 });
    const source = normalizeWorkspaceImportSource(libraryFixture);
    for (const [index, entry] of source.library.entries()) {
      expect(entry).toEqual(libraryFixture.library[index]);
    }
  });

  it('keeps distinct original and enhanced content when legacy aliases coexist', () => {
    const source = normalizeWorkspaceImportSource([{
      id: 'mixed', currentVersionId: 'mixed-v1', original: 'Original draft', content: 'Enhanced legacy content',
    }]);
    expect(source.library[0]).toMatchObject({
      id: 'mixed', currentVersionId: 'mixed-v1', original: 'Original draft', enhanced: 'Enhanced legacy content',
    });
  });

  it('rejects ambiguous and corrupt input before preparing writes', () => {
    expect(() => normalizeWorkspaceImportSource({ library: [...libraryFixture.library, libraryFixture.library[0]] })).toThrow('unique');
    for (const entry of [null, 12, { id: 'empty', enhanced: ' ' }, { id: 123, enhanced: 'Invalid identity' }]) {
      expect(() => normalizeWorkspaceImportSource({ library: [entry] })).toThrow();
    }
  });

  it('migrates legacy prompt/category/date aliases once and keeps identity on repeat import', () => {
    const source = normalizeWorkspaceImportSource([{ id: 'legacy', prompt: 'Legacy content', category: 'Old folder', createdAt: '2025-01-01T00:00:00Z', updated_at: '2025-01-02T00:00:00.123Z' }]);
    const first = prepareWorkspaceImport(source);
    expect(first.library[0]).toMatchObject({ id: 'legacy', original: 'Legacy content', enhanced: 'Legacy content', collection: 'Old folder', updatedAt: '2025-01-02T00:00:00.123Z' });
    expect(prepareWorkspaceImport(source, first).library.map(row => row.id)).toEqual(['legacy']);
  });
});
