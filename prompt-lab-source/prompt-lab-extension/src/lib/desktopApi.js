import { PROVIDER_SETTINGS_CHANGED } from './providerSettingsEvents.js';
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

function getFetchImpl(provider) {
  if (!IS_WEB || provider === 'ollama') return globalThis.fetch;
  return createProxyFetch();
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
  window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED));
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
  if (provider === HOSTED_PROVIDER && !s.apiKey) s.apiKey = HOSTED_KEY_PLACEHOLDER;
  return s;
}

export async function callModelDirect(payload, { settingsOverride, onChunk, signal } = {}) {
  const s = normalizeHostedSettings(settingsOverride || loadSettings());
  // A payload-level provider (e.g. an arena column) overrides the settings default; hosted web stays proxied.
  const provider = IS_WEB ? HOSTED_PROVIDER : normalizeProvider(payload?.provider || s.provider);
  return callProvider({
    provider,
    payload,
    settings: withDemoKeys(s, provider),
    fetchImpl: getFetchImpl(provider),
    onChunk,
    signal,
  });
}

export async function getConfiguredProvidersDirect() {
  const s = loadSettings();
  if (IS_WEB) {
    return [{ provider: HOSTED_PROVIDER, model: s.anthropicModel || DEFAULTS.anthropicModel }];
  }
  const providers = [];
  if (s.apiKey) providers.push({ provider: 'anthropic', model: s.anthropicModel || DEFAULTS.anthropicModel });
  if (s.openaiApiKey) providers.push({ provider: 'openai', model: s.openaiModel || DEFAULTS.openaiModel });
  if (s.geminiApiKey) providers.push({ provider: 'gemini', model: s.geminiModel || DEFAULTS.geminiModel });
  if (s.openrouterApiKey) providers.push({ provider: 'openrouter', model: s.openrouterModel || DEFAULTS.openrouterModel });
  if (s.ollamaBaseUrl) providers.push({ provider: 'ollama', model: s.ollamaModel || DEFAULTS.ollamaModel });
  return providers;
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
