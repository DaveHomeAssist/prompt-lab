import { expect, it } from 'vitest';
import { prepareWorkspaceImport } from '../lib/workspaceImport.js';

const prompt = (id, body = 'Shared body', extra = {}) => ({
  id, title: id, original: body, enhanced: body, currentVersionId: `${id}-version`, ...extra,
});

it('maps deduplicated prompt, version and test-case references to the survivor', () => {
  const plan = prepareWorkspaceImport({
    library: [prompt('imported')],
    testCases: [{ id: 'case', promptId: 'imported', input: 'Fixture input' }],
    runs: [{ id: 'run', promptId: 'imported', promptVersionId: 'imported-version', testCaseId: 'case', input: 'Fixture input', output: 'Fixture output' }],
  }, { library: [prompt('local')] });
  expect(plan.importedCount).toBe(0);
  expect(plan.testCases[0].promptId).toBe('local');
  expect(plan.runs[0]).toMatchObject({ promptId: 'local', promptVersionId: 'local-version', testCaseId: 'case' });
  expect(plan.warnings).toEqual([]);
});

it('keeps new prompts and intentionally unscoped legacy history', () => {
  const plan = prepareWorkspaceImport({ prompts: [prompt('new')], runs: [{ id: 'run', input: 'No prompt association' }] });
  expect(plan.library[0].id).toBe('new');
  expect(plan.runs[0]).toMatchObject({ promptId: null, promptVersionId: null, testCaseId: null });
  expect(plan.warnings).toEqual([]);
});

it('does not overwrite a different prompt with the same ID or reuse a permanently deleted ID', () => {
  const plan = prepareWorkspaceImport({
    library: [prompt('collision', 'New body'), prompt('deleted', 'Recovered body')],
    runs: [{ promptId: 'collision' }, { promptId: 'deleted' }],
  }, { library: [prompt('collision', 'Local body')], deletedIds: new Set(['deleted']), generation: 'current' });
  expect(plan.library).toHaveLength(3);
  expect(plan.runs[0].promptId).not.toBe('collision');
  expect(plan.runs[1].promptId).not.toBe('deleted');
  expect(plan.library.find((row) => row.id === plan.runs[1].promptId).metadata.libraryGeneration).toBe('current');
});

it('explicitly records unresolved source references without inventing a local link', () => {
  const plan = prepareWorkspaceImport({ runs: [{ promptId: 'absent', promptVersionId: 'absent-version', testCaseId: 'absent-case' }] });
  expect(plan.runs[0]).toMatchObject({ promptId: null, promptVersionId: null, testCaseId: null });
  expect(plan.runs[0].notes).toContain('prompt absent, version absent-version, test case absent-case');
  expect(plan.warnings).toHaveLength(1);
});

it('rejects malformed or ambiguous references and missing test-case parents before any writes', () => {
  expect(() => prepareWorkspaceImport({ runs: [{ promptId: {} }] })).toThrow('Run promptId');
  expect(() => prepareWorkspaceImport({ library: [prompt('same'), prompt('same', 'Other body')] })).toThrow('Duplicate prompt ID');
  expect(() => prepareWorkspaceImport({ testCases: [{ promptId: 'missing', input: 'Input' }] })).toThrow('unavailable prompt');
  expect(() => prepareWorkspaceImport({ scratch: { pads: [{ id: 'broken' }] } })).toThrow('readable note records');
});

it('retains historical version associations only when the snapshot exists in the survivor', () => {
  const old = { id: 'old-local', original: 'Old body', enhanced: 'Old body' };
  const plan = prepareWorkspaceImport({
    library: [prompt('source', 'Shared body', { versions: [{ ...old, id: 'old-source' }] })],
    runs: [{ promptId: 'source', promptVersionId: 'old-source' }],
  }, { library: [prompt('local', 'Shared body', { versions: [old] })] });
  expect(plan.runs[0].promptVersionId).toBe('old-local');
});

it('preserves trash history and rebases explicit backup imports after a clear', () => {
  const plan = prepareWorkspaceImport({
    trash: [prompt('trashed', 'Trash body', { deletedAt: new Date().toISOString(), metadata: { libraryGeneration: 'old' } })],
    runs: [{ promptId: 'trashed' }],
  }, { generation: 'new' });
  expect(plan.library).toEqual([]);
  expect(plan.trash[0].metadata.libraryGeneration).toBe('new');
  expect(plan.runs[0].promptId).toBe(plan.trash[0].id);
});

it('maps imported result and golden references when a run ID collides', () => {
  const plan = prepareWorkspaceImport({
    library: [prompt('new', 'New body', {
      resultMeta: { runId: 'collision' },
      goldenResponse: { text: 'Golden', pinnedFromRunId: 'collision' },
    })],
    runs: [{ id: 'collision', promptId: 'new', output: 'Imported output' }],
  }, { runs: [{ id: 'collision', output: 'Local output' }] });
  expect(plan.runs[0].id).not.toBe('collision');
  expect(plan.library[0].resultMeta.runId).toBe(plan.runs[0].id);
  expect(plan.library[0].goldenResponse.pinnedFromRunId).toBe(plan.runs[0].id);
});

it('retains unresolved result-run origins in metadata', () => {
  const plan = prepareWorkspaceImport([prompt('new', 'New body', { resultMeta: { runId: 'external-run' } })]);
  expect(plan.library[0].resultMeta.runId).toBe('');
  expect(plan.library[0].metadata.unresolvedRunIds).toEqual(['external-run']);
  expect(plan.warnings).toHaveLength(1);
});

it('keeps IDs when reimporting unchanged legacy records without timestamps', () => {
  const source = {
    library: [prompt('prompt')],
    runs: [{ id: 'run', promptId: 'prompt', output: 'Output' }],
    testCases: [{ id: 'case', promptId: 'prompt', input: 'Input' }],
  };
  const first = prepareWorkspaceImport(source);
  const second = prepareWorkspaceImport(source, first);
  expect(second.runs[0].id).toBe('run');
  expect(second.testCases[0].id).toBe('case');
});
