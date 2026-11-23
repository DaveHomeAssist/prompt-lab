// Floating accept window for the desktop highlight shortcut. The Rust side
// copies the selection before this window is shown, then pastes on Accept.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { mountAcceptCard } from '../../prompt-lab-extension/src/lib/highlight/acceptCard.js';
import { cancelHighlight } from '../../prompt-lab-extension/src/lib/highlight/cancelHighlight.js';
import { enhanceHighlightText } from '../../prompt-lab-extension/src/lib/highlight/enhancePayload.js';
import { readGenerationOptions } from '../../prompt-lab-extension/src/lib/generationOptions.js';
import { activeProviderRoute } from '../../prompt-lab-extension/src/lib/providerRegistry.js';
import { callModelDirect, loadSettings } from '../../prompt-lab-extension/src/lib/desktopApi.js';

function storedTheme() {
  try {
    const value = JSON.parse(localStorage.getItem('pl2-mode') || 'null');
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Leave the card to follow the system theme. */ }
  return undefined;
}

function paintPage(theme) {
  const background = theme === 'light' ? '#ffffff' : '#101018';
  document.documentElement.style.background = background;
  document.body.style.background = background;
}

let card = null;
let request = null;
let chain = Promise.resolve();

function closeCard() {
  const controller = request;
  request = null;
  try { controller?.abort(); } catch { /* Already settled. */ }
  card?.close();
  card = null;
}

async function present(payload) {
  closeCard();
  const theme = storedTheme();
  paintPage(theme);
  if (!payload || payload.kind === 'permission' || payload.kind === 'notice') {
    card = mountAcceptCard(document, {
      fill: true,
      theme,
      onCancel: () => { cancelHighlight(null, () => invoke('highlight_cancel')); },
    });
    card.showResult({
      error: payload?.message || 'Highlight enhance could not start.',
    });
    return;
  }
  const controller = new AbortController();
  request = controller;
  const signal = controller.signal;
  card = mountAcceptCard(document, {
    fill: true,
    theme,
    onCancel: () => {
      cancelHighlight(controller, () => invoke('highlight_cancel'));
    },
    onAccept: async (value) => {
      await invoke('highlight_accept', { text: value });
      return { ok: true, message: 'Pasted over the selection.' };
    },
  });
  card.showResult({ originalText: payload.text || '', pending: true });
  const settings = loadSettings();
  const result = await enhanceHighlightText(payload.text, {
    route: activeProviderRoute(settings),
    generation: readGenerationOptions(),
    signal,
    call: (body, options) => callModelDirect(body, { signal: options?.signal }),
  });
  if (signal.aborted) return;
  card?.showResult({
    originalText: payload.text || '',
    enhancedText: result.enhanced || result.raw || '',
    error: result.ok ? '' : (result.message || 'Enhance failed.'),
  });
}

function enqueuePull() {
  chain = chain.then(async () => {
    const payload = await invoke('highlight_take_payload');
    if (payload) await present(payload);
  }).catch((error) => {
    present({ kind: 'notice', message: error?.message || 'Highlight enhance failed.' }).catch(() => {});
  });
}

const preview = new URLSearchParams(location.search).get('preview') === '1' && !globalThis.__TAURI_INTERNALS__;
if (preview) {
  paintPage('dark');
  const sample = mountAcceptCard(document, {
    fill: true,
    theme: 'dark',
    onAccept: async () => ({ ok: true, message: 'Pasted over the selection.' }),
  });
  sample.showResult({
    originalText: 'Summarise the rollout.',
    enhancedText: 'Write a short rollout summary that names the audience, the change, and the date.',
  });
} else {
  listen('highlight-enhance', () => { enqueuePull(); }).catch(() => {});
  enqueuePull();
}
