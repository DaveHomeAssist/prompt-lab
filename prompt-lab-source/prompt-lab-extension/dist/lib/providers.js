import {
  DEFAULTS,
  DEFAULT_PROVIDER,
  normalizeBaseUrl,
  normalizeProvider,
  toChatMessages,
  toGeminiContents,
} from './providerRegistry.js';

export { DEFAULT_PROVIDER, normalizeProvider } from './providerRegistry.js';

async function readErrorMessage(response, fallback) {
  try {
    const data = await response.json();
    if (data?.error?.message) return data.error.message;
    if (data?.message) return data.message;
    return fallback;
  } catch {
    return fallback;
  }
}

function fetchOrThrow(fetchImpl) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required.');
  }
  return fetchImpl;
}

export async function callAnthropic(payload, settings = {}, fetchImpl = globalThis.fetch) {
  const apiKey = settings.apiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Open extension Options to add one.');
  }

  const requestBody = {
    ...payload,
    model: settings.anthropicModel || payload?.model || DEFAULTS.anthropicModel,
  };

  const response = await fetchOrThrow(fetchImpl)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Anthropic request failed (${response.status})`));
  }
  const data = await response.json();
  return { ...data, model: data?.model || requestBody.model, provider: 'anthropic' };
}

export async function callOllama(payload, settings = {}, fetchImpl = globalThis.fetch) {
  const requestBody = {
    model: settings.ollamaModel || payload?.model || DEFAULTS.ollamaModel,
    stream: false,
    messages: toChatMessages(payload),
  };

  const response = await fetchOrThrow(fetchImpl)(`${normalizeBaseUrl(settings.ollamaBaseUrl, DEFAULTS.ollamaBaseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Ollama request failed (${response.status}). Is Ollama running?`));
  }

  const data = await response.json();
  const text = data?.message?.content;
  if (!text) throw new Error('Ollama returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'ollama' };
}

export async function callOpenAI(payload, settings = {}, fetchImpl = globalThis.fetch) {
  const apiKey = settings.openaiApiKey;
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Open extension Options to add one.');
  }

  const requestBody = {
    model: settings.openaiModel || payload?.model || DEFAULTS.openaiModel,
    max_tokens: payload.max_tokens || 1500,
    messages: toChatMessages(payload),
  };
  if (typeof payload.temperature === 'number') requestBody.temperature = payload.temperature;

  const response = await fetchOrThrow(fetchImpl)('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `OpenAI request failed (${response.status})`));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openai' };
}

export async function callGemini(payload, settings = {}, fetchImpl = globalThis.fetch) {
  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new Error('No Gemini API key set. Open extension Options to add one.');
  }

  const modelId = settings.geminiModel || payload?.model || DEFAULTS.geminiModel;
  const requestBody = {
    contents: toGeminiContents(payload),
    generationConfig: {},
  };

  if (typeof payload?.system === 'string' && payload.system.trim()) {
    requestBody.systemInstruction = { parts: [{ text: payload.system }] };
  }
  if (payload.max_tokens) requestBody.generationConfig.maxOutputTokens = payload.max_tokens;
  if (typeof payload.temperature === 'number') requestBody.generationConfig.temperature = payload.temperature;

  const response = await fetchOrThrow(fetchImpl)(`https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Gemini request failed (${response.status})`));
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw new Error('Gemini returned empty content.');

  return { content: [{ type: 'text', text }], model: modelId, provider: 'gemini' };
}

export async function callOpenRouter(payload, settings = {}, fetchImpl = globalThis.fetch) {
  const apiKey = settings.openrouterApiKey;
  if (!apiKey) {
    throw new Error('No OpenRouter API key set. Open extension Options to add one.');
  }

  const requestBody = {
    model: settings.openrouterModel || payload?.model || DEFAULTS.openrouterModel,
    max_tokens: payload.max_tokens || 1500,
    messages: toChatMessages(payload),
  };
  if (typeof payload.temperature === 'number') requestBody.temperature = payload.temperature;

  const response = await fetchOrThrow(fetchImpl)('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'chrome-extension://prompt-lab',
      'X-Title': 'Prompt Lab',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `OpenRouter request failed (${response.status})`));
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openrouter' };
}

export async function listOllamaModels(baseUrl, fetchImpl = globalThis.fetch) {
  const response = await fetchOrThrow(fetchImpl)(`${normalizeBaseUrl(baseUrl, DEFAULTS.ollamaBaseUrl)}/api/tags`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}`);

  const data = await response.json();
  return (data?.models || []).map((model) => ({
    name: model.name,
    size: model.size,
    modified: model.modified_at,
    family: model.details?.family || '',
    paramSize: model.details?.parameter_size || '',
  }));
}

export async function callProvider({ provider = DEFAULT_PROVIDER, payload, settings = {}, fetchImpl = globalThis.fetch }) {
  switch (normalizeProvider(provider)) {
    case 'ollama':
      return callOllama(payload, settings, fetchImpl);
    case 'openai':
      return callOpenAI(payload, settings, fetchImpl);
    case 'gemini':
      return callGemini(payload, settings, fetchImpl);
    case 'openrouter':
      return callOpenRouter(payload, settings, fetchImpl);
    default:
      return callAnthropic(payload, settings, fetchImpl);
  }
}
