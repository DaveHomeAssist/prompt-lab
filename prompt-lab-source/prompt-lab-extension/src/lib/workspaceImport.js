import { arePromptSnapshotsEqual, normalizeLibrary } from './promptSchema.js';
import { normalizeEvalRunRecord, normalizeTestCaseRecord } from './evalSchema.js';
import { mergeLibraryEntries } from './libraryMatching.js';

function reference(value, label) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string or null.`);
  return value.trim();
}

function uniqueSourceIds(rows, label) {
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Invalid ${label} record.`);
    const id = reference(row.id, `${label} ID`);
    if (id && ids.has(id)) throw new Error(`Duplicate ${label} ID: ${id}. Resolve the ambiguity before importing.`);
    if (id) ids.add(id);
  }
}

function versions(entry) {
  if (!entry) return [];
  return [{ ...entry, id: entry.currentVersionId }, ...(entry.versions || [])];
}

// Pure preparation: all generated IDs and association decisions are retained
// in this plan so a failed write can retry without duplicating records.
export function prepareWorkspaceImport(parsed, {
  library = [], trash = [], runs = [], testCases = [], generation = '0', deletedIds = new Set(),
} = {}) {
  const payload = Array.isArray(parsed) ? parsed : parsed?.library || parsed?.prompts || parsed?.presets || parsed?.entries || [];
  if (!Array.isArray(payload)) throw new Error('The prompt list must be an array.');
  for (const key of ['runs', 'testCases', 'trash', 'collections']) {
    if (parsed?.[key] != null && !Array.isArray(parsed[key])) throw new Error(`${key} must be an array.`);
  }
  if (parsed?.scratch != null && (!Array.isArray(parsed.scratch.pads)
    || !parsed.scratch.pads.length || parsed.scratch.pads.some((pad) => !pad || typeof pad.content !== 'string'))) {
    throw new Error('Scratch must contain readable note records.');
  }
  uniqueSourceIds(payload, 'prompt');
  uniqueSourceIds(parsed?.runs || [], 'run');
  uniqueSourceIds(parsed?.testCases || [], 'test case');
  const incoming = normalizeLibrary(payload.map((entry) => ({
    ...entry,
    original: entry.original || entry.prompt || entry.content || entry.enhanced,
    enhanced: entry.enhanced || entry.prompt || entry.content || entry.original,
    metadata: { ...entry.metadata, libraryGeneration: generation },
  })));
  uniqueSourceIds([...payload, ...(parsed?.trash || [])], 'prompt');
  const incomingTrash = normalizeLibrary((parsed?.trash || []).map((entry) => ({
    ...entry, metadata: { ...entry.metadata, libraryGeneration: generation },
  })));
  const result = mergeLibraryEntries(library, incoming, {
    prepend: true, blockedIds: new Set([...deletedIds, ...trash.map((entry) => entry.id)]),
  });
  const usedIds = new Set([...deletedIds, ...result.library.map((entry) => entry.id)]);
  const mappedTrash = incomingTrash.map((entry) => {
    const id = usedIds.has(entry.id) ? crypto.randomUUID() : entry.id;
    usedIds.add(id);
    result.promptIdMap.set(entry.id, id);
    return { ...entry, id };
  });
  const survivors = new Map([...trash, ...result.library, ...mappedTrash].map((entry) => [entry.id, entry]));
  const sources = new Map([...incoming, ...incomingTrash].map((entry) => [entry.id, entry]));
  const warnings = [];
  const resolvePrompt = (id) => result.promptIdMap.get(id) || (survivors.has(id) ? id : null);
  const caseIdMap = new Map();
  const runIdMap = new Map();
  const mappedCases = (parsed?.testCases || []).map((record) => {
    const sourceId = reference(record.promptId, 'Test case promptId');
    const promptId = resolvePrompt(sourceId);
    if (!promptId) throw new Error(`Test case ${record.id || '(new)'} references unavailable prompt ${sourceId || '(none)'}.`);
    if (typeof record.input !== 'string' || !record.input.trim()) throw new Error('Test cases require nonempty input.');
    const previous = testCases.find((row) => row.id === record.id);
    const normalized = normalizeTestCaseRecord({
      ...record, promptId, createdAt: record.createdAt || previous?.createdAt,
      updatedAt: record.updatedAt || previous?.updatedAt,
    });
    const existing = testCases.find((row) => row.id === normalized.id);
    if (existing && JSON.stringify(normalizeTestCaseRecord(existing)) !== JSON.stringify(normalized)) normalized.id = crypto.randomUUID();
    if (record.id) caseIdMap.set(record.id, normalized.id);
    return normalized;
  });
  const mappedRuns = (parsed?.runs || []).map((record) => {
    const sourceId = reference(record.promptId, 'Run promptId');
    const promptId = resolvePrompt(sourceId);
    const sourceVersionId = reference(record.promptVersionId, 'Run promptVersionId');
    const sourceCaseId = reference(record.testCaseId, 'Run testCaseId');
    const survivor = survivors.get(promptId);
    const source = sources.get(sourceId) || survivor;
    const sourceVersion = versions(source).find((version) => version.id === sourceVersionId);
    const survivorVersion = sourceVersion && versions(survivor).find((version) => arePromptSnapshotsEqual(sourceVersion, version));
    const promptVersionId = sourceVersionId ? survivorVersion?.id || null : null;
    const mappedCaseId = caseIdMap.get(sourceCaseId) || sourceCaseId;
    const testCaseId = [...mappedCases, ...testCases].find((row) => row.id === mappedCaseId && row.promptId === promptId)?.id || null;
    const unresolved = [
      sourceId && !promptId && `prompt ${sourceId}`,
      sourceVersionId && !promptVersionId && `version ${sourceVersionId}`,
      sourceCaseId && !testCaseId && `test case ${sourceCaseId}`,
    ].filter(Boolean);
    const note = unresolved.length ? `Imported history has unresolved source references: ${unresolved.join(', ')}.` : '';
    if (note) warnings.push(note);
    const previous = runs.find((row) => row.id === record.id);
    const normalized = normalizeEvalRunRecord({
      ...record, promptId, promptVersionId, testCaseId, createdAt: record.createdAt || previous?.createdAt,
      // Preserve the source reference even when a long existing note needs truncation.
      notes: [note, record.notes].filter(Boolean).join('\n'),
    });
    const existing = runs.find((row) => row.id === normalized.id);
    const originalAssociations = existing && {
      ...normalized, promptId: existing.promptId, promptVersionId: existing.promptVersionId,
      testCaseId: existing.testCaseId || null, notes: existing.notes || '',
    };
    if (existing && JSON.stringify(normalizeEvalRunRecord(existing)) !== JSON.stringify(originalAssociations)) normalized.id = crypto.randomUUID();
    if (record.id) runIdMap.set(record.id, normalized.id);
    return normalized;
  });
  const mapPromptReferences = (entry) => {
    const unresolved = [];
    const mapRunReference = (id) => {
      const sourceId = reference(id, 'Prompt run reference');
      const resolved = runIdMap.get(sourceId) || runs.find((run) => run.id === sourceId)?.id;
      if (sourceId && !resolved) unresolved.push(sourceId);
      return resolved || '';
    };
    const mapped = {
      ...entry,
      resultMeta: entry.resultMeta && { ...entry.resultMeta, runId: mapRunReference(entry.resultMeta.runId) },
      goldenResponse: entry.goldenResponse && { ...entry.goldenResponse, pinnedFromRunId: mapRunReference(entry.goldenResponse.pinnedFromRunId) },
      versions: entry.versions.map((version) => ({
        ...version, resultMeta: version.resultMeta && { ...version.resultMeta, runId: mapRunReference(version.resultMeta.runId) },
      })),
    };
    if (unresolved.length) {
      mapped.metadata = { ...entry.metadata, unresolvedRunIds: [...new Set(unresolved)] };
      warnings.push(`Imported prompt ${entry.id} has unresolved run references: ${unresolved.join(', ')}.`);
    }
    return mapped;
  };
  const existingIds = new Set(library.map((entry) => entry.id));
  const mapScratchPad = (pad) => {
    const unresolved = [];
    const mapLink = (id) => {
      const sourceId = reference(id, 'Scratch prompt reference');
      const resolved = resolvePrompt(sourceId);
      if (sourceId && !resolved) unresolved.push(sourceId);
      return resolved;
    };
    const linkedPromptId = pad.linkedPromptId ? mapLink(pad.linkedPromptId) : pad.linkedPromptId;
    const linkedPrompts = Array.isArray(pad.linkedPrompts)
      ? pad.linkedPrompts.map((link) => ({ ...link, id: mapLink(link.id) })).filter((link) => link.id)
      : pad.linkedPrompts;
    if (unresolved.length) warnings.push(`Scratch note ${pad.id} has unresolved prompt references: ${unresolved.join(', ')}.`);
    return {
      ...pad, linkedPromptId,
      ...(linkedPrompts ? { linkedPrompts } : {}),
      ...(unresolved.length ? { unresolvedPromptLinks: [...new Set(unresolved)] } : {}),
    };
  };
  const scratch = parsed?.scratch && {
    ...parsed.scratch,
    pads: Array.isArray(parsed.scratch.pads) ? parsed.scratch.pads.map(mapScratchPad) : parsed.scratch.pads,
  };
  return {
    ...result,
    library: result.library.map((entry) => existingIds.has(entry.id) ? entry : mapPromptReferences(entry)),
    trash: mappedTrash.map(mapPromptReferences),
    runs: mappedRuns, testCases: mappedCases, warnings, generation, scratch,
  };
}
