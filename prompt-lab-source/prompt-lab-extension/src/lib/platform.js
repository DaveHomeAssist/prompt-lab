/**
 * Platform abstraction layer.
 *
 * Detects whether the app is running as a Chrome extension or a standalone
 * desktop app (Tauri) and exports the appropriate implementations for:
 *   - callModel(payload) → Promise<response>
 *   - sessionGet(key, cb)
 *   - sessionSet(obj)
 *   - openSettings()
 *   - listOllamaModels(baseUrl) → Promise<{models}|{error}>
 */

const IS_EXTENSION =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime?.sendMessage === 'function';

// ── Chrome Extension implementation ────────────────────────────────────────

function extCallModel(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'MODEL_REQUEST', payload },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(
            new Error('No response from background. Is your API key set in Options?')
          );
        }
        if (response.error) return reject(new Error(response.error));
        resolve(response.data);
      }
    );
  });
}

function extListOllamaModels(baseUrl) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'OLLAMA_LIST_MODELS', baseUrl },
      (response) => resolve(response || { error: 'No response' })
    );
  });
}

function extSessionGet(key, cb) {
  if (!chrome.storage?.session) return cb(null);
  chrome.storage.session.get(key, (result) => cb(result?.[key] ?? null));
}

function extSessionSet(obj) {
  if (chrome.storage?.session) chrome.storage.session.set(obj);
}

function extOpenSettings() {
  if (chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
}

// ── Desktop (Tauri / standalone) implementation ────────────────────────────

async function desktopCallModel(payload) {
  const { callModelDirect } = await import('./desktopApi.js');
  return callModelDirect(payload);
}

async function desktopListOllamaModels(baseUrl) {
  const { listOllamaModelsDirect } = await import('./desktopApi.js');
  return listOllamaModelsDirect(baseUrl);
}

const SESSION_PREFIX = 'pl2-session-';
function desktopSessionGet(key, cb) {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + key);
    cb(raw ? JSON.parse(raw) : null);
  } catch {
    cb(null);
  }
}
function desktopSessionSet(obj) {
  for (const [k, v] of Object.entries(obj)) {
    try {
      localStorage.setItem(SESSION_PREFIX + k, JSON.stringify(v));
    } catch { /* quota exceeded — best effort */ }
  }
}

function desktopOpenSettings() {
  // Desktop app uses an in-app settings route; dispatch a custom event
  window.dispatchEvent(new CustomEvent('pl:open-settings'));
}

// ── Exports ────────────────────────────────────────────────────────────────

export const callModel = IS_EXTENSION ? extCallModel : desktopCallModel;
export const listOllamaModels = IS_EXTENSION ? extListOllamaModels : desktopListOllamaModels;
export const sessionGet = IS_EXTENSION ? extSessionGet : desktopSessionGet;
export const sessionSet = IS_EXTENSION ? extSessionSet : desktopSessionSet;
export const openSettings = IS_EXTENSION ? extOpenSettings : desktopOpenSettings;
export const isExtension = IS_EXTENSION;
