import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from '../lib/promptSchema.js';
import { buildWorkspaceImportPreview, normalizeWorkspaceImportSource, workspaceImportRevision } from '../lib/workspaceImportPreview.js';

const prompt = (id, title, body) => ({ id, title, original: body, enhanced: body, currentVersionId: `${id}-version` });
const context = () => ({ library: normalizeLibrary([prompt('old', 'Shared title', 'Original body')]), trash: [], runs: [], testCases: [], collections: [], deletedIds: new Set(), generation: '0' });

function preview(incoming, resolutions = {}) {
  return buildWorkspaceImportPreview(normalizeWorkspaceImportSource(incoming), context(), resolutions);
}

describe('workspace import preview', () => {
  it('defaults exact normalized bodies to Skip and maps history to the survivor', () => {
    const result = preview({ library: [prompt('new', 'Other title', 'ORIGINAL  body')], runs: [{ promptId: 'new', output: 'Historical result' }] });
    expect(result.rows[0].choice.action).toBe('skip');
    expect(result.unresolved).toBe(0);
    expect(result.plan.importedCount).toBe(0);
    expect(result.plan.runs[0].promptId).toBe('old');
  });

  it('leaves title and ID conflicts unresolved rather than choosing a destructive default', () => {
    expect(preview([prompt('new', 'Shared title', 'Different body')]).unresolved).toBe(1);
    expect(preview([prompt('old', 'New title', 'Different body')]).unresolved).toBe(1);
  });

  it('keeps both using unique IDs and maps associated records to the incoming identity', () => {
    const result = preview({ library: [prompt('old', 'Shared title', 'Different body')], runs: [{ promptId: 'old', output: 'Incoming run' }] }, { old: { action: 'keep' } });
    expect(result.plan.library).toHaveLength(2);
    const incoming = result.plan.library.find(row => row.enhanced === 'Different body');
    expect(incoming.id).not.toBe('old');
    expect(result.plan.runs[0].promptId).toBe(incoming.id);
  });

  it('replaces the chosen target while retaining old and imported versions and correct run associations', () => {
    const source = { library: [{ ...prompt('new', 'Shared title', 'Replacement body'), versions: [{ id: 'imported-version', original: 'Earlier imported body', enhanced: 'Earlier imported body' }] }], runs: [{ promptId: 'new', promptVersionId: 'new-version', output: 'Incoming run' }] };
    const result = preview(source, { new: { action: 'replace', existingId: 'old' } });
    expect(result.error).toBe('');
    const replaced = result.plan.library[0];
    expect(replaced.id).toBe('old');
    expect(replaced.enhanced).toBe('Replacement body');
    expect(replaced.versions.map(row => row.enhanced)).toEqual(expect.arrayContaining(['Original body', 'Earlier imported body']));
    expect(result.plan.runs[0]).toMatchObject({ promptId: 'old', promptVersionId: replaced.currentVersionId });
    expect(result.plan.replacedCount).toBe(1);
  });

  it('excludes related incoming cases and runs when a different-body conflict is skipped', () => {
    const result = preview({ library: [prompt('new', 'Shared title', 'Different body')], testCases: [{ id: 'case', promptId: 'new', input: 'Example' }], runs: [{ promptId: 'new', testCaseId: 'case', output: 'Incoming run' }] }, { new: { action: 'skip' } });
    expect(result.plan.library).toHaveLength(1);
    expect(result.plan.testCases).toEqual([]);
    expect(result.plan.runs).toEqual([]);
  });

  it('permits explicit Keep both for exact duplicates and detects duplicates within the file', () => {
    const result = preview([prompt('new', 'Other', 'Original body')], { new: { action: 'keep' } });
    expect(result.plan.library).toHaveLength(2);
    const withinFile = preview([prompt('one', 'First', 'New body'), prompt('two', 'Second', 'New body')]);
    expect(withinFile.rows[1].kind).toBe('duplicate');
    expect(withinFile.plan.importedCount).toBe(1);
  });

  it('rejects malformed entries, duplicate source IDs, and unavailable required references', () => {
    expect(() => normalizeWorkspaceImportSource([{ title: 'Empty' }])).toThrow('Invalid prompt entries: 1');
    expect(() => normalizeWorkspaceImportSource([prompt('same', 'A', 'A'), prompt('same', 'B', 'B')])).toThrow('unique');
    expect(preview({ library: [], testCases: [{ promptId: 'missing', input: 'Example' }] }).error).toContain('unavailable prompt');
  });

  it('retains normalized IDs across choice changes and changes its revision for relevant workspace changes', () => {
    const source = normalizeWorkspaceImportSource([{ prompt: 'Legacy body', title: 'Shared title' }]);
    const ctx = context();
    const initial = buildWorkspaceImportPreview(source, ctx);
    const changed = buildWorkspaceImportPreview(source, ctx, { [source.library[0].id]: { action: 'keep' } });
    expect(initial.source.library[0]).toEqual(changed.source.library[0]);
    expect(workspaceImportRevision(ctx)).not.toBe(workspaceImportRevision({ ...ctx, generation: '1' }));
  });
  it('does not exclude unrelated unscoped history when a skipped case has no ID', () => {
    const result = preview({ library: [prompt('new', 'Shared title', 'Different body')],
      testCases: [{ promptId: 'new', input: 'Skip this case' }],
      runs: [{ output: 'Keep this unscoped history' }],
    }, { new: { action: 'skip' } });
    expect(result.plan.runs).toHaveLength(1);
    expect(result.plan.runs[0].output).toBe('Keep this unscoped history');
  });

  it('preserves an existing restore counter when replacing content', () => {
    const ctx = context();
    ctx.library[0].tombstoneVersion = 4;
    const source = normalizeWorkspaceImportSource([prompt('new', 'Shared title', 'Replacement body')]);
    const result = buildWorkspaceImportPreview(source, ctx, { new: { action: 'replace', existingId: 'old' } });
    expect(result.plan.library[0].tombstoneVersion).toBe(4);
  });

  it('replaces a kept incoming collision without overwriting the existing same-ID prompt', () => {
    const result = preview([prompt('old', 'Incoming title', 'Kept incoming'), prompt('later', 'Incoming title', 'Final incoming')], {
      old: { action: 'keep' }, later: { action: 'replace', existingId: 'old', targetSource: 'incoming' },
    });
    expect(result.error).toBe('');
    expect(result.plan.library.find(row => row.id === 'old').enhanced).toBe('Original body');
    const kept = result.plan.library.find(row => row.id !== 'old');
    expect(kept.enhanced).toBe('Final incoming');
    expect(kept.versions.some(row => row.enhanced === 'Kept incoming')).toBe(true);
    expect(result.plan.promptIdMap.get('old')).toBe(kept.id);
    expect(result.plan.promptIdMap.get('later')).toBe(kept.id);
  });

  it.each(['bad registry', [], 42, true])('rejects malformed pack registries before Apply: %j', packs => {
    const result = preview({ library: [], packs });
    expect(result.plan).toBeNull();
    expect(result.error).toContain('Packs must be a registry object');
  });

  it('accepts the empty registry shape emitted by older schema-2 workspace exports', () => {
    const result = preview({ product: 'Prompt Lab', schemaVersion: 2, library: [], packs: [] });
    expect(result.error).toBe('');
    expect(result.source.packs).toEqual({});
  });

});
