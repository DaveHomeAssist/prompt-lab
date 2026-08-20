import { ensureString } from './utils.js';

export const ENHANCEMENT_QUALITY_POLICY = Object.freeze({
  minimumChangedTokens: 3,
  maximumCorrectionPasses: 1,
});

const REASONING_ACTION = /\b(add(?:ed|ing)?|clarif(?:y|ied|ies)|defin(?:e|ed|es)|remov(?:e|ed|es)|replac(?:e|ed|es)|specif(?:y|ied|ies)|structur(?:e|ed|es)|constrain(?:ed|s)?|preserv(?:e|ed|es)|separat(?:e|ed|es)|reorder(?:ed|s)?|request(?:ed|s)?|requir(?:e|ed|es))\b/i;
const REASONING_DIMENSION = /\b(ambiguity|audience|citation|constraint|context|criteria|edge case|example|format|framework|input|instruction|language|length|order|output|redundan(?:cy|t)|role|runtime|schema|scope|step|structure|success|task|tone|wording)\b/i;
const GENERIC_NO_OP_REASON = /\b(already (?:clear|good|well[- ]written)|no (?:changes?|improvements?) (?:are )?needed|improves? clarity|enhances? clarity|makes? (?:it|the prompt) clearer|minor refinements?|light adjustments?|better prompt)\b/i;

const normalizeForComparison = (value) => ensureString(value)
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim()
  .toLocaleLowerCase();

const tokenize = (value) => normalizeForComparison(value).match(/[\p{L}\p{N}_'-]+/gu) || [];

function countTokenDelta(source, result) {
  const counts = new Map();
  tokenize(source).forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  tokenize(result).forEach((token) => counts.set(token, (counts.get(token) || 0) - 1));
  return [...counts.values()].reduce((total, count) => total + Math.abs(count), 0);
}

function formatSignature(value) {
  const text = ensureString(value);
  const lines = text.split(/\r?\n/);
  return {
    lineCount: lines.length,
    headings: lines.filter((line) => /^\s{0,3}#{1,6}\s+/.test(line)).length,
    listItems: lines.filter((line) => /^\s*(?:[-*+] |\d+[.)]\s+)/.test(line)).length,
    fencedBlocks: (text.match(/```/g) || []).length,
    xmlTags: (text.match(/<\/?[a-z][^>]*>/gi) || []).length,
    jsonLike: /^\s*[\[{]/.test(text) && /[\]}]\s*$/.test(text),
  };
}

export function hasStructuralFormatChange(source, result) {
  const before = formatSignature(source);
  const after = formatSignature(result);
  return Object.keys(before).some((key) => before[key] !== after[key]);
}

export function isGenericImprovementReasoning(value) {
  const reasoning = ensureString(value).replace(/\s+/g, ' ').trim();
  if (reasoning.length < 24 || GENERIC_NO_OP_REASON.test(reasoning)) return true;
  return !REASONING_ACTION.test(reasoning) || !REASONING_DIMENSION.test(reasoning);
}

function hasSemanticChanges(value) {
  if (!Array.isArray(value)) return false;
  return value.some((change) => {
    if (typeof change === 'string') return change.trim().length > 0;
    return ensureString(change?.label || change?.text || change?.change).trim().length > 0;
  });
}

export function assessEnhancementQuality(source, result, policy = ENHANCEMENT_QUALITY_POLICY) {
  const sourceText = ensureString(source);
  const enhancedText = ensureString(result?.enhanced);
  const exactNoOp = normalizeForComparison(sourceText) === normalizeForComparison(enhancedText);
  const changedTokenCount = countTokenDelta(sourceText, enhancedText);
  const structuralFormatChange = hasStructuralFormatChange(sourceText, enhancedText);
  const cosmeticNoOp = !exactNoOp && changedTokenCount === 0 && !structuralFormatChange;
  const lowDiff = changedTokenCount < policy.minimumChangedTokens && !structuralFormatChange;
  const semanticChangesMissing = !hasSemanticChanges(result?.changes);
  const genericReasoning = isGenericImprovementReasoning(result?.reasoning);
  const unsupportedImprovement = semanticChangesMissing || genericReasoning;
  const failures = [];

  if (!enhancedText.trim()) failures.push('missing-enhanced-prompt');
  if (exactNoOp) failures.push('exact-no-op');
  if (cosmeticNoOp) failures.push('cosmetic-no-op');
  if (!exactNoOp && !cosmeticNoOp && lowDiff && semanticChangesMissing) failures.push('near-no-op-no-semantic-changes');
  if (!exactNoOp && !cosmeticNoOp && lowDiff && genericReasoning) failures.push('near-no-op-generic-reasoning');

  return {
    passed: failures.length === 0,
    failures,
    exactNoOp,
    cosmeticNoOp,
    lowDiff,
    changedTokenCount,
    structuralFormatChange,
    semanticChangesMissing,
    genericReasoning,
    unsupportedImprovement,
  };
}

const FAILURE_MESSAGES = Object.freeze({
  'missing-enhanced-prompt': 'the enhanced prompt was empty',
  'exact-no-op': 'the enhanced prompt duplicated the source after normalization',
  'cosmetic-no-op': 'only casing, punctuation, or word order changed without a structural improvement',
  'near-no-op-no-semantic-changes': 'fewer than three tokens changed and no concrete semantic change was identified',
  'near-no-op-generic-reasoning': 'fewer than three tokens changed and the reasoning did not name a concrete execution improvement',
});

export function buildEnhancementCorrectionPayload(basePayload, rejectedResponse, assessment) {
  const failures = (assessment?.failures || [])
    .map((failure) => FAILURE_MESSAGES[failure] || failure)
    .join('; ');
  const correctionInstruction = [
    'QUALITY CORRECTION PASS.',
    `The previous response was rejected because ${failures || 'it did not demonstrate a material improvement'}.`,
    'Re-evaluate the original prompt and return one complete replacement JSON object using the required schema.',
    'Make at least one concrete, defensible improvement to execution clarity, specificity, constraints, or output format while preserving the user\'s intent.',
    'Do not make cosmetic changes merely to pass this check.',
    'The changes and reasoning fields must name the exact improvement and why it helps execution.',
  ].join(' ');

  return {
    ...basePayload,
    system: `${ensureString(basePayload?.system).trim()}\n\n${correctionInstruction}`.trim(),
    messages: [
      ...(Array.isArray(basePayload?.messages) ? basePayload.messages : []),
      { role: 'assistant', content: ensureString(rejectedResponse) },
      {
        role: 'user',
        content: 'Correct the rejected response now. Return only the complete replacement JSON object.',
      },
    ],
  };
}

export function combineTokenUsage(...values) {
  const rows = values.filter((value) => value && typeof value === 'object');
  if (rows.length === 0) return null;
  const read = (value, keys) => {
    for (const key of keys) {
      const candidate = value[key];
      if (candidate !== null && candidate !== undefined && Number.isFinite(Number(candidate))) {
        return Math.max(0, Math.round(Number(candidate)));
      }
    }
    return null;
  };
  const normalized = rows.map((value) => {
    const input = read(value, ['input', 'inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens']);
    const output = read(value, ['output', 'outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens']);
    const total = read(value, ['total', 'totalTokens', 'total_tokens']);
    return {
      input,
      output,
      total: total ?? (input !== null || output !== null ? (input || 0) + (output || 0) : null),
    };
  });
  const sum = (key) => normalized.some((row) => row[key] !== null)
    ? normalized.reduce((total, row) => total + (row[key] || 0), 0)
    : null;
  const input = sum('input');
  const output = sum('output');
  const total = sum('total');
  return input === null && output === null && total === null ? null : { input, output, total };
}
