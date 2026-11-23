import { confirmReplace, captureSelection } from '../../src/lib/highlight/selectionReplace.js';
import { mountAcceptCard } from '../../src/lib/highlight/acceptCard.js';

const rich = document.getElementById('rich');
rich.addEventListener('beforeinput', (event) => {
  if (event.inputType !== 'insertText' && event.inputType !== 'insertReplacementText') return;
  event.preventDefault();
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(event.data || ''));
});

const locked = document.getElementById('locked');
const lockedText = locked.textContent;
locked.addEventListener('beforeinput', (event) => { event.preventDefault(); });
locked.addEventListener('input', () => { locked.textContent = lockedText; });

function selectIn(id) {
  const element = document.getElementById(id);
  element.focus();
  if (typeof element.setSelectionRange === 'function') {
    element.setSelectionRange(0, 5);
    return;
  }
  const text = element.firstChild;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, Math.min(5, text.textContent.length));
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

window.__highlight = {
  async run(id, theme = 'light') {
    selectIn(id);
    const captured = captureSelection(document);
    if (!captured || captured.blocked) return captured || { ok: false };
    const enhanced = `Enhanced ${captured.text}`;
    const card = mountAcceptCard(document, {
      theme,
      anchor: captured.rect,
      onAccept: async (value) => {
        const result = await confirmReplace(captured.replace, value);
        if (result?.ok) {
          const outcome = { ok: true, message: 'Replaced the selection.' };
          window.__lastOutcome = outcome;
          return outcome;
        }
        try {
          await navigator.clipboard.writeText(value);
          const outcome = { ok: true, fallback: true, message: 'Copied, paste to replace' };
          window.__lastOutcome = outcome;
          return outcome;
        } catch (error) {
          const outcome = { ok: false, message: error?.message || 'Could not copy the enhanced text.' };
          window.__lastOutcome = outcome;
          return outcome;
        }
      },
    });
    card.showResult({ originalText: captured.text, enhancedText: enhanced });
    window.__card = card;
    return { kind: captured.kind, text: captured.text };
  },
  accept() {
    window.__card?.query('button.primary')?.click();
  },
  status() {
    return window.__card?.query('.status')?.textContent || '';
  },
  showMenu(titles) {
    const host = document.getElementById('menu-host');
    host.replaceChildren();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Context menu');
    menu.style.cssText = 'position:absolute;left:180px;top:8px;min-width:240px;padding:6px 0;background:#fff;color:#1c1917;border:1px solid #d6d3d1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);font:13px system-ui,sans-serif;z-index:2;';
    for (const title of titles) {
      const item = document.createElement('div');
      item.setAttribute('role', 'menuitem');
      item.textContent = title;
      item.style.cssText = 'padding:6px 16px;';
      menu.append(item);
    }
    host.append(menu);
  },
  showDesktop() {
    document.querySelectorAll('[data-prompt-lab-highlight]').forEach((node) => node.remove());
    const card = mountAcceptCard(document, {
      fill: true,
      theme: 'dark',
      onAccept: async () => ({ ok: true, message: 'Pasted over the selection.' }),
    });
    card.showResult({
      originalText: 'Summarise the rollout.',
      enhancedText: 'Write a short rollout summary that names the audience, the change, and the date.',
    });
    window.__card = card;
  },
};
