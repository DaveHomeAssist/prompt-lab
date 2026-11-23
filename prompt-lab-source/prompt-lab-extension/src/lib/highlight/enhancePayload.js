// Build and read a highlight enhance using the same generation prompt, output
// budget, and response parser as Create. The caller supplies the provider
// call (the extension worker uses extension/lib/providers.js; desktop uses
// callModelDirect). No network happens in this file.

import { ALL_TAGS, DEFAULT_ENHANCE_TEMPERATURE } from '../../constants.js';
import {
  DEFAULT_GENERATION_OPTIONS,
  buildGenerationSystemPrompt,
  generationOutputBudget,
  normalizeGenerationOptions,
  resolveGenerationOptions,
} from '../generationOptions.js';
import { scanSensitiveData } from '../../piiScanner.js';
import { parseEnhancedPayload } from '../../promptUtils.js';

export const HIGHLIGHT_SELECTION_LIMIT = 20000;

export function textFromProviderResponse(data) {
  if (!data || typeof data !== 'object') return '';
  if (Array.isArray(data.content)) return data.content.map((block) => (typeof block?.text === 'string' ? block.text : '')).join('');
  if (typeof data.content === 'string') return data.content;
  const openAI = data.choices?.[0]?.message?.content;
  if (typeof openAI === 'string') return openAI;
  const parts = data.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  return '';
}

export function readEnhancedText(raw, options = {}) {
  const parsed = parseEnhancedPayload(raw, { modern: true, truncated: options.truncated === true });
  return String(parsed.enhanced || '').trim();
}

export function buildHighlightPayload(text, generation, route = {}) {
  const options = resolveGenerationOptions(generation?.strategy || DEFAULT_GENERATION_OPTIONS.strategy, {
    ...DEFAULT_GENERATION_OPTIONS,
    ...normalizeGenerationOptions(generation),
  });
  const provider = route.provider || 'anthropic';
  const model = route.model || 'claude-sonnet-4-6';
  return {
    model,
    max_tokens: generationOutputBudget(text, options, { provider, model }),
    temperature: DEFAULT_ENHANCE_TEMPERATURE,
    system: buildGenerationSystemPrompt(options, ALL_TAGS),
    messages: [{ role: 'user', content: text }],
    responseFormat: 'json',
  };
}

export async function enhanceHighlightText(text, { route, generation, call, signal } = {}) {
  const source = String(text ?? '');
  if (!source.trim()) return { ok: false, code: 'empty', message: 'Select some text first.' };
  if (source.includes('\u0000promptlab-')) {
    return { ok: false, code: 'sentinel', message: 'The selection looked like an internal clipboard marker, so nothing was sent.' };
  }
  if (source.length > HIGHLIGHT_SELECTION_LIMIT) {
    return {
      ok: false,
      code: 'too-long',
      message: `That selection is longer than ${HIGHLIGHT_SELECTION_LIMIT.toLocaleString('en-US')} characters. Select a smaller piece and try again.`,
    };
  }
  if (typeof call !== 'function') return { ok: false, code: 'provider', message: 'No provider is available for enhance.' };
  const payload = buildHighlightPayload(source, generation, route);
  const { matches } = scanSensitiveData({ payload });
  if (matches.length > 0) return { ok: false, code: 'sensitive', message: 'Sensitive data detected. Nothing was sent.' };
  if (signal?.aborted) return { ok: false, code: 'aborted', message: 'Enhance cancelled.' };
  let data;
  try {
    data = await call(payload, { signal });
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') return { ok: false, code: 'aborted', message: 'Enhance cancelled.' };
    return { ok: false, code: 'provider', message: error?.message || 'The enhance request failed.' };
  }
  if (signal?.aborted) return { ok: false, code: 'aborted', message: 'Enhance cancelled.' };
  const raw = textFromProviderResponse(data);
  try {
    const enhanced = readEnhancedText(raw, { truncated: data?.truncated === true });
    if (!enhanced) return { ok: false, code: 'parse', message: 'The model response had no enhanced text.', raw };
    return { ok: true, enhanced };
  } catch (error) {
    return { ok: false, code: 'parse', message: error?.message || 'The enhanced text could not be read.', raw };
  }
}
