// Published output ceilings for the providers Prompt Lab calls.
// Synchronous Messages API limits, checked 2026-11-17:
//   Anthropic Sonnet/Opus 4.6+ and Claude 5: 128K
//     https://platform.claude.com/docs/en/build-with-claude/context-windows
//   Anthropic Sonnet 4 / 4.5, Opus 4.5, Haiku 4.5: 64K; Opus 4 / 4.1: 32K
//   OpenAI gpt-4o: 16,384; gpt-4.1: 32,768
//     https://developers.openai.com/api/docs/models/gpt-4o
//     https://developers.openai.com/api/docs/models/gpt-4.1
//   Gemini 2.5: 65,536; Gemini 2.0: 8,192
//     https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro
//   Ollama stops at the loaded context. Unknown local models stay at 8,192,
//   which current llama3, qwen, gemma, mistral and phi builds accept; named
//   families below are capped at 32,768.
//
// A request must not ask for more than the row that matches. The hosted
// reservation multiplies this same budget by the catalogue output rate.

export const OUTPUT_BUDGET_STEPS = Object.freeze([2048, 4096, 8192, 16384, 32768, 65536, 128000]);

const FAMILIES = Object.freeze([
  { provider: 'anthropic', test: /^claude-(opus|sonnet|haiku)-4-[6-9]\b/, maxOutputTokens: 128000 },
  { provider: 'anthropic', test: /^claude-(opus|sonnet|haiku)-4-5\b/, maxOutputTokens: 64000 },
  { provider: 'anthropic', test: /^claude-sonnet-4\b/, maxOutputTokens: 64000 },
  { provider: 'anthropic', test: /^claude-opus-4(?:-1)?\b/, maxOutputTokens: 32000 },
  { provider: 'anthropic', test: /^claude-(opus|sonnet|haiku|fable|mythos)-5\b/, maxOutputTokens: 128000 },
  { provider: 'openai', test: /^gpt-4o(?:-mini)?(?:-|$)/, maxOutputTokens: 16384 },
  { provider: 'openai', test: /^gpt-4\.1/, maxOutputTokens: 32768 },
  { provider: 'openai', test: /^o[134](?:-|$)/, maxOutputTokens: 100000 },
  { provider: 'gemini', test: /^gemini-2\.5/, maxOutputTokens: 65536 },
  { provider: 'gemini', test: /^gemini-2\.0/, maxOutputTokens: 8192 },
  { provider: 'gemini', test: /^gemini-1\.5/, maxOutputTokens: 8192 },
  { provider: 'ollama', test: /(llama3|qwen|gemma|mistral|phi3|phi4)/i, maxOutputTokens: 32768 },
]);

const PROVIDER_DEFAULTS = Object.freeze({
  anthropic: 4096,
  openai: 16384,
  gemini: 8192,
  ollama: 8192,
  openrouter: 16384,
});

function modelIds(model) {
  const raw = String(model || '').trim().toLowerCase();
  if (!raw) return [];
  const bare = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  const hyphenated = bare.replace(/\./g, '-');
  return [...new Set([raw, bare, hyphenated])];
}

/** Largest output this provider will accept for the model. Unknown models use a conservative default. */
export function maxOutputTokens(provider, model) {
  const ids = modelIds(model);
  const family = FAMILIES.find((row) => ids.some((id) => row.test.test(id)));
  if (family) return family.maxOutputTokens;
  const key = String(provider || '').toLowerCase();
  return PROVIDER_DEFAULTS[key] || PROVIDER_DEFAULTS.anthropic;
}

export function clampOutputTokens(tokens, provider, model) {
  const cap = maxOutputTokens(provider, model);
  const requested = Math.floor(Number(tokens));
  if (!Number.isFinite(requested) || requested < 1) return Math.min(cap, 2048);
  return Math.min(cap, requested);
}

const TRUNCATION_REASONS = Object.freeze({
  anthropic: 'max_tokens',
  openai: 'length',
  openrouter: 'length',
  gemini: 'max_tokens',
  ollama: 'length',
});

/** Anthropic stop_reason max_tokens, OpenAI/OpenRouter finish_reason length, Gemini MAX_TOKENS, Ollama done_reason length. */
export function isOutputTruncated(provider, reason) {
  const value = String(reason || '').trim().toLowerCase();
  if (!value) return false;
  const key = String(provider || '').toLowerCase();
  return value === (TRUNCATION_REASONS[key] || 'length');
}

export function responseWasTruncated(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.truncated === true) return true;
  const provider = data.provider;
  return isOutputTruncated(provider || 'anthropic', data.stopReason || data.stop_reason)
    || isOutputTruncated(provider || 'openai', data.choices?.[0]?.finish_reason)
    || isOutputTruncated(provider || 'gemini', data.candidates?.[0]?.finishReason)
    || isOutputTruncated(provider || 'ollama', data.done_reason);
}

/**
 * One step above the budget that was just cut off, never past the model ceiling.
 * Doubling keeps a retry from sitting on the same cap that truncated the last reply.
 */
export function nextOutputBudget(current, provider, model) {
  const cap = maxOutputTokens(provider, model);
  const currentValue = Math.max(1, Math.floor(Number(current) || 0));
  if (currentValue >= cap) return cap;
  const doubled = currentValue * 2;
  const step = OUTPUT_BUDGET_STEPS.find((limit) => limit >= doubled && limit > currentValue) || doubled;
  return Math.min(cap, step);
}

/**
 * Unrounded micro-dollar output charge. A catalogue rate in USD per million
 * tokens is already micro-dollars per token. Callers add the input charge and
 * ceil once, which is what the hosted reservation does.
 */
export function estimatedOutputCharge(outputRate, maxTokens) {
  const tokens = Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0 ? Number(maxTokens) : 0;
  const rate = Number.isFinite(Number(outputRate)) && Number(outputRate) > 0 ? Number(outputRate) : 0;
  return tokens * rate;
}
