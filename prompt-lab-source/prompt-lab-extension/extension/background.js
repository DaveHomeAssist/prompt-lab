// Background service worker — Manifest V3
// This is the ONLY place API credentials are used.
// panel.html sends messages here; this worker calls configured providers.

import { DEFAULTS, PROVIDER_SETTINGS_KEYS } from './lib/providerRegistry.js';
import { callProvider, listOllamaModels, normalizeProvider } from './lib/providers.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ollama model discovery — returns list of installed models
  if (msg?.type === 'OLLAMA_LIST_MODELS') {
    (async () => {
      try {
        sendResponse({ models: await listOllamaModels(msg.baseUrl) });
      } catch (e) {
        sendResponse({ error: e.message || 'Cannot reach Ollama' });
      }
    })();
    return true;
  }

  // Configured-provider discovery — descriptors only, raw keys never leave the worker.
  if (msg?.type === 'GET_PROVIDER_SETTINGS') {
    (async () => {
      try {
        const store = await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS);
        const providers = [];
        if (store.apiKey) providers.push({ provider: 'anthropic', model: store.anthropicModel || DEFAULTS.anthropicModel });
        if (store.openaiApiKey) providers.push({ provider: 'openai', model: store.openaiModel || DEFAULTS.openaiModel });
        if (store.geminiApiKey) providers.push({ provider: 'gemini', model: store.geminiModel || DEFAULTS.geminiModel });
        if (store.openrouterApiKey) providers.push({ provider: 'openrouter', model: store.openrouterModel || DEFAULTS.openrouterModel });
        if (store.ollamaBaseUrl) providers.push({ provider: 'ollama', model: store.ollamaModel || DEFAULTS.ollamaModel });
        sendResponse({ providers });
      } catch (error) {
        sendResponse({ error: error?.message || String(error) });
      }
    })();
    return true;
  }

  if (msg?.type !== 'MODEL_REQUEST') return;

  (async () => {
    try {
      const store = await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS);
      sendResponse({
        data: await callProvider({
          // A payload-level provider (e.g. an arena column) overrides the settings default.
          provider: normalizeProvider(msg.payload?.provider || store.provider),
          payload: msg.payload,
          settings: store,
        }),
      });
    } catch (error) {
      sendResponse({ error: error?.message || String(error) });
    }
  })();

  return true; // keep channel open for async response
});
