// Background service worker — Manifest V3
// This is the ONLY place API credentials are used.
// panel.html sends messages here; this worker calls configured providers.

import { PROVIDER_SETTINGS_KEYS } from './lib/providerRegistry.js';
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

  if (msg?.type !== 'MODEL_REQUEST') return;

  (async () => {
    try {
      const store = await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS);
      sendResponse({
        data: await callProvider({
          provider: normalizeProvider(store.provider),
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
