import { ensureString } from './utils.js';
import { normalizeTagList } from './tagSchema.js';

export const CANDIDATE_ROLES = Object.freeze([
  { id: 'improved', label: 'Improved' }, { id: 'tighter', label: 'Tighter' }, { id: 'strict-json', label: 'Strict JSON' },
]);
const MODERN_LABELS = Object.freeze({ expanded: 'Expanded', refined: 'Refined', rebuilt: 'Rebuilt', shorten: 'Shortened', json: 'JSON' });
// Some old model responses used "json" for Strict JSON. It is not a schema discriminator.
const isModernId = id => ['expanded', 'refined', 'rebuilt', 'shorten'].includes(id);
const safeIdPart = (value, fallback) => ensureString(value).trim().toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || fallback;

export function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const read = raw => raw === null || raw === undefined || raw === '' ? Number.NaN : Number(raw);
  const input = read(value.input ?? value.inputTokens ?? value.prompt_tokens ?? value.promptTokens);
  const output = read(value.output ?? value.outputTokens ?? value.completion_tokens ?? value.completionTokens);
  const totalValue = read(value.total ?? value.totalTokens ?? value.total_tokens);
  const safeInput = Number.isFinite(input) && input >= 0 ? Math.round(input) : null;
  const safeOutput = Number.isFinite(output) && output >= 0 ? Math.round(output) : null;
  const total = Number.isFinite(totalValue) && totalValue >= 0 ? Math.round(totalValue)
    : safeInput !== null || safeOutput !== null ? (safeInput || 0) + (safeOutput || 0) : null;
  if (safeInput === null && safeOutput === null && total === null) return null;
  return { input: safeInput, output: safeOutput, total };
}
export function normalizeAssumptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') {
      const text = item.trim();
      return text ? { id: `assumption-${index + 1}-${safeIdPart(text, 'item')}`, text, addedText: '' } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const text = ensureString(item.text || item.label || item.assumption).trim();
    if (!text) return null;
    const addedText = ensureString(item.added_text || item.addedText || item.revert_text || item.revertText);
    const candidateId = ensureString(item.candidateId || item.candidate_id).trim();
    return { id: ensureString(item.id).trim() || `assumption-${index + 1}-${safeIdPart(text, 'item')}`, text,
      addedText: addedText.trim() ? addedText : '', ...(candidateId ? { candidateId } : {}) };
  }).filter(Boolean).slice(0, 12);
}
export function normalizeSemanticChanges(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? { id: `change-${index + 1}`, type: 'changed', label } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const label = ensureString(item.label || item.text || item.change).trim();
    if (!label) return null;
    const rawType = ensureString(item.type).trim().toLowerCase();
    const candidateId = ensureString(item.candidateId || item.candidate_id).trim();
    return { id: ensureString(item.id).trim() || `change-${index + 1}-${safeIdPart(label, 'item')}`,
      type: ['added', 'removed', 'changed'].includes(rawType) ? rawType : 'changed', label,
      ...(candidateId ? { candidateId } : {}) };
  }).filter(Boolean).slice(0, 16);
}
export function normalizeReversibleEdits(value, assumptions = []) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const before = ensureString(item.before ?? item.beforeText ?? item.original_text);
    const after = ensureString(item.after ?? item.afterText ?? item.added_text ?? item.addedText);
    const label = ensureString(item.label || item.text || item.reason).trim() || `Reversible edit ${index + 1}`;
    if (!before.trim() && !after.trim()) return null;
    return {
      id: ensureString(item.id).trim() || `edit-${index + 1}-${safeIdPart(label, 'change')}`, label,
      operation: ['add', 'remove', 'replace'].includes(ensureString(item.operation).toLowerCase())
        ? ensureString(item.operation).toLowerCase() : before.trim() && after.trim() ? 'replace' : before.trim() ? 'remove' : 'add',
      before, after, candidateId: ensureString(item.candidateId || item.candidate_id).trim() || 'improved', reverted: item.reverted === true,
    };
  }).filter(Boolean);
  assumptions.forEach(assumption => {
    if (!assumption.addedText?.trim()) return;
    const candidateId = assumption.candidateId || 'improved';
    if (normalized.some(edit => edit.after === assumption.addedText && edit.candidateId === candidateId)) return;
    normalized.push({ id: `edit-${assumption.id}`, label: assumption.text, operation: 'add', before: '',
      after: assumption.addedText, candidateId, reverted: false });
  });
  return normalized.slice(0, 20);
}
function candidateIdentity(candidate, index, modern = false) {
  const explicit = ensureString(candidate?.id || candidate?.role).trim();
  const fromLabel = modern ? Object.entries(MODERN_LABELS)
    .find(([, label]) => label.toLowerCase() === ensureString(candidate?.label).trim().toLowerCase())?.[0] : '';
  const legacy = CANDIDATE_ROLES[index];
  const id = modern || isModernId(explicit) ? explicit || fromLabel || `candidate-${index + 1}` : legacy?.id || explicit || `candidate-${index + 1}`;
  const known = MODERN_LABELS[id] || CANDIDATE_ROLES.find(item => item.id === id)?.label;
  return { id, label: known || ensureString(candidate?.label).trim() || `Candidate ${index + 1}`, role: id };
}
export function buildResultCandidates(enhanced, variants = [], primaryId = 'improved') {
  const modern = Boolean(MODERN_LABELS[primaryId]);
  const rows = ensureString(enhanced).trim() ? [{ ...candidateIdentity({ id: primaryId }, 0, modern), content: enhanced }] : [];
  (Array.isArray(variants) ? variants : []).forEach((variant, index) => {
    if (ensureString(variant?.content).trim()) rows.push({ ...candidateIdentity(variant, index + 1, modern), content: variant.content });
  });
  return rows.filter((row, index) => rows.findIndex(item => item.id === row.id) === index).slice(0, modern ? 5 : 3);
}
export function normalizeResultMeta(value = {}, content = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackContent = content && typeof content === 'object' ? content : {};
  const primaryId = ensureString(source.primaryId || source.primary_id).trim()
    || (source.schemaVersion === 2 ? ensureString(source.candidates?.[0]?.id).trim() : '') || 'improved';
  const modern = source.schemaVersion === 2 || source.schema_version === 2 || Boolean(MODERN_LABELS[primaryId])
    || (Array.isArray(source.candidates) && source.candidates.some(item => isModernId(item?.id)));
  const rows = Array.isArray(source.candidates) && source.candidates.length > 0
    ? source.candidates.map((candidate, index) => ({ ...candidateIdentity(candidate, index, modern), content: ensureString(candidate?.content) }))
      .filter(candidate => candidate.content.trim()).slice(0, modern ? 5 : 3)
    : buildResultCandidates(fallbackContent.enhanced, fallbackContent.variants, primaryId);
  const candidates = rows.filter((row, index) => rows.findIndex(item => item.id === row.id) === index);
  const resolvedPrimaryId = candidates.some(item => item.id === primaryId) ? primaryId : candidates[0]?.id || primaryId;
  const selectedCandidateId = candidates.some(candidate => candidate.id === source.selectedCandidateId)
    ? source.selectedCandidateId : candidates[0]?.id || '';
  const scopeToPrimary = item => modern && !item.candidateId ? { ...item, candidateId: resolvedPrimaryId } : item;
  const assumptions = normalizeAssumptions(source.assumptions).map(scopeToPrimary);
  const rawEdits = source.reversibleEdits || source.reversible_edits;
  const edits = modern && Array.isArray(rawEdits) ? rawEdits.map(item => {
    if (!item || typeof item !== 'object') return item;
    const id = item.candidateId || item.candidate_id;
    return !id || (id === 'improved' && !candidates.some(candidate => candidate.id === id))
      ? { ...item, candidateId: resolvedPrimaryId } : item;
  }) : rawEdits;
  return {
    ...(modern ? { schemaVersion: 2, primaryId: resolvedPrimaryId } : {}), candidates, selectedCandidateId,
    ...(Number.isFinite(source.requestedOutputTokens) ? { requestedOutputTokens: source.requestedOutputTokens } : {}),
    ...(source.metadataIncomplete === true ? { metadataIncomplete: true } : {}),
    changeSummary: ensureString(source.changeSummary || source.change_summary).trim(),
    changes: normalizeSemanticChanges(source.changes).map(scopeToPrimary), assumptions,
    reversibleEdits: normalizeReversibleEdits(edits, assumptions), reasoning: ensureString(source.reasoning).trim(),
    tags: normalizeTagList(source.tags), provider: ensureString(source.provider).trim(), model: ensureString(source.model).trim(),
    latencyMs: Number.isFinite(source.latencyMs) ? Math.max(0, Math.round(source.latencyMs)) : null,
    usage: normalizeTokenUsage(source.usage), runId: ensureString(source.runId).trim(),
  };
}
export function revertStructuredEdit(text, edit) {
  const source = ensureString(text);
  if (!edit || edit.reverted === true) return { changed: false, text: source };
  const before = ensureString(edit.before); const after = ensureString(edit.after);
  if (after && source.includes(after)) {
    const next = source.replace(after, before).replace(/\n{3,}/g, '\n\n').trim();
    return { changed: next !== source.trim(), text: next };
  }
  if (!after && before && !source.includes(before)) {
    const next = `${source.trim()}\n\n${before}`.trim(); return { changed: next !== source.trim(), text: next };
  }
  return { changed: false, text: source };
}
export function replaceCandidateContent(resultMeta, candidateId, content) {
  const normalized = normalizeResultMeta(resultMeta);
  return { ...normalized, selectedCandidateId: candidateId,
    candidates: normalized.candidates.map(candidate => candidate.id === candidateId ? { ...candidate, content: ensureString(content) } : candidate) };
}
export function revertAssumptionFromText(text, assumption) {
  const source = ensureString(text); const addedText = ensureString(assumption?.addedText);
  if (!addedText.trim() || !source.includes(addedText)) return { changed: false, text: source };
  const next = source.replace(addedText, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return { changed: next !== source.trim(), text: next };
}
