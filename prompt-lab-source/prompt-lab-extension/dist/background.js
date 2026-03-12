// Background service worker — Manifest V3
// This is the ONLY place API credentials are used.
// panel.html sends messages here; this worker calls configured providers.

const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-preview-04-17';
const DEFAULT_OPENROUTER_MODEL = 'anthropic/claude-sonnet-4-20250514';

const VALID_PROVIDERS = ['anthropic', 'ollama', 'openai', 'gemini', 'openrouter'];

function normalizeProvider(provider) {
  return VALID_PROVIDERS.includes(provider) ? provider : DEFAULT_PROVIDER;
}

function normalizeBaseUrl(baseUrl, fallback) {
  const raw = (baseUrl || fallback).trim();
  return raw.replace(/\/+$/, '');
}

function anthropicBlocksToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block?.text === 'string' ? block.text : ''))
    .join('');
}

// ── Message converters ──────────────────────────────────────────────────────

function toChatMessages(payload) {
  const out = [];
  if (typeof payload?.system === 'string' && payload.system.trim()) {
    out.push({ role: 'system', content: payload.system });
  }
  for (const msg of payload?.messages || []) {
    const role = ['system', 'assistant', 'user'].includes(msg?.role) ? msg.role : 'user';
    const content = anthropicBlocksToText(msg?.content);
    out.push({ role, content });
  }
  return out;
}

function toGeminiContents(payload) {
  const contents = [];
  for (const msg of payload?.messages || []) {
    const role = msg?.role === 'assistant' ? 'model' : 'user';
    const text = anthropicBlocksToText(msg?.content);
    contents.push({ role, parts: [{ text }] });
  }
  return contents;
}

// ── Error reader ────────────────────────────────────────────────────────────

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

// ── Provider calls ──────────────────────────────────────────────────────────

async function callAnthropic(payload, apiKey) {
  if (!apiKey) {
    throw new Error('No Anthropic API key set. Open extension Options to add one.');
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const msg = await readErrorMessage(response, `Anthropic request failed (${response.status})`);
    throw new Error(msg);
  }
  return response.json();
}

async function callOllama(payload, baseUrl, model) {
  const requestBody = {
    model: model || DEFAULT_OLLAMA_MODEL,
    stream: false,
    messages: toChatMessages(payload),
  };

  const response = await fetch(`${normalizeBaseUrl(baseUrl, DEFAULT_OLLAMA_BASE_URL)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const msg = await readErrorMessage(response, `Ollama request failed (${response.status}). Is Ollama running?`);
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data?.message?.content;
  if (!text) throw new Error('Ollama returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'ollama' };
}

async function callOpenAI(payload, apiKey, model) {
  if (!apiKey) {
    throw new Error('No OpenAI API key set. Open extension Options to add one.');
  }

  const requestBody = {
    model: model || DEFAULT_OPENAI_MODEL,
    max_tokens: payload.max_tokens || 1500,
    messages: toChatMessages(payload),
  };
  if (typeof payload.temperature === 'number') requestBody.temperature = payload.temperature;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const msg = await readErrorMessage(response, `OpenAI request failed (${response.status})`);
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openai' };
}

async function callGemini(payload, apiKey, model) {
  if (!apiKey) {
    throw new Error('No Gemini API key set. Open extension Options to add one.');
  }

  const modelId = model || DEFAULT_GEMINI_MODEL;
  const contents = toGeminiContents(payload);
  const requestBody = { contents, generationConfig: {} };

  if (typeof payload?.system === 'string' && payload.system.trim()) {
    requestBody.systemInstruction = { parts: [{ text: payload.system }] };
  }
  if (payload.max_tokens) requestBody.generationConfig.maxOutputTokens = payload.max_tokens;
  if (typeof payload.temperature === 'number') requestBody.generationConfig.temperature = payload.temperature;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const msg = await readErrorMessage(response, `Gemini request failed (${response.status})`);
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned empty content.');

  return { content: [{ type: 'text', text }], model: modelId, provider: 'gemini' };
}

async function callOpenRouter(payload, apiKey, model) {
  if (!apiKey) {
    throw new Error('No OpenRouter API key set. Open extension Options to add one.');
  }

  const requestBody = {
    model: model || DEFAULT_OPENROUTER_MODEL,
    max_tokens: payload.max_tokens || 1500,
    messages: toChatMessages(payload),
  };
  if (typeof payload.temperature === 'number') requestBody.temperature = payload.temperature;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'chrome-extension://prompt-lab',
      'X-Title': 'Prompt Lab',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const msg = await readErrorMessage(response, `OpenRouter request failed (${response.status})`);
    throw new Error(msg);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenRouter returned empty content.');

  return { content: [{ type: 'text', text }], model: requestBody.model, provider: 'openrouter' };
}

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ollama model discovery — returns list of installed models
  if (msg?.type === 'OLLAMA_LIST_MODELS') {
    (async () => {
      try {
        const baseUrl = normalizeBaseUrl(msg.baseUrl, DEFAULT_OLLAMA_BASE_URL);
        const response = await fetch(`${baseUrl}/api/tags`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
        const data = await response.json();
        const models = (data?.models || []).map(m => ({
          name: m.name,
          size: m.size,
          modified: m.modified_at,
          family: m.details?.family || '',
          paramSize: m.details?.parameter_size || '',
        }));
        sendResponse({ models });
      } catch (e) {
        sendResponse({ error: e.message || 'Cannot reach Ollama' });
      }
    })();
    return true;
  }

  if (msg?.type !== 'MODEL_REQUEST') return;

  (async () => {
    try {
      const store = await chrome.storage.local.get([
        'provider', 'apiKey',
        'ollamaBaseUrl', 'ollamaModel',
        'openaiApiKey', 'openaiModel',
        'geminiApiKey', 'geminiModel',
        'openrouterApiKey', 'openrouterModel',
      ]);

      const selected = normalizeProvider(store.provider);
      let data;

      switch (selected) {
        case 'ollama':
          data = await callOllama(msg.payload, store.ollamaBaseUrl, store.ollamaModel);
          break;
        case 'openai':
          data = await callOpenAI(msg.payload, store.openaiApiKey, store.openaiModel || msg.payload?.model);
          break;
        case 'gemini':
          data = await callGemini(msg.payload, store.geminiApiKey, store.geminiModel || msg.payload?.model);
          break;
        case 'openrouter':
          data = await callOpenRouter(msg.payload, store.openrouterApiKey, store.openrouterModel || msg.payload?.model);
          break;
        default:
          data = await callAnthropic(msg.payload, store.apiKey);
      }

      sendResponse({ data });
    } catch (error) {
      sendResponse({ error: error?.message || String(error) });
    }
  })();

  return true; // keep channel open for async response
});
