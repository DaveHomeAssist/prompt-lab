// Background service worker — Manifest V3
// This is the ONLY place API credentials are used.
// panel.html sends messages here; this worker calls configured providers.

import { DEFAULTS, PROVIDER_SETTINGS_KEYS, activeProviderRoute, activeProviderSelection, migrateLegacyDefaults } from './lib/providerRegistry.js';
import { callProvider, listOllamaModels, normalizeProvider } from './lib/providers.js';
import { installHighlightMenus } from './highlight-menus.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
installHighlightMenus();

// In-flight MODEL_REQUEST controllers keyed by requestId so a MODEL_ABORT can
// terminate the underlying provider fetch, not just the UI's promise.
const activeModelRequests = new Map();

// Content scripts share this extension's id but run inside pages the user
// visits. They may send only highlight control messages. Provider calls,
// arbitrary Ollama fetches and tab capture stay with extension pages.
const CONTENT_SCRIPT_MESSAGE_TYPES = new Set(['PL_HIGHLIGHT_CANCEL', 'HIGHLIGHT_STATUS']);

function senderIsExtensionPage(sender) {
  try {
    return new URL(sender?.url || '').protocol === 'chrome-extension:';
  } catch {
    return false;
  }
}

function acceptsRuntimeMessage(msg, sender) {
  // Unit tests omit runtime.id. In the browser it is always this extension.
  if (sender?.id !== chrome.runtime.id) return false;
  // A side panel can be associated with a tab and still be an extension page.
  // Content scripts cannot set a chrome-extension sender URL.
  if (senderIsExtensionPage(sender)) return true;
  if (sender?.tab && !CONTENT_SCRIPT_MESSAGE_TYPES.has(msg?.type)) return false;
  return true;
}

// ── Message listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!acceptsRuntimeMessage(msg, sender)) return;

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

  // Capture the active tab's selection/title/url for the editor's context vars.
  if (msg?.type === 'CAPTURE_CONTEXT') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return sendResponse({ ok: false, reason: 'No active tab found.' });
        if (!/^https?:/i.test(tab.url || '')) {
          return sendResponse({ ok: false, reason: 'This page cannot be captured.' });
        }
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            selection: String(window.getSelection?.() || ''),
            title: document.title || '',
            url: location.href,
          }),
        });
        sendResponse({ ok: true, capture: result?.result || { selection: '', title: tab.title || '', url: tab.url || '' } });
      } catch (error) {
        sendResponse({ ok: false, reason: error?.message || String(error) });
      }
    })();
    return true;
  }

  // Configured-provider discovery — descriptors only, raw keys never leave the worker.
  if (msg?.type === 'GET_PROVIDER_SETTINGS') {
    (async () => {
      try {
        const store = migrateLegacyDefaults(await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS));
        const providers = [];
        if (store.apiKey) providers.push({ provider: 'anthropic', model: store.anthropicModel || DEFAULTS.anthropicModel });
        if (store.openaiApiKey) providers.push({ provider: 'openai', model: store.openaiModel || DEFAULTS.openaiModel });
        if (store.geminiApiKey) providers.push({ provider: 'gemini', model: store.geminiModel || DEFAULTS.geminiModel });
        if (store.openrouterApiKey) providers.push({ provider: 'openrouter', model: store.openrouterModel || DEFAULTS.openrouterModel });
        if (store.ollamaBaseUrl) providers.push({ provider: 'ollama', model: store.ollamaModel || DEFAULTS.ollamaModel });
        sendResponse({
          providers,
          active: activeProviderSelection(store),
          selected: activeProviderRoute(store),
        });
      } catch (error) {
        sendResponse({ error: error?.message || String(error) });
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
      const store = migrateLegacyDefaults(await chrome.storage.local.get(PROVIDER_SETTINGS_KEYS));
      sendResponse({
        data: await callProvider({
          // A payload-level provider (e.g. an arena column) overrides the settings default.
          provider: normalizeProvider(msg.payload?.provider || store.provider),
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
