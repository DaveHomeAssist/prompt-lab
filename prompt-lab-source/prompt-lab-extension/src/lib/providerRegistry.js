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

export function toAnthropicMessages(payload) {
  const messages = [];
  for (const msg of payload?.messages || []) {
    if (msg?.role === 'system') continue;
    messages.push({
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: anthropicBlocksToText(msg?.content),
    });
  }
  return messages;
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

export const OLLAMA_ENDPOINTS = Object.freeze([
  Object.freeze({ id: 'local', label: 'This Mac', baseUrl: 'http://localhost:11434' }),
  Object.freeze({ id: 'duncan', label: 'Duncan', baseUrl: 'http://duncan:11434' }),
  Object.freeze({ id: 'walter', label: 'Walter', baseUrl: 'http://walter:11434' }),
]);

export function getOllamaEndpoint(baseUrl) {
  if (!String(baseUrl || '').trim()) return null;
  const normalized = normalizeBaseUrl(baseUrl, OLLAMA_ENDPOINTS[0].baseUrl);
  return OLLAMA_ENDPOINTS.find((endpoint) => endpoint.baseUrl === normalized) || null;
}

// ── SSE stream parsers ─────────────────────────────────────────────

function normalizeUsage(input, output, total) {
  const isCount = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const safeInput = isCount(input) ? Math.max(0, Math.round(Number(input))) : null;
  const safeOutput = isCount(output) ? Math.max(0, Math.round(Number(output))) : null;
  const safeTotal = isCount(total)
    ? Math.max(0, Math.round(Number(total)))
    : (safeInput !== null || safeOutput !== null ? (safeInput || 0) + (safeOutput || 0) : null);
  return safeInput === null && safeOutput === null && safeTotal === null
    ? null
    : { input: safeInput, output: safeOutput, total: safeTotal };
}

function mergeUsage(current, next) {
  if (!next) return current;
  const input = next.input ?? current?.input;
  const output = next.output ?? current?.output;
  const explicitTotal = next.total !== null && next.total !== undefined ? next.total : null;
  return normalizeUsage(
    input,
    output,
    explicitTotal,
  );
}

function streamFrameError(data) {
  const detail = data?.error;
  const message = typeof detail === 'string' ? detail : detail?.message;
  const error = new Error(message || 'Provider reported a streaming error.');
  const statusByType = {
    overloaded_error: 529, rate_limit_error: 429, authentication_error: 401,
    permission_error: 403, invalid_request_error: 400, not_found_error: 404,
    api_error: 500, server_error: 502,
  };
  const code = Number(detail?.code || detail?.status);
  error.status = Number.isInteger(code) && code >= 400 && code < 600
    ? code : statusByType[detail?.type || detail?.code] || 502;
  return error;
}

function parseSseChunks(buffer, flush = false, inspectFrame, acceptsDoneMarker = false) {
  const chunks = [];
  let usage = null;
  let done = false;
  let error = null;
  const frames = buffer.split(/\r?\n\r?\n/);
  const completeFrames = flush ? frames : frames.slice(0, -1);
  const working = flush ? '' : (frames[frames.length - 1] || '');

  for (const frame of completeFrames) {
    const payload = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, '')).join('\n').trim();
    if (!payload) continue; // SSE comments and keepalive events carry no data.
    if (payload === '[DONE]' && acceptsDoneMarker) { done = true; continue; }
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      error = new Error('Malformed provider stream event.');
      error.status = 502;
      break;
    }
    if (data?.error || data?.type === 'error' || (Array.isArray(data?.choices) && data.choices.some((choice) => choice.finish_reason === 'error'))) {
      error = streamFrameError(data);
      break;
    }
    // Inspection errors propagate; a valid error event must never disappear
    // inside the JSON parse catch. Keep earlier text from this transport chunk.
    const inspected = inspectFrame(data);
    if (inspected?.text) chunks.push(inspected.text);
    usage = mergeUsage(usage, inspected?.usage);
    done ||= inspected?.done === true;
  }

  return { buffer: working, chunks, usage, done, error };
}

function parseAnthropicSse(buffer, flush = false) {
  return parseSseChunks(buffer, flush, (data) => {
    if (data?.type === 'message_stop') return { done: true };
    if (data?.type === 'message_start') {
      return { text: '', usage: { input: data?.message?.usage?.input_tokens, output: null, total: null } };
    }
    if (data?.type === 'content_block_delta') return { text: data?.delta?.text || '', usage: null };
    if (data?.type === 'message_delta') {
      return { text: data?.delta?.text || '', usage: { input: null, output: data?.usage?.output_tokens, total: null } };
    }
    return { text: '', usage: null };
  });
}

function parseOpenAiSse(buffer, flush = false) {
  return parseSseChunks(buffer, flush, (data) => ({
    text: data?.choices?.[0]?.delta?.content || '',
    usage: normalizeUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens, data?.usage?.total_tokens),
  }), true);
}

// ── Provider descriptors ────────────────────────────────────────────

// Anthropic dropped sampling params (temperature/top_p/top_k) starting with
// Opus 4.7; Opus 4.8 and Fable 5 / Mythos 5 also reject them with a 400.
// Opus 4.6 and earlier, Sonnet, and Haiku still accept them.
function anthropicRejectsSamplingParams(model) {
  const id = String(model || '');
  if (/^claude-(fable|mythos)-5\b/.test(id)) return true;
  const opus = id.match(/^claude-opus-4-(\d+)/);
  return Boolean(opus) && Number(opus[1]) >= 7;
}

const PROVIDERS = Object.freeze({
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
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

    buildPayload(payload, settings, options = {}) {
      const model = this.resolveModel(payload, settings);
      const body = {
        model,
        max_tokens: payload?.max_tokens || 1500,
        messages: toAnthropicMessages(payload),
        stream: !!options.stream,
      };
      if (typeof payload?.system === 'string' && payload.system.trim()) {
        body.system = payload.system;
      }
      // Newer Anthropic models (Opus 4.7+, Fable 5) reject sampling params with
      // a 400, so only forward temperature for models that still accept it.
      if (typeof payload?.temperature === 'number' && !anthropicRejectsSamplingParams(model)) {
        body.temperature = payload.temperature;
      }
      return body;
    },

    parseStream: parseAnthropicSse,

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = anthropicBlocksToText(data?.content);
      if (!text) throw new Error('Anthropic returned empty content.');
      return {
        content: [{ type: 'text', text }],
        model: data?.model || requestBody.model,
        provider: 'anthropic',
        usage: normalizeUsage(data?.usage?.input_tokens, data?.usage?.output_tokens, null),
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
      const body = {
        model: this.resolveModel(payload, settings),
        stream: !!options.stream,
        messages: toChatMessages(payload),
      };
      const ollamaOptions = {};
      if (Number.isFinite(payload?.max_tokens)) ollamaOptions.num_predict = Math.max(1, Math.round(payload.max_tokens));
      if (Number.isFinite(payload?.temperature)) ollamaOptions.temperature = payload.temperature;
      if (Object.keys(ollamaOptions).length > 0) body.options = ollamaOptions;
      return body;
    },

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.message?.content;
      if (!text) throw new Error('Ollama returned empty content.');
      return {
        content: [{ type: 'text', text }],
        model: requestBody.model,
        provider: 'ollama',
        usage: normalizeUsage(data?.prompt_eval_count, data?.eval_count, null),
      };
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
      if (options.stream) body.stream_options = { include_usage: true };
      if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
      return body;
    },

    parseStream: parseOpenAiSse,

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI returned empty content.');
      return {
        content: [{ type: 'text', text }],
        model: requestBody.model,
        provider: 'openai',
        usage: normalizeUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens, data?.usage?.total_tokens),
      };
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
      return {
        content: [{ type: 'text', text }],
        model: resolvedModel || 'gemini',
        provider: 'gemini',
        usage: normalizeUsage(
          data?.usageMetadata?.promptTokenCount,
          data?.usageMetadata?.candidatesTokenCount,
          data?.usageMetadata?.totalTokenCount,
        ),
      };
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
      if (options.stream) body.stream_options = { include_usage: true };
      if (typeof payload.temperature === 'number') body.temperature = payload.temperature;
      return body;
    },

    normalizeResponse(data, requestBody, _resolvedModel) {
      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenRouter returned empty content.');
      return {
        content: [{ type: 'text', text }],
        model: requestBody.model,
        provider: 'openrouter',
        usage: normalizeUsage(data?.usage?.prompt_tokens, data?.usage?.completion_tokens, data?.usage?.total_tokens),
      };
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
