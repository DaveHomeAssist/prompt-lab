import { ensureString } from './utils.js';
import { normalizeTagList } from './tagSchema.js';

export const CANDIDATE_ROLES = Object.freeze([
  { id: 'improved', label: 'Improved' },
  { id: 'tighter', label: 'Tighter' },
  { id: 'strict-json', label: 'Strict JSON' },
]);

const safeIdPart = (value, fallback) => ensureString(value)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40) || fallback;

export function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const inputValue = value.input ?? value.inputTokens ?? value.prompt_tokens ?? value.promptTokens;
  const outputValue = value.output ?? value.outputTokens ?? value.completion_tokens ?? value.completionTokens;
  const totalRawValue = value.total ?? value.totalTokens ?? value.total_tokens;
  const input = inputValue === null || inputValue === undefined || inputValue === '' ? Number.NaN : Number(inputValue);
  const output = outputValue === null || outputValue === undefined || outputValue === '' ? Number.NaN : Number(outputValue);
  const totalValue = totalRawValue === null || totalRawValue === undefined || totalRawValue === '' ? Number.NaN : Number(totalRawValue);
  const safeInput = Number.isFinite(input) && input >= 0 ? Math.round(input) : null;
  const safeOutput = Number.isFinite(output) && output >= 0 ? Math.round(output) : null;
  const total = Number.isFinite(totalValue) && totalValue >= 0
    ? Math.round(totalValue)
    : (safeInput !== null || safeOutput !== null ? (safeInput || 0) + (safeOutput || 0) : null);
  if (safeInput === null && safeOutput === null && total === null) return null;
  return { input: safeInput, output: safeOutput, total };
}

export function normalizeAssumptions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    if (typeof item === 'string') {
      const text = item.trim();
      return text ? {
        id: `assumption-${index + 1}-${safeIdPart(text, 'item')}`,
        text,
        addedText: '',
      } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const text = ensureString(item.text || item.label || item.assumption).trim();
    if (!text) return null;
    const addedText = ensureString(item.added_text || item.addedText || item.revert_text || item.revertText);
    return {
      id: ensureString(item.id).trim() || `assumption-${index + 1}-${safeIdPart(text, 'item')}`,
      text,
      addedText: addedText.trim() ? addedText : '',
    };
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
    const type = ['added', 'removed', 'changed'].includes(rawType) ? rawType : 'changed';
    return {
      id: ensureString(item.id).trim() || `change-${index + 1}-${safeIdPart(label, 'item')}`,
      type,
      label,
    };
  }).filter(Boolean).slice(0, 16);
}

export function normalizeReversibleEdits(value, assumptions = []) {
  const source = Array.isArray(value) ? value : [];
  const normalized = source.map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const before = ensureString(item.before ?? item.beforeText ?? item.original_text);
    const after = ensureString(item.after ?? item.afterText ?? item.added_text ?? item.addedText);
    const label = ensureString(item.label || item.text || item.reason).trim()
      || `Reversible edit ${index + 1}`;
    if (!before.trim() && !after.trim()) return null;
    return {
      id: ensureString(item.id).trim() || `edit-${index + 1}-${safeIdPart(label, 'change')}`,
      label,
      operation: ['add', 'remove', 'replace'].includes(ensureString(item.operation).toLowerCase())
        ? ensureString(item.operation).toLowerCase()
        : before.trim() && after.trim() ? 'replace' : before.trim() ? 'remove' : 'add',
      before,
      after,
      candidateId: ensureString(item.candidateId || item.candidate_id).trim() || 'improved',
      reverted: item.reverted === true,
    };
  }).filter(Boolean);

  // Older providers exposed only assumption.addedText. Upgrade those records
  // into the explicit reversible-edit contract without losing their IDs.
  assumptions.forEach((assumption) => {
    if (!assumption.addedText?.trim()) return;
    if (normalized.some((edit) => edit.after === assumption.addedText)) return;
    normalized.push({
      id: `edit-${assumption.id}`,
      label: assumption.text,
      operation: 'add',
      before: '',
      after: assumption.addedText,
      candidateId: 'improved',
      reverted: false,
    });
  });
  return normalized.slice(0, 20);
}

export function buildResultCandidates(enhanced, variants = []) {
  const primary = ensureString(enhanced).trim();
  const rows = primary ? [{ id: 'improved', label: 'Improved', role: 'improved', content: enhanced }] : [];
  (Array.isArray(variants) ? variants : []).forEach((variant, index) => {
    const content = ensureString(variant?.content).trim();
    if (!content) return;
    const canonical = CANDIDATE_ROLES[index + 1];
    const label = canonical?.label || ensureString(variant?.label).trim() || `Variant ${index + 1}`;
    rows.push({
      id: canonical?.id || `variant-${index + 1}-${safeIdPart(label, 'result')}`,
      label,
      role: canonical?.id || 'variant',
      content: variant.content,
    });
  });
  return rows.slice(0, 3);
}

export function normalizeResultMeta(value = {}, content = {}) {
  const assumptions = normalizeAssumptions(value.assumptions);
  const candidates = Array.isArray(value.candidates) && value.candidates.length > 0
    ? value.candidates.map((candidate, index) => ({
      id: CANDIDATE_ROLES[index]?.id || ensureString(candidate?.id).trim() || `candidate-${index + 1}`,
      label: CANDIDATE_ROLES[index]?.label || ensureString(candidate?.label).trim() || `Candidate ${index + 1}`,
      role: CANDIDATE_ROLES[index]?.id || ensureString(candidate?.role).trim() || 'variant',
      content: ensureString(candidate?.content),
    })).filter((candidate) => candidate.content.trim()).slice(0, 3)
    : buildResultCandidates(content.enhanced, content.variants);
  const selectedCandidateId = candidates.some((candidate) => candidate.id === value.selectedCandidateId)
    ? value.selectedCandidateId
    : candidates[0]?.id || '';
  return {
    candidates,
    selectedCandidateId,
    changeSummary: ensureString(value.changeSummary || value.change_summary).trim(),
    changes: normalizeSemanticChanges(value.changes),
    assumptions,
    reversibleEdits: normalizeReversibleEdits(value.reversibleEdits || value.reversible_edits, assumptions),
    reasoning: ensureString(value.reasoning).trim(),
    tags: normalizeTagList(value.tags),
    provider: ensureString(value.provider).trim(),
    model: ensureString(value.model).trim(),
    latencyMs: Number.isFinite(value.latencyMs) ? Math.max(0, Math.round(value.latencyMs)) : null,
    usage: normalizeTokenUsage(value.usage),
    runId: ensureString(value.runId).trim(),
  };
}

export function revertStructuredEdit(text, edit) {
  const source = ensureString(text);
  if (!edit || edit.reverted === true) return { changed: false, text: source };
  const before = ensureString(edit.before);
  const after = ensureString(edit.after);
  if (after && source.includes(after)) {
    const next = source.replace(after, before).replace(/\n{3,}/g, '\n\n').trim();
    return { changed: next !== source.trim(), text: next };
  }
  if (!after && before && !source.includes(before)) {
    const next = `${source.trim()}\n\n${before}`.trim();
    return { changed: next !== source.trim(), text: next };
  }
  return { changed: false, text: source };
}

export function replaceCandidateContent(resultMeta, candidateId, content) {
  const normalized = normalizeResultMeta(resultMeta);
  return {
    ...normalized,
    selectedCandidateId: candidateId,
    candidates: normalized.candidates.map((candidate) => (
      candidate.id === candidateId ? { ...candidate, content: ensureString(content) } : candidate
    )),
  };
}

export function revertAssumptionFromText(text, assumption) {
  const source = ensureString(text);
  const addedText = ensureString(assumption?.addedText);
  if (!addedText.trim() || !source.includes(addedText)) return { changed: false, text: source };
  const next = source
    .replace(addedText, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  return { changed: next !== source.trim(), text: next };
}
