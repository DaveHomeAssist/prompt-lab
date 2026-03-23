/**
 * Desktop-mode API adapter — thin wrapper around the shared provider layer.
 *
 * Provider settings are read from localStorage (key: pl2-provider-settings).
 * All provider logic lives in ./providers.js (shared with the extension).
 */
import { callProvider, listOllamaModels as listModels } from './providers.js';
import { normalizeProvider } from './providerRegistry.js';
import { createProxyFetch } from './proxyFetch.js';

const SETTINGS_KEY = 'pl2-provider-settings';

const IS_WEB = typeof import.meta !== 'undefined'
  && import.meta.env.VITE_WEB_MODE === 'true';

function getFetchImpl(provider) {
  if (!IS_WEB || provider === 'ollama') return globalThis.fetch;
  return createProxyFetch();
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * On the hosted web surface the proxy injects server-side API keys,
 * so provider-layer validation needs a truthy key to proceed.
 * We use a 'proxy' sentinel so it's clear no real client key exists.
 * On non-web surfaces this is a no-op — users supply their own keys (BYOK).
 */
function withProxyKeys(settings, provider) {
  if (!IS_WEB) return settings;
  const s = { ...settings };
  if (provider === 'anthropic' && !s.apiKey)            s.apiKey = 'proxy';
  if (provider === 'openai'    && !s.openaiApiKey)      s.openaiApiKey = 'proxy';
  if (provider === 'gemini'    && !s.geminiApiKey)       s.geminiApiKey = 'proxy';
  if (provider === 'openrouter' && !s.openrouterApiKey)  s.openrouterApiKey = 'proxy';
  return s;
}

export async function callModelDirect(payload, { settingsOverride, onChunk, signal } = {}) {
  const s = settingsOverride || loadSettings();
  const provider = normalizeProvider(s.provider);
  return callProvider({
    provider,
    payload,
    settings: withProxyKeys(s, provider),
    fetchImpl: getFetchImpl(provider),
    onChunk,
    signal,
  });
}

export async function listOllamaModelsDirect(baseUrl) {
  try {
    const models = await listModels(baseUrl);
    return { models };
  } catch (e) {
    return { error: e.message || 'Cannot reach Ollama' };
  }
}
