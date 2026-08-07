export const DEFAULT_PROVIDER = 'anthropic';

export const DEFAULTS = Object.freeze({
  provider: DEFAULT_PROVIDER,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  ollamaContextLength: 4096,
  anthropicModel: 'claude-sonnet-4-6',
  openaiModel: 'gpt-4o',
  geminiModel: 'gemini-2.5-flash',
  openrouterModel: 'anthropic/claude-sonnet-4-20250514',
});

export const VALID_PROVIDERS = Object.freeze([
  'anthropic',
  'ollama',
  'openai',
  'gemini',
  'openrouter',
]);

export const PROVIDER_SETTINGS_KEYS = Object.freeze([
  'provider',
  'apiKey',
  'anthropicModel',
  'ollamaBaseUrl',
  'ollamaModel',
  'ollamaContextLength',
  'openaiApiKey',
  'openaiModel',
  'geminiApiKey',
  'geminiModel',
  'openrouterApiKey',
  'openrouterModel',
]);

export function normalizeProvider(provider) {
  return VALID_PROVIDERS.includes(provider) ? provider : DEFAULT_PROVIDER;
}

export function normalizeBaseUrl(baseUrl, fallback = DEFAULTS.ollamaBaseUrl) {
  const raw = String(baseUrl || fallback).trim();
  return raw.replace(/\/+$/, '');
}

export function normalizeOllamaContextLength(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULTS.ollamaContextLength;
  return Math.min(131072, Math.max(1024, parsed));
}

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

// Anthropic dropped sampling params (temperature/top_p/top_k) starting with
// Opus 4.7; Opus 4.8 and Fable 5 / Mythos 5 also reject them with a 400.
// Opus 4.6 and earlier, Sonnet, and Haiku still accept them.
export function anthropicRejectsSamplingParams(model) {
  const id = String(model || '');
  if (/^claude-(fable|mythos)-5\b/.test(id)) return true;
  const opus = id.match(/^claude-opus-4-(\d+)/);
  return Boolean(opus) && Number(opus[1]) >= 7;
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
  const contents = [];
  for (const msg of payload?.messages || []) {
    contents.push({
      role: msg?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: anthropicBlocksToText(msg?.content) }],
    });
  }
  return contents;
}
