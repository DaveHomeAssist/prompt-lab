// Background service worker — Manifest V3
// This is the ONLY place API credentials are used.
// panel.html sends messages here; this worker calls configured providers.

import { PROVIDER_SETTINGS_KEYS } from './lib/providerRegistry.js';
import { callProvider, listOllamaModels, normalizeProvider } from './lib/providers.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// In-flight MODEL_REQUEST controllers keyed by requestId so a MODEL_ABORT can
// terminate the underlying provider fetch, not just the UI's promise.
const activeModelRequests = new Map();

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

  if (msg?.type === 'MODEL_ABORT') {
    const controller = activeModelRequests.get(msg.requestId);
    if (controller) {
      controller.abort();
      activeModelRequests.delete(msg.requestId);
    }
    sendResponse?.({ ok: true });
    return;
  }

  if (msg?.type !== 'MODEL_REQUEST') return;

  const requestId = typeof msg.requestId === 'string' ? msg.requestId : '';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  if (requestId && controller) activeModelRequests.set(requestId, controller);

  (async () => {
    try {
      const store = await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS);
      sendResponse({
        data: await callProvider({
          provider: normalizeProvider(store.provider),
          payload: msg.payload,
          settings: store,
          signal: controller?.signal,
        }),
      });
    } catch (error) {
      sendResponse({ error: error?.message || String(error) });
    } finally {
      if (requestId) activeModelRequests.delete(requestId);
    }
  })();

  return true; // keep channel open for async response
});
