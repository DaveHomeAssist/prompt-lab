/**
 * Desktop-mode API adapter — thin wrapper around the shared provider layer.
 *
 * Provider settings are read from localStorage (key: pl2-provider-settings).
 * All provider logic lives in ./providers.js (shared with the extension).
 */
import { callProvider, listOllamaModels as listModels } from './providers.js';
import { DEFAULTS, normalizeProvider } from './providerRegistry.js';
import { createProxyFetch } from './proxyFetch.js';

const SETTINGS_KEY = 'pl2-provider-settings';
const HOSTED_PROVIDER = 'anthropic';
export const HOSTED_KEY_PLACEHOLDER = '__plb_hosted_shared_key__';

const IS_WEB = typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_WEB_MODE === 'true';
const HOSTED_PROXY_ENABLED = IS_WEB
  && import.meta.env?.VITE_HOSTED_PROXY_ENABLED === 'true';
const HOSTED_SHARED_KEY_ENABLED = HOSTED_PROXY_ENABLED
  && import.meta.env?.VITE_HOSTED_SHARED_KEY_ENABLED === 'true';

function getFetchImpl(provider) {
  if (!IS_WEB || provider === 'ollama') return globalThis.fetch;
  return HOSTED_PROXY_ENABLED ? createProxyFetch() : globalThis.fetch;
}

function normalizeHostedSettings(settings = {}) {
  if (!IS_WEB) return settings;
  return {
    ...settings,
    provider: HOSTED_PROVIDER,
    anthropicModel: settings.anthropicModel || DEFAULTS.anthropicModel,
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return normalizeHostedSettings(parsed);
  } catch {
    return normalizeHostedSettings({});
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeHostedSettings(settings)));
}

/**
 * In web demo mode the proxy injects real keys server-side,
 * but providers.js still checks for a truthy key before calling fetch.
 * Inject a sentinel placeholder so the validation passes — the proxy strips
 * it and injects the shared hosted key only when no personal key is present.
 */
function withDemoKeys(settings, provider) {
  if (!IS_WEB) return settings;
  const s = { ...settings };
  if (HOSTED_SHARED_KEY_ENABLED && provider === HOSTED_PROVIDER && !s.apiKey) {
    s.apiKey = HOSTED_KEY_PLACEHOLDER;
  }
  return s;
}

export async function callModelDirect(payload, { settingsOverride, onChunk, signal } = {}) {
  const s = normalizeHostedSettings(settingsOverride || loadSettings());
  const provider = IS_WEB ? HOSTED_PROVIDER : normalizeProvider(s.provider);
  return callProvider({
    provider,
    payload,
    settings: withDemoKeys(s, provider),
    fetchImpl: getFetchImpl(provider),
    onChunk,
    signal,
  });
}

export async function listOllamaModelsDirect(baseUrl) {
  if (IS_WEB) {
    return { error: 'Ollama is unavailable in hosted web mode.' };
  }
  try {
    const models = await listModels(baseUrl);
    return { models };
  } catch (e) {
    return { error: e.message || 'Cannot reach Ollama' };
  }
}
