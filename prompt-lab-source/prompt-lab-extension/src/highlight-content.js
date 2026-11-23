// Injected into the page's isolated world after a context-menu click.
// Bundled as a classic script (highlight-content.js). It does not import
// provider code and never sees API keys.

import { confirmReplace, captureSelection } from './lib/highlight/selectionReplace.js';
import { mountAcceptCard, resolveHighlightTheme } from './lib/highlight/acceptCard.js';

if (!globalThis.__promptLabHighlight) {
  globalThis.__promptLabHighlight = true;

  let session = null;
  let card = null;
  let token = 0;

  const copyText = async (text) => {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard write is unavailable on this page.');
    await navigator.clipboard.writeText(text);
  };

  const fallbackCopy = async (text) => {
    try {
      await copyText(text);
      return { ok: true, fallback: true, message: 'Copied, paste to replace' };
    } catch (error) {
      return {
        ok: false,
        fallback: true,
        message: `${error?.message || 'Couldn\'t copy the enhanced text.'} Select it in the card and copy it manually.`,
      };
    }
  };

  const openCard = (anchor, theme) => {
    card?.close();
    card = mountAcceptCard(document, {
      theme: resolveHighlightTheme(theme),
      anchor,
      onAccept: async (value) => {
        if (!session?.replace) return fallbackCopy(value);
        const result = await confirmReplace(session.replace, value);
        if (result?.ok) return { ok: true, message: 'Replaced the selection.' };
        return fallbackCopy(value);
      },
      onCopy: copyText,
      onCancel: () => {
        token += 1;
        try {
          chrome.runtime.sendMessage({ type: 'PL_HIGHLIGHT_CANCEL' }, () => { void chrome.runtime.lastError; });
        } catch { /* The card still closes. */ }
      },
    });
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'PL_HIGHLIGHT') return undefined;
    if (message.action === 'capture') {
      session = captureSelection(document);
      if (!session) sendResponse({ ok: false, reason: 'no-selection' });
      else if (session.blocked) sendResponse({ ok: false, reason: session.blocked, message: session.message });
      else sendResponse({ ok: true, text: session.text, kind: session.kind });
      return undefined;
    }
    if (message.action === 'show') {
      token = message.token;
      openCard(session?.rect, message.theme);
      card.showResult({ originalText: message.original || session?.text || '', pending: true });
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.action === 'result') {
      if (message.token !== token) {
        sendResponse({ ok: false, reason: 'stale' });
        return undefined;
      }
      if (!card) openCard(session?.rect, message.theme);
      const failed = message.ok === false;
      card.showResult({
        originalText: message.original || session?.text || '',
        enhancedText: message.enhanced || message.raw || '',
        error: failed ? (message.message || 'Enhance failed.') : '',
        pending: false,
      });
      sendResponse({ ok: true });
      return undefined;
    }
    if (message.action === 'notice') {
      token += 1;
      openCard(session?.rect, message.theme);
      card.showResult({ originalText: '', error: message.message || 'Something went wrong.', pending: false });
      sendResponse({ ok: true });
    }
    return undefined;
  });
}
