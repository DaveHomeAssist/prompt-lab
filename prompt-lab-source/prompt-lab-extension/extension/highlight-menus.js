// Context menu for "Enhance with Prompt Lab" and "Send to Prompt Lab".
// Injected page script stays in the isolated world. Provider calls stay in
// this worker, through the same callProvider module as the side panel.

import { PROVIDER_SETTINGS_KEYS } from './lib/providerRegistry.js';
// Static import: Manifest V3 service workers reject import(), so a dynamic
// load of the enhance module never reaches the provider.
import { enhanceSelection } from './highlight-worker.js';
import { enhanceDecision } from './lib/highlightField.js';

export { enhanceDecision };

export const HIGHLIGHT_MENU_KEY = 'pl2-highlight-context-menu';
export const HIGHLIGHT_GENERATION_KEY = 'pl2-generation-options-v1';
export const HIGHLIGHT_THEME_KEY = 'pl2-mode';
export const HIGHLIGHT_DRAFT_KEY = 'pl2-highlight-draft';
export const ENHANCE_MENU_ID = 'prompt-lab-enhance-selection';
export const SEND_MENU_ID = 'prompt-lab-send-selection';
export const HIGHLIGHT_MENU_TITLES = Object.freeze([
  'Enhance with Prompt Lab',
  'Send to Prompt Lab',
]);

const aborts = new Map();
let tokenSeq = 0;

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (stored) => {
      void chrome.runtime.lastError;
      resolve(stored || {});
    });
  });
}

export function highlightMenuEnabled(stored) {
  return stored?.[HIGHLIGHT_MENU_KEY] !== false;
}

function frameIdOf(info) {
  return Number.isInteger(info?.frameId) ? info.frameId : 0;
}

function sendToFrame(tabId, frameId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) resolve({ ok: false, reason: error.message });
      else resolve(response || { ok: false, reason: 'The page did not answer.' });
    });
  });
}

async function inject(tabId, frameId) {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [frameId] },
    files: ['highlight-content.js'],
  });
}

async function deliverToWrite(tab, text, notice) {
  await chrome.storage.session.set({
    [HIGHLIGHT_DRAFT_KEY]: { text, notice: notice || '', at: Date.now() },
  });
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
  }
}

async function syncMenus() {
  const stored = await storageGet(HIGHLIGHT_MENU_KEY);
  const enabled = highlightMenuEnabled(stored);
  globalThis.__promptLabHighlightMenu = { enabled, titles: enabled ? [...HIGHLIGHT_MENU_TITLES] : [] };
  await new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
  if (!enabled) return;
  const items = [
    [ENHANCE_MENU_ID, HIGHLIGHT_MENU_TITLES[0]],
    [SEND_MENU_ID, HIGHLIGHT_MENU_TITLES[1]],
  ];
  for (const [id, title] of items) {
    chrome.contextMenus.create({ id, title, contexts: ['selection'] }, () => {
      void chrome.runtime.lastError;
    });
  }
}

function frameLooksCrossOrigin(tab, info) {
  try {
    const frameUrl = new URL(info?.frameUrl || info?.pageUrl || '');
    const tabUrl = new URL(tab?.url || '');
    return frameUrl.origin !== tabUrl.origin;
  } catch {
    return false;
  }
}

async function capturedText(tab, info) {
  const frameId = frameIdOf(info);
  const crossOrigin = frameLooksCrossOrigin(tab, info);
  try {
    await inject(tab.id, frameId);
  } catch (error) {
    return {
      ok: false,
      frameId,
      reason: crossOrigin ? 'frame' : 'unclassified',
      message: crossOrigin
        ? "This frame couldn't be checked, so nothing was sent."
        : "This field couldn't be checked, so nothing was sent.",
      detail: error?.message || '',
    };
  }
  const captured = await sendToFrame(tab.id, frameId, { type: 'PL_HIGHLIGHT', action: 'capture' });
  if (!captured?.ok) {
    return {
      ...captured,
      ok: false,
      frameId,
      reason: captured?.reason || (crossOrigin ? 'frame' : 'unclassified'),
      message: captured?.message || (crossOrigin
        ? "This frame couldn't be checked, so nothing was sent."
        : "This field couldn't be checked, so nothing was sent."),
    };
  }
  return { ...captured, frameId };
}

async function showNotice(tab, frameId, theme, message) {
  const note = { type: 'PL_HIGHLIGHT', action: 'notice', theme, message };
  const first = await sendToFrame(tab.id, frameId, note);
  if (first?.ok) return;
  try {
    await inject(tab.id, frameId);
    if ((await sendToFrame(tab.id, frameId, note))?.ok) return;
  } catch { /* The target frame cannot show UI. */ }
  if (frameId !== 0) {
    try {
      await inject(tab.id, 0);
      await sendToFrame(tab.id, 0, note);
    } catch { /* Nothing was sent. The notice could not be shown. */ }
  }
}

async function onSend(tab, info) {
  const captured = await capturedText(tab, info);
  if (captured.blocked === 'password' || captured.blocked === 'secret' || captured.reason === 'password' || captured.reason === 'secret') {
    const themeStore = await storageGet(HIGHLIGHT_THEME_KEY);
    await showNotice(tab, captured.frameId, themeStore[HIGHLIGHT_THEME_KEY], captured.message || 'Secure fields are left alone. Nothing was sent.');
    return;
  }
  const text = captured.ok ? captured.text : '';
  if (!text.trim()) {
    if (captured.frameId != null && captured.reason !== 'This page cannot be edited in place.') {
      await sendToFrame(tab.id, captured.frameId, {
        type: 'PL_HIGHLIGHT',
        action: 'notice',
        message: captured.message || 'Select some text first.',
      });
    }
    return;
  }
  await deliverToWrite(tab, text, 'Selection loaded in Write');
}

async function onEnhance(tab, info) {
  const captured = await capturedText(tab, info);
  const themeStore = await storageGet([HIGHLIGHT_THEME_KEY, HIGHLIGHT_GENERATION_KEY, ...PROVIDER_SETTINGS_KEYS]);
  const theme = themeStore[HIGHLIGHT_THEME_KEY];
  const decision = enhanceDecision(captured);
  if (!decision.proceed) {
    await showNotice(tab, captured.frameId ?? frameIdOf(info), theme, decision.message);
    return;
  }
  const text = decision.text;
  const token = tokenSeq + 1;
  tokenSeq = token;
  if (captured.ok) {
    await sendToFrame(tab.id, captured.frameId, {
      type: 'PL_HIGHLIGHT',
      action: 'show',
      token,
      theme,
      original: text,
    });
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  aborts.set(tab.id, { token, controller });
  try {
    const result = await enhanceSelection(text, themeStore, themeStore[HIGHLIGHT_GENERATION_KEY], controller?.signal);
    if (aborts.get(tab.id)?.token !== token) return;
    if (captured.ok) {
      await sendToFrame(tab.id, captured.frameId, {
        type: 'PL_HIGHLIGHT',
        action: 'result',
        token,
        theme,
        original: text,
        ok: result.ok,
        enhanced: result.enhanced || '',
        raw: result.raw || '',
        message: result.message || '',
      });
      return;
    }
    await showNotice(tab, captured.frameId, theme, result.ok
      ? 'This page could not show the card, so nothing was inserted.'
      : (result.message || 'Enhance failed. Nothing was sent.'));
    return;
  } catch (error) {
    if (aborts.get(tab.id)?.token !== token) return;
    const message = error?.message || 'Enhance failed.';
    if (captured.ok) {
      await sendToFrame(tab.id, captured.frameId, {
        type: 'PL_HIGHLIGHT',
        action: 'result',
        token,
        theme,
        original: text,
        ok: false,
        message,
      });
    } else {
      await deliverToWrite(tab, text, message);
    }
  } finally {
    if (aborts.get(tab.id)?.token === token) aborts.delete(tab.id);
  }
}

export function installHighlightMenus() {
  if (!chrome.contextMenus?.create || !chrome.storage?.local?.get || !chrome.runtime?.onMessage) return;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'HIGHLIGHT_STATUS') {
      sendResponse(globalThis.__promptLabHighlightMenu || { enabled: true, titles: [...HIGHLIGHT_MENU_TITLES] });
      return undefined;
    }
    if (message?.type !== 'PL_HIGHLIGHT_CANCEL') return undefined;
    const entry = aborts.get(sender?.tab?.id);
    entry?.controller?.abort();
    if (sender?.tab?.id != null) aborts.delete(sender.tab.id);
    sendResponse({ ok: true });
    return undefined;
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === SEND_MENU_ID) void onSend(tab, info);
    if (info.menuItemId === ENHANCE_MENU_ID) void onEnhance(tab, info);
  });

  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && Object.prototype.hasOwnProperty.call(changes, HIGHLIGHT_MENU_KEY)) void syncMenus();
  });
  chrome.runtime.onInstalled?.addListener(() => { void syncMenus(); });
  chrome.runtime.onStartup?.addListener(() => { void syncMenus(); });
  void syncMenus();
}
