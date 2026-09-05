import { describe, expect, it } from 'vitest';
import { normalizeLibrary } from '../lib/promptSchema.js';
import { normalizeFollowUpOrigin, resolveFollowUpSource } from '../lib/followUpProvenance.js';
import { prepareWorkspaceImport } from '../lib/workspaceImport.js';

const parent = { id: 'parent', title: 'Source', original: 'Source instructions', enhanced: 'Improved source', currentVersionId: 'parent-v1' };
const origin = { sourceKind: 'run-output', sourcePromptId: 'parent', sourcePromptVersionId: 'parent-v1', sourceRunId: 'run', generationId: 'generation', generationModel: 'model', generatedAt: '2026-09-05T00:00:00.000Z' };
const child = { id: 'child', original: 'Next step', enhanced: 'Next step', metadata: { followUpOrigin: origin } };

describe('follow-up provenance persistence', () => {
  it('normalizes only provenance fields without copying settings or source content', () => {
    const normalized = normalizeFollowUpOrigin({ ...origin, apiKey: 'not-a-real-key', text: 'Do not copy output' });
    expect(normalized.generationModel).toBe('model');
    expect(normalized).not.toHaveProperty('apiKey');
    expect(normalized).not.toHaveProperty('text');
    expect(normalizeFollowUpOrigin({ generatedAt: 'bad' }).generatedAt).toBeNull();
  });

  it('does not claim an edited draft is the saved version or previous run output', () => {
    const source = resolveFollowUpSource({ raw: 'Changed', enhanced: 'Changed enhancement', entry: parent, resultMeta: { runId: 'old-run', candidates: [{ id: 'candidate', content: 'Old result' }] } });
    expect(source).toMatchObject({ promptId: 'parent', promptVersionId: null, runId: null, candidateId: null, model: null });
  });

  it('round-trips provenance and remaps colliding parent and run IDs', () => {
    const exported = JSON.parse(JSON.stringify({ library: normalizeLibrary([parent, child]), runs: [{ id: 'run', promptId: 'parent', promptVersionId: 'parent-v1', output: 'Actual answer' }] }));
    const plan = prepareWorkspaceImport(exported, { library: normalizeLibrary([{ ...parent, original: 'Other', enhanced: 'Other' }]), runs: [{ id: 'run', output: 'Different run' }] });
    const savedParent = plan.library.find(row => row.enhanced === 'Improved source');
    const savedChild = plan.library.find(row => row.id === 'child');
    expect(savedParent.id).not.toBe('parent');
    expect(plan.runs[0].id).not.toBe('run');
    expect(savedChild.metadata.followUpOrigin).toMatchObject({ sourcePromptId: savedParent.id, sourcePromptVersionId: savedParent.currentVersionId, sourceRunId: plan.runs[0].id, generationId: 'generation' });
  });

  it('retains external references as unresolved instead of attaching coincidental local IDs', () => {
    const plan = prepareWorkspaceImport({ library: [child] }, { library: normalizeLibrary([parent]), runs: [{ id: 'run', output: 'Unrelated local output' }] });
    const savedOrigin = plan.library.find(row => row.id === 'child').metadata.followUpOrigin;
    expect(savedOrigin).toMatchObject({ sourcePromptId: null, sourceRunId: null, sourcePromptVersionId: null,
      unresolvedReferences: { promptId: 'parent', promptVersionId: 'parent-v1', runId: 'run' } });
    const again = prepareWorkspaceImport({ library: plan.library });
    expect(again.library.find(row => row.id === 'child').metadata.followUpOrigin.unresolvedReferences).toEqual(savedOrigin.unresolvedReferences);
  });
});
