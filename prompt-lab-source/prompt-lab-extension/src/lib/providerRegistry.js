/**
 * Provider Registry — single source of truth for all provider metadata,
 * payload building, response normalization, and settings shape.
 *
 * Each provider is a descriptor object registered in PROVIDERS.
 * callProvider and the UI both read from this registry instead of
 * maintaining parallel switch statements.
 */

// ── Shared helpers ──────────────────────────────────────────────────

export function anthropicBlocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('');
}

export function toChatMessages(payload) {
  const out = [];
  if (typeof payload?.system === 'string' && payload.system.trim()) {
    out.push({ role: 'system', content: payload.system });
  }
  for (const msg of payload?.messages || []) {
    const role = ['system', 'assistant', 'user'].includes(msg?.role) ? msg.role : 'user';
    out.push({ role, content: anthropicBlocksToText(msg?.content) });
  }
  return out;
}

export function toGeminiContents(payload) {
  const mapped = [];
  for (const msg of payload?.messages || []) {
    mapped.push({
      role: msg?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: anthropicBlocksToText(msg?.content) }],
    });
  }

  const collapsed = [];
  for (const msg of mapped) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.role === msg.role) {
      prev.parts[0].text += '\n\n' + msg.parts[0].text;
    } else {
      collapsed.push(msg);
    }
  }
  return collapsed;
}

export function normalizeBaseUrl(baseUrl, fallback) {
  const raw = String(baseUrl || fallback).trim();
  return raw.replace(/\/+$/, '');
}

// ── Provider descriptors ────────────────────────────────────────────

const PROVIDERS = Object.freeze({
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    apiKeyField: 'apiKey',
    modelField: 'anthropicModel',
    settingsKeys: ['apiKey', 'anthropicModel'],
    capabilities: ['chat', 'system'],
    requiresApiKey: true,
    endpoint: 'https://api.anthropic.com/v1/messages',

    resolveModel(payload, settings) {
      return settings.anthropicModel || payload?.model || this.defaultModel;
    },

    buildHeaders(settings) {
      return {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      };
    },

    buildPayload(payload, settings) {
      return {
        ...payload,
        model: this.resolveModel(payload, settings),
        stream: false,
      };
    },

    parseStream: parseAnthropicSse,

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = anthropicBlocksToText(data?.content);
      if (!text) throw new Error('Anthropic returned empty content.');
      return {
        content: [{ type: 'text', text }],
        model: data?.model || requestBody.model,
        provider: 'anthropic',
      };
    },

    extractText(data) {
      return anthropicBlocksToText(data?.content);
    },
  },

  ollama: {
    id: 'ollama',
    label: 'Ollama',
    defaultModel: 'llama3.2:3b',
    defaultBaseUrl: 'http://localhost:11434',
    modelField: 'ollamaModel',
    settingsKeys: ['ollamaBaseUrl', 'ollamaModel'],
    capabilities: ['chat', 'system', 'local'],
    requiresApiKey: false,

    resolveModel(payload, settings) {
      return settings.ollamaModel || payload?.model || this.defaultModel;
    },

    resolveEndpoint(settings) {
      return `${normalizeBaseUrl(settings.ollamaBaseUrl, this.defaultBaseUrl)}/api/chat`;
    },

    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },

    buildPayload(payload, settings, options = {}) {
      return {
        model: this.resolveModel(payload, settings),
        stream: !!options.stream,
        messages: toChatMessages(payload),
      };
    },

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.message?.content;
      if (!text) throw new Error('Ollama returned empty content.');
      return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'ollama' };
    },

    extractText(data) {
      return data?.content?.[0]?.text || '';
    },
  },

  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    apiKeyField: 'openaiApiKey',
    modelField: 'openaiModel',
    settingsKeys: ['openaiApiKey', 'openaiModel'],
    capabilities: ['chat', 'system'],
    requiresApiKey: true,
    endpoint: 'https://api.openai.com/v1/chat/completions',

    resolveModel(payload, settings) {
      return settings.openaiModel || payload?.model || this.defaultModel;
    },

    buildHeaders(settings) {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiApiKey}`,
      };
    },

    buildPayload(payload, settings, options = {}) {
      const body = {
        model: this.resolveModel(payload, settings),
        max_tokens: payload.max_tokens || 1500,
        messages: toChatMessages(payload),
        stream: !!options.stream,
      };
      if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
      return body;
    },

    parseStream: parseOpenAiSse,

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI returned empty content.');
      return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openai' };
    },

    extractText(data) {
      return data?.content?.[0]?.text || '';
    },
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-2.5-flash',
    apiKeyField: 'geminiApiKey',
    modelField: 'geminiModel',
    settingsKeys: ['geminiApiKey', 'geminiModel'],
    capabilities: ['chat', 'system', 'json_mode'],
    requiresApiKey: true,

    resolveModel(payload, settings) {
      return settings.geminiModel || payload?.model || this.defaultModel;
    },

    resolveEndpoint(settings, payload) {
      const modelId = this.resolveModel(payload, settings);
      return `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${settings.geminiApiKey}`;
    },

    buildHeaders() {
      return { 'Content-Type': 'application/json' };
    },

    buildPayload(payload, settings) {
      const modelId = this.resolveModel(payload, settings);
      const body = {
        contents: toGeminiContents(payload),
        generationConfig: {},
      };
      if (typeof payload?.system === 'string' && payload.system.trim()) {
        body.systemInstruction = { parts: [{ text: payload.system }] };
      }
      if (payload.responseFormat === 'json') {
        body.generationConfig.responseMimeType = 'application/json';
      }
      if (payload.max_tokens) body.generationConfig.maxOutputTokens = payload.max_tokens;
      if (typeof payload.temperature === 'number') body.generationConfig.temperature = payload.temperature;
      if (modelId.includes('2.5')) {
        body.generationConfig.thinkingConfig = { thinkingBudget: 1024 };
      }
      return body;
    },

    normalizeResponse(data, _requestBody, resolvedModel) {
      const candidate = data?.candidates?.[0];
      const finishReason = candidate?.finishReason;
      const text = candidate?.content?.parts?.map((part) => part.text || '').join('');
      if (!text) {
        if (finishReason === 'SAFETY') {
          const ratings = candidate?.safetyRatings?.map((r) => `${r.category}: ${r.probability}`).join(', ');
          throw new Error(`Gemini blocked this response due to safety filters (${ratings || 'no details'}).`);
        }
        if (data?.promptFeedback?.blockReason) {
          throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}.`);
        }
        throw new Error('Gemini returned empty content.');
      }
      return { content: [{ type: 'text', text }], model: resolvedModel || 'gemini', provider: 'gemini' };
    },

    extractText(data) {
      return data?.content?.[0]?.text || '';
    },
  },

  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'anthropic/claude-sonnet-4-20250514',
    apiKeyField: 'openrouterApiKey',
    modelField: 'openrouterModel',
    settingsKeys: ['openrouterApiKey', 'openrouterModel'],
    capabilities: ['chat', 'system'],
    requiresApiKey: true,
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',

    resolveModel(payload, settings) {
      return settings.openrouterModel || payload?.model || this.defaultModel;
    },

    buildHeaders(settings) {
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openrouterApiKey}`,
        'HTTP-Referer': 'chrome-extension://prompt-lab',
        'X-Title': 'Prompt Lab',
      };
    },

    buildPayload(payload, settings, options = {}) {
      const body = {
        model: this.resolveModel(payload, settings),
        max_tokens: payload.max_tokens || 1500,
        messages: toChatMessages(payload),
        stream: !!options.stream,
      };
      if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
      return body;
    },

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenRouter returned empty content.');
      return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openrouter' };
    },

    parseStream: parseOpenAiSse,

    extractText(data) {
      return data?.content?.[0]?.text || '';
    },
  },
});

// ── Registry API ────────────────────────────────────────────────────

export const DEFAULT_PROVIDER = 'anthropic';

/** All registered provider IDs. */
export const VALID_PROVIDERS = Object.freeze(Object.keys(PROVIDERS));

/** Flat list of all settings keys across all providers (plus 'provider'). */
export const PROVIDER_SETTINGS_KEYS = Object.freeze([
  'provider',
  ...VALID_PROVIDERS.flatMap((id) => PROVIDERS[id].settingsKeys),
]);

/** Backward-compatible DEFAULTS object. */
export const DEFAULTS = Object.freeze(
  Object.fromEntries([
    ['provider', DEFAULT_PROVIDER],
    ...VALID_PROVIDERS.map((id) => {
      const p = PROVIDERS[id];
      const entries = [[p.modelField, p.defaultModel]];
      if (p.defaultBaseUrl) entries.push([`${id}BaseUrl`, p.defaultBaseUrl]);
      return entries;
    }).flat(),
  ]),
);

/** Look up a provider descriptor by ID. Returns the default if unknown. */
export function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

/** Normalize a provider string to a valid ID. */
export function normalizeProvider(provider) {
  return VALID_PROVIDERS.includes(provider) ? provider : DEFAULT_PROVIDER;
}

/** Get all provider descriptors as an array. */
export function allProviders() {
  return VALID_PROVIDERS.map((id) => PROVIDERS[id]);
}

/** Check if a provider has a specific capability. */
export function providerHasCapability(id, capability) {
  return getProvider(id).capabilities.includes(capability);
}
