import { hashText, randomId, safeDate } from './lib/utils.js';

function truncate(value, limit) {
  return String(value || '').slice(0, limit);
}

function normalizeVariantMetadata(variant) {
  if (!variant || typeof variant !== 'object' || !String(variant.id || '').trim()) {
    return null;
  }

  const promptText = String(variant.promptText ?? variant.prompt ?? '');
  return {
    id: String(variant.id).trim(),
    name: String(variant.name || `Variant ${String(variant.id).trim()}`),
    provider: String(variant.provider || 'anthropic'),
    model: String(variant.model || 'unknown'),
    promptText,
    responseText: String(variant.responseText ?? variant.response ?? ''),
    promptHash: variant.promptHash || hashText(promptText),
  };
}

export function normalizeExperimentRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const variantMetadata = Array.isArray(record.variantMetadata)
    ? record.variantMetadata.map(normalizeVariantMetadata).filter(Boolean)
    : [];
  if (!variantMetadata.length) return null;

  return {
    id: String(record.id || randomId()),
    createdAt: safeDate(record.createdAt),
    label: String(record.label || 'Untitled experiment'),
    variantMetadata,
    keyInputSnapshot: truncate(record.keyInputSnapshot, 1200),
    outcome: record.outcome || '',
    notes: truncate(record.notes, 400),
  };
}

function makeVariant(id, variant, provider, model) {
  const promptText = String(variant?.prompt ?? variant?.promptText ?? '');
  const responseText = String(variant?.response ?? variant?.responseText ?? '');
  return {
    id,
    name: String(variant?.name || `Variant ${id}`),
    provider,
    model,
    promptText,
    responseText,
    promptHash: hashText(promptText),
  };
}

export function createExperimentRecord({
  label = 'A/B experiment',
  variantA = {},
  variantB = {},
  winnerId = '',
  notes = '',
  provider = 'anthropic',
  model = 'unknown',
} = {}) {
  return normalizeExperimentRecord({
    id: randomId(),
    createdAt: new Date().toISOString(),
    label,
    variantMetadata: [
      makeVariant('A', variantA, provider, model),
      makeVariant('B', variantB, provider, model),
    ],
    keyInputSnapshot: JSON.stringify({
      aPrompt: truncate(variantA?.prompt ?? variantA?.promptText, 280),
      bPrompt: truncate(variantB?.prompt ?? variantB?.promptText, 280),
      aResponse: truncate(variantA?.response ?? variantA?.responseText, 180),
      bResponse: truncate(variantB?.response ?? variantB?.responseText, 180),
    }),
    outcome: winnerId,
    notes,
  });
}

export function filterExperimentHistory(records, filters = {}) {
  if (!Array.isArray(records)) return [];

  const query = String(filters.query || '').trim().toLowerCase();
  const fromTime = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
  const toTime = filters.to ? new Date(`${filters.to}T23:59:59`).getTime() : null;

  return records
    .map(normalizeExperimentRecord)
    .filter(Boolean)
    .filter((record) => {
      const createdTime = new Date(record.createdAt).getTime();
      if (fromTime != null && createdTime < fromTime) return false;
      if (toTime != null && createdTime > toTime) return false;
      if (!query) return true;

      const haystack = [
        record.label,
        record.notes,
        record.outcome,
        ...record.variantMetadata.flatMap((variant) => [
          variant.id,
          variant.name,
          variant.provider,
          variant.model,
          variant.promptHash,
        ]),
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

