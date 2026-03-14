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
  && import.meta.env?.VITE_WEB_MODE === 'true';

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

export async function callModelDirect(payload, { settingsOverride } = {}) {
  const s = settingsOverride || loadSettings();
  const provider = normalizeProvider(s.provider);
  return callProvider({
    provider,
    payload,
    settings: s,
    fetchImpl: getFetchImpl(provider),
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
