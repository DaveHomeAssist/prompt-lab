export const DEFAULT_PROVIDER = 'anthropic';

export const DEFAULTS = Object.freeze({
  provider: DEFAULT_PROVIDER,
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  anthropicModel: 'claude-sonnet-4-20250514',
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
  const contents = [];
  for (const msg of payload?.messages || []) {
    contents.push({
      role: msg?.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: anthropicBlocksToText(msg?.content) }],
    });
  }
  return contents;
}
