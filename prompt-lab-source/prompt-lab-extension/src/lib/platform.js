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

import { getInstalledProviderFixture } from './providerFixture.js';

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

function createAbortError() {
  const error = new Error('Request cancelled.');
  error.name = 'AbortError';
  return error;
}

function buildRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function extCallModel(payload, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createAbortError());
    const requestId = buildRequestId();
    let settled = false;

    const onAbort = () => {
      if (settled) return;
      settled = true;
      try {
        // Tell the background worker to abort the in-flight provider fetch;
        // rejecting locally alone would leave the upstream request running.
        chrome.runtime.sendMessage({ type: 'MODEL_ABORT', requestId }, () => {
          void chrome.runtime.lastError;
        });
      } catch { /* worker unavailable — local rejection still stands */ }
      reject(createAbortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    chrome.runtime.sendMessage(
      { type: 'MODEL_REQUEST', payload, requestId },
      (response) => {
        signal?.removeEventListener('abort', onAbort);
        if (settled) return; // aborted — a late success must not resolve
        settled = true;
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

function extCaptureContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CAPTURE_CONTEXT' }, (response) => {
      if (chrome.runtime.lastError) {
        return resolve({ ok: false, reason: chrome.runtime.lastError.message });
      }
      resolve(response || { ok: false, reason: 'No response while capturing context.' });
    });
  });
}

// Page capture only exists on the extension surface.
const desktopCaptureContext = () => Promise.resolve(null);

function extGetConfiguredProviders() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'GET_PROVIDER_SETTINGS' },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error('No response while loading provider settings.'));
        }
        if (response.error) return reject(new Error(response.error));
        resolve(Array.isArray(response.providers) ? response.providers : []);
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

async function desktopCallModel(payload, options) {
  const { callModelDirect } = await getDesktopApi();
  return callModelDirect(payload, options);
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

async function desktopGetConfiguredProviders() {
  const { getConfiguredProvidersDirect } = await getDesktopApi();
  return getConfiguredProvidersDirect();
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
  if (!chrome.storage?.session) return Promise.resolve(false);
  return new Promise((resolve) => {
    chrome.storage.session.set(obj, () => resolve(!chrome.runtime?.lastError));
  });
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
  let ok = true;
  for (const [k, v] of Object.entries(obj)) {
    try {
      localStorage.setItem(SESSION_PREFIX + k, JSON.stringify(v));
    } catch {
      ok = false;
    }
  }
  return ok;
}

function desktopOpenSettings() {
  // Desktop app uses an in-app settings route; dispatch a custom event
  window.dispatchEvent(new CustomEvent('pl:open-settings'));
}

// ── Exports ────────────────────────────────────────────────────────────────

const realCallModel = IS_EXTENSION ? extCallModel : desktopCallModel;

// Deterministic provider fixture (DHA-12). Consulted per call so a test shell
// can install or remove it between cases.
//
// The lookup is gated to test and development builds. "Production never sets
// this key" is not a security property: platform.js ships in the hosted web,
// desktop, and extension bundles, so an unguarded per-call lookup on a
// predictable global would let anything running in the page swap the provider
// transport — suppressing or forging results and observing prompt payloads.
// These are the same `import.meta.env` flags billing.js gates on, and Vite
// replaces them statically, so the branch is eliminated from a production
// build rather than merely skipped at runtime.
const FIXTURES_ENABLED = Boolean(
  import.meta.env?.MODE === 'test' || import.meta.env?.DEV,
);

export function callModel(payload, options) {
  if (FIXTURES_ENABLED) {
    const fixture = getInstalledProviderFixture();
    if (fixture) return fixture(payload, fixtureOptionsFor(options));
  }
  return realCallModel(payload, options);
}

// Streaming is not uniform across surfaces, and the fixture must not paper over
// that. `desktopCallModel` forwards `onChunk` down to `callProvider`, which
// really streams; `extCallModel` destructures only `signal` and sends a single
// MODEL_REQUEST, so on the extension the callback is never invoked. A fixture
// that streamed on both would let extension primary-flow tests assert incremental
// output that production never produces — the opposite of contract parity.
// Dropping `onChunk` here mirrors what the real extension transport does, so a
// test author does not have to know the difference.
function fixtureOptionsFor(options) {
  if (!IS_EXTENSION || !options?.onChunk) return options;
  const { onChunk, ...rest } = options;
  return rest;
}
export const listOllamaModels = IS_EXTENSION ? extListOllamaModels : desktopListOllamaModels;
export const loadProviderSettings = IS_EXTENSION ? extLoadProviderSettings : desktopLoadProviderSettings;
export const saveProviderSettings = IS_EXTENSION ? extSaveProviderSettings : desktopSaveProviderSettings;
export const testProviderConnection = IS_EXTENSION ? extTestProviderConnection : desktopTestProviderConnection;
export const getConfiguredProviders = IS_EXTENSION ? extGetConfiguredProviders : desktopGetConfiguredProviders;
export const captureContext = IS_EXTENSION ? extCaptureContext : desktopCaptureContext;
export const sessionGet = IS_EXTENSION ? extSessionGet : desktopSessionGet;
export const sessionSet = IS_EXTENSION ? extSessionSet : desktopSessionSet;
export const openSettings = IS_EXTENSION ? extOpenSettings : desktopOpenSettings;
export const isExtension = IS_EXTENSION;
