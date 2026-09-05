const SOURCE_KINDS = new Set(['run-output', 'enhanced-prompt', 'draft-prompt', 'unknown']);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

/** Only provenance fields cross persistence; provider settings never do. */
export function normalizeFollowUpOrigin(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const generatedAt = text(value.generatedAt);
  const unresolved = value.unresolvedReferences;
  return {
    version: 1,
    generationId: text(value.generationId),
    generatedAt: generatedAt && Number.isFinite(Date.parse(generatedAt)) ? generatedAt : null,
    generationProvider: text(value.generationProvider),
    generationModel: text(value.generationModel),
    sourceKind: SOURCE_KINDS.has(value.sourceKind) ? value.sourceKind : 'unknown',
    sourcePromptId: text(value.sourcePromptId),
    sourcePromptVersionId: text(value.sourcePromptVersionId),
    sourceRunId: text(value.sourceRunId),
    sourceCandidateId: text(value.sourceCandidateId),
    sourceTitle: text(value.sourceTitle),
    sourceProvider: text(value.sourceProvider),
    sourceModel: text(value.sourceModel),
    redacted: value.redacted === true,
    ...(unresolved && typeof unresolved === 'object' ? { unresolvedReferences: {
      promptId: text(unresolved.promptId), promptVersionId: text(unresolved.promptVersionId),
      runId: text(unresolved.runId), candidateId: text(unresolved.candidateId),
    } } : {}),
  };
}

export function describeFollowUpSource(origin) {
  const kind = origin?.sourceKind;
  return kind === 'run-output' ? 'Saved run output' : kind === 'enhanced-prompt' ? 'Enhanced prompt' : kind === 'draft-prompt' ? 'Editor draft' : 'Unknown source';
}

export function resolveFollowUpSource({ raw = '', enhanced = '', entry = null, resultMeta = null, run = null }) {
  if (run) return {
    text: run.output || '', kind: 'run-output', promptId: run.promptId || null,
    promptVersionId: run.promptVersionId || null, runId: run.id, candidateId: null,
    title: run.promptTitle || entry?.title || null, provider: run.provider || null, model: run.model || null,
  };
  const candidate = resultMeta?.candidates?.find(item => item.content === enhanced);
  const matchesSaved = entry && entry.enhanced === enhanced && entry.original === raw;
  return {
    text: enhanced || raw, kind: enhanced ? 'enhanced-prompt' : 'draft-prompt',
    promptId: entry?.id || null, promptVersionId: matchesSaved ? entry.currentVersionId : null,
    runId: candidate ? resultMeta?.runId || null : null,
    candidateId: candidate?.id || null, title: entry?.title || null,
    provider: candidate ? resultMeta?.provider || null : null,
    model: candidate ? resultMeta?.model || null : null,
  };
}
