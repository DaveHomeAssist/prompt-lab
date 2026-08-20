import { ensureString } from './utils.js';

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

export function buildResultCandidates(enhanced, variants = []) {
  const primary = ensureString(enhanced).trim();
  const rows = primary ? [{ id: 'improved', label: 'Improved', content: enhanced }] : [];
  (Array.isArray(variants) ? variants : []).forEach((variant, index) => {
    const content = ensureString(variant?.content).trim();
    if (!content) return;
    const label = ensureString(variant?.label).trim() || `Variant ${index + 1}`;
    rows.push({
      id: `variant-${index + 1}-${safeIdPart(label, 'result')}`,
      label,
      content: variant.content,
    });
  });
  return rows;
}

export function normalizeResultMeta(value = {}, content = {}) {
  const candidates = Array.isArray(value.candidates) && value.candidates.length > 0
    ? value.candidates.map((candidate, index) => ({
      id: ensureString(candidate?.id).trim() || `candidate-${index + 1}`,
      label: ensureString(candidate?.label).trim() || `Candidate ${index + 1}`,
      content: ensureString(candidate?.content),
    })).filter((candidate) => candidate.content.trim())
    : buildResultCandidates(content.enhanced, content.variants);
  const selectedCandidateId = candidates.some((candidate) => candidate.id === value.selectedCandidateId)
    ? value.selectedCandidateId
    : candidates[0]?.id || '';
  return {
    candidates,
    selectedCandidateId,
    changeSummary: ensureString(value.changeSummary || value.change_summary).trim(),
    changes: normalizeSemanticChanges(value.changes),
    assumptions: normalizeAssumptions(value.assumptions),
    reasoning: ensureString(value.reasoning).trim(),
    provider: ensureString(value.provider).trim(),
    model: ensureString(value.model).trim(),
    latencyMs: Number.isFinite(value.latencyMs) ? Math.max(0, Math.round(value.latencyMs)) : null,
    usage: normalizeTokenUsage(value.usage),
    runId: ensureString(value.runId).trim(),
  };
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
