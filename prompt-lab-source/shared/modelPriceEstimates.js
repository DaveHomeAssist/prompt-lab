// Local token-price table for the in-app run estimate.
// Estimate only, not a bill, quote, or invoice. Nothing here is charged.
// Prices checked 2026-11-17. Provider list prices change; this file does not
// bill anyone and is not the Prompt Lab Pro price (that lives in pricing.js).

export const MODEL_PRICE_ESTIMATE_AS_OF = '2026-11-17';

export const MODEL_PRICE_ESTIMATE_LABEL = 'Estimate only, not a bill. Prices as of 2026-11-17.';

// Assumed completion size when the run has not happened yet.
export const ASSUMED_OUTPUT_TOKENS = 800;

// USD per 1,000,000 tokens. `local: true` means the model runs on the user's
// machine, so the table estimates the provider charge as zero.
export const MODEL_PRICE_ESTIMATES = Object.freeze({
  'claude-sonnet-4-6': Object.freeze({ provider: 'anthropic', inputPerMillionUsd: 3, outputPerMillionUsd: 15 }),
  'claude-haiku-4-5': Object.freeze({ provider: 'anthropic', inputPerMillionUsd: 1, outputPerMillionUsd: 5 }),
  'claude-opus-4-6': Object.freeze({ provider: 'anthropic', inputPerMillionUsd: 5, outputPerMillionUsd: 25 }),
  'gpt-4o': Object.freeze({ provider: 'openai', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 }),
  'gpt-4o-mini': Object.freeze({ provider: 'openai', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 }),
  'gemini-2.5-flash': Object.freeze({ provider: 'gemini', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 }),
  'gemini-2.5-pro': Object.freeze({ provider: 'gemini', inputPerMillionUsd: 1.25, outputPerMillionUsd: 10 }),
  'anthropic/claude-sonnet-4.6': Object.freeze({ provider: 'openrouter', inputPerMillionUsd: 3, outputPerMillionUsd: 15 }),
  'llama3.2:3b': Object.freeze({ provider: 'ollama', inputPerMillionUsd: 0, outputPerMillionUsd: 0, local: true }),
});

export function lookupModelPrice(model) {
  const id = String(model || '').trim();
  if (!id) return null;
  return MODEL_PRICE_ESTIMATES[id] || null;
}

export function estimateInputTokens(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return 0;
  return Math.max(1, Math.ceil(source.length / 4));
}

export function estimateRunCost({ text, model, assumedOutputTokens = ASSUMED_OUTPUT_TOKENS } = {}) {
  const inputTokens = estimateInputTokens(text);
  const outputTokens = Math.max(0, Math.round(Number(assumedOutputTokens) || 0));
  const price = lookupModelPrice(model);
  const modelId = String(model || '').trim() || 'unknown model';
  const inputUsd = price ? (inputTokens / 1_000_000) * price.inputPerMillionUsd : null;
  const outputUsd = price ? (outputTokens / 1_000_000) * price.outputPerMillionUsd : null;
  const usd = price ? inputUsd + outputUsd : null;
  return {
    model: modelId,
    provider: price?.provider || '',
    local: Boolean(price?.local),
    priced: Boolean(price),
    inputTokens,
    assumedOutputTokens: outputTokens,
    usd,
    asOf: MODEL_PRICE_ESTIMATE_AS_OF,
    label: MODEL_PRICE_ESTIMATE_LABEL,
  };
}

export function formatUsdEstimate(usd) {
  if (!Number.isFinite(usd)) return '';
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function describeRunEstimate(estimate) {
  if (!estimate) return MODEL_PRICE_ESTIMATE_LABEL;
  if (!estimate.inputTokens) return `Token estimate appears as you write. ${estimate.label}`;
  const tokens = `About ${estimate.inputTokens} input tokens and ${estimate.assumedOutputTokens} output tokens`;
  if (!estimate.priced) {
    return `${tokens}. No local price for ${estimate.model}. ${estimate.label}`;
  }
  const where = estimate.local ? `${estimate.model} on this machine` : estimate.model;
  return `${tokens} · ${formatUsdEstimate(estimate.usd)} on ${where}. ${estimate.label}`;
}
