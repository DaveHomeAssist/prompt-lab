/**
 * Desktop-mode API adapter — thin wrapper around the shared provider layer.
 *
 * Provider settings are read from localStorage (key: pl2-provider-settings).
 * All provider logic lives in ./providers.js (shared with the extension).
 */
import { callProvider, listOllamaModels as listModels } from './providers.js';
import { normalizeProvider } from './providerRegistry.js';

const SETTINGS_KEY = 'pl2-provider-settings';

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
  return callProvider({
    provider: normalizeProvider(s.provider),
    payload,
    settings: s,
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
