/**
 * Platform abstraction layer.
 *
 * Detects whether the app is running as a Chrome extension or a standalone
 * desktop app (Tauri) and exports the appropriate implementations for:
 *   - callModel(payload) → Promise<response>
 *   - openSettings()
 *   - listOllamaModels(baseUrl) → Promise<Array<{name:string}>>
 *   - loadProviderSettings() / saveProviderSettings(settings)
 *   - testProviderConnection(payload, settings)
 *   - sessionGet(key, cb)
 *   - sessionSet(obj)
 */

const IS_EXTENSION =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime?.sendMessage === 'function';

let desktopApiPromise = null;

function getDesktopApi() {
  if (IS_EXTENSION) {
    throw new Error('Desktop API requested while running in extension mode.');
  }
  if (!desktopApiPromise) {
    desktopApiPromise = import('./desktopApi.js');
  }
  return desktopApiPromise;
}

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
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'OLLAMA_LIST_MODELS', baseUrl },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error('No response while loading Ollama models.'));
        }
        if (response.error) {
          return reject(new Error(response.error));
        }
        resolve(Array.isArray(response.models) ? response.models : []);
      }
    );
  });
}

function extLoadProviderSettings() {
  return Promise.reject(new Error('Provider settings are managed through the extension options page.'));
}

function extSaveProviderSettings() {
  return Promise.reject(new Error('Provider settings are managed through the extension options page.'));
}

function extTestProviderConnection() {
  return Promise.reject(new Error('Connection tests run through the extension options page.'));
}

function normalizeDesktopModelList(result) {
  if (result?.error) {
    throw new Error(result.error);
  }
  return Array.isArray(result?.models) ? result.models : [];
}

async function desktopCallModel(payload) {
  const { callModelDirect } = await getDesktopApi();
  return callModelDirect(payload);
}

async function desktopListOllamaModels(baseUrl) {
  const { listOllamaModelsDirect } = await getDesktopApi();
  return normalizeDesktopModelList(await listOllamaModelsDirect(baseUrl));
}

async function desktopLoadProviderSettings() {
  const { loadSettings } = await getDesktopApi();
  return loadSettings();
}

async function desktopSaveProviderSettings(settings) {
  const { saveSettings } = await getDesktopApi();
  return saveSettings(settings);
}

async function desktopTestProviderConnection(payload, settings) {
  const { callModelDirect } = await getDesktopApi();
  return callModelDirect(payload, { settingsOverride: settings });
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
export const loadProviderSettings = IS_EXTENSION ? extLoadProviderSettings : desktopLoadProviderSettings;
export const saveProviderSettings = IS_EXTENSION ? extSaveProviderSettings : desktopSaveProviderSettings;
export const testProviderConnection = IS_EXTENSION ? extTestProviderConnection : desktopTestProviderConnection;
export const sessionGet = IS_EXTENSION ? extSessionGet : desktopSessionGet;
export const sessionSet = IS_EXTENSION ? extSessionSet : desktopSessionSet;
export const openSettings = IS_EXTENSION ? extOpenSettings : desktopOpenSettings;
export const isExtension = IS_EXTENSION;
