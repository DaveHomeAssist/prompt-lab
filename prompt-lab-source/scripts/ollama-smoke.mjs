#!/usr/bin/env node

import { callModelDirect, listOllamaModelsDirect } from '../prompt-lab-extension/src/lib/desktopApi.js';
import {
  ALL_TAGS,
  buildSystemPrompt,
  DEFAULT_ENHANCE_MAX_TOKENS,
  DEFAULT_ENHANCE_TEMPERATURE,
} from '../prompt-lab-extension/src/constants.js';
import {
  extractTextFromAnthropic,
  parseEnhancedPayload,
} from '../prompt-lab-extension/src/promptUtils.js';
import {
  DEFAULT_OLLAMA_CONTEXT_LENGTH,
  normalizeOllamaContextLength,
} from '../prompt-lab-extension/src/lib/providerRegistry.js';

const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const requestedModel = process.env.OLLAMA_MODEL || '';
const contextLength = normalizeOllamaContextLength(
  process.env.OLLAMA_CONTEXT_LENGTH || DEFAULT_OLLAMA_CONTEXT_LENGTH,
);
const timeoutMs = 240000;

const startedAt = Date.now();
const discovered = await listOllamaModelsDirect(baseUrl);
if (discovered.error) throw new Error(discovered.error);
if (!discovered.models.length) throw new Error('Ollama is reachable but has no installed models.');

const modelsBySize = [...discovered.models].sort((left, right) => (left.size || 0) - (right.size || 0));
const model = requestedModel || modelsBySize[0].name;
if (!discovered.models.some((item) => item.name === model)) {
  throw new Error(`Ollama model "${model}" is not installed.`);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort('Ollama smoke test timed out.'), timeoutMs);

try {
  const response = await callModelDirect({
    model,
    max_tokens: DEFAULT_ENHANCE_MAX_TOKENS,
    temperature: DEFAULT_ENHANCE_TEMPERATURE,
    system: buildSystemPrompt('balanced', ALL_TAGS),
    messages: [{
      role: 'user',
      content: 'Write a concise checklist for testing a desktop application release.',
    }],
    responseFormat: 'json',
  }, {
    settingsOverride: {
      provider: 'ollama',
      ollamaBaseUrl: baseUrl,
      ollamaModel: model,
      ollamaContextLength: contextLength,
    },
    signal: controller.signal,
  });

  const parsed = parseEnhancedPayload(extractTextFromAnthropic(response));
  console.log(JSON.stringify({
    provider: response.provider,
    model: response.model,
    contextLength,
    discoveredModels: discovered.models.length,
    enhancedLength: parsed.enhanced.length,
    variants: parsed.variants.length,
    tags: parsed.tags,
    elapsedMs: Date.now() - startedAt,
  }, null, 2));
} finally {
  clearTimeout(timeout);
}
