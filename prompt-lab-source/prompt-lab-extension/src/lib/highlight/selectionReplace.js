// Capture a text selection and replace it in place.
// Inputs and textareas go through document.execCommand('insertText') so Chrome
// records the edit on the field's own undo stack. setRangeText is only the
// fallback when that command returns false. Contenteditable uses the same
// command first, then a beforeinput/input event the editor can apply itself.
// Nothing here reads extension storage or provider credentials.

import { secretFieldRefusal } from '../../../extension/lib/highlightField.js';

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'url', 'tel', 'email']);

export function isPasswordField(element) {
  return element?.tagName === 'INPUT' && String(element.getAttribute?.('type') || '').toLowerCase() === 'password';
}

export function isTextControl(element) {
  if (!element?.tagName) return false;
  if (element.tagName === 'TEXTAREA') return true;
  if (element.tagName !== 'INPUT') return false;
  const type = String(element.getAttribute?.('type') || '').toLowerCase();
  return TEXT_INPUT_TYPES.has(type);
}

function parentAcrossShadow(node) {
  if (!node) return null;
  if (node.nodeType === 3) return node.parentElement || node.parentNode?.host || null;
  if (node.parentElement) return node.parentElement;
  const root = node.getRootNode?.();
  return root?.host || null;
}

/** Nearest contenteditable ancestor, crossing open shadow roots. */
export function editableHost(node) {
  let current = node?.nodeType === 3 ? node.parentElement : node;
  while (current && current.nodeType === 1) {
    const raw = current.getAttribute?.('contenteditable');
    const attr = raw == null ? null : String(raw).toLowerCase();
    const prop = String(current.contentEditable || '').toLowerCase();
    // An empty contenteditable attribute means the element is editable.
    // A missing attribute is null and must not match.
    if (current.isContentEditable || attr === '' || attr === 'true' || attr === 'plaintext-only' || prop === 'true' || prop === 'plaintext-only') return current;
    current = parentAcrossShadow(current);
  }
  return null;
}

export function editableText(host) {
  const doc = host.ownerDocument;
  const walker = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let out = '';
  let node = walker.nextNode();
  while (node) {
    out += node.nodeValue || '';
    node = walker.nextNode();
  }
  return out;
}

function boundaryOffset(host, container, offset) {
  if (!container) return null;
  try {
    const range = host.ownerDocument.createRange();
    range.selectNodeContents(host);
    range.setEnd(container, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

function rectOf(element) {
  const rect = element.getBoundingClientRect?.();
  if (!rect) return { left: 16, top: 16, bottom: 40, width: 120, height: 24 };
  return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function rectOfRange(range, fallback) {
  try {
    const rect = range.getBoundingClientRect();
    if (rect && (rect.width || rect.height || rect.top || rect.left)) return rectOf({ getBoundingClientRect: () => rect });
  } catch { /* fall through */ }
  return fallback ? rectOf(fallback) : { left: 16, top: 16, bottom: 40, width: 120, height: 24 };
}

function dispatchInput(element, text) {
  element.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    cancelable: false,
    inputType: 'insertReplacementText',
    data: text,
  }));
}

/**
 * Replace the stored offsets with `text` and confirm the control's value.
 * Returns verify() so the caller can check the page did not revert the edit.
 */
function selectControlRange(element, start, end) {
  try { element.focus(); } catch { /* Focus can fail and the command can still run. */ }
  if (typeof element.setSelectionRange === 'function') {
    try { element.setSelectionRange(start, end); } catch { /* Non-text inputs have no caret. */ }
  }
}

export function replaceTextControl(element, text, start, end, expectedOriginal) {
  const before = String(element.value ?? '');
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > before.length || start >= end) {
    return { ok: false, reason: 'no-selection' };
  }
  // REVIEW-2026-11-25 High: the offsets were captured when the menu was
  // clicked. If the field was edited while the result was pending, they no
  // longer point at the selected words, so refuse instead of overwriting
  // the wrong span. The caller copies the result instead.
  if (typeof expectedOriginal === 'string' && before.slice(start, end) !== expectedOriginal) {
    return { ok: false, reason: 'changed' };
  }
  const expected = before.slice(0, start) + text + before.slice(end);
  const doc = element.ownerDocument;
  selectControlRange(element, start, end);
  let commandOk = false;
  try {
    commandOk = doc.execCommand('insertText', false, text) === true;
  } catch {
    commandOk = false;
  }
  if (commandOk && element.value === expected) {
    dispatchInput(element, text);
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, method: 'execCommand', verify: () => element.value === expected };
  }
  // The command did not land. Put the field back before the fallback so a
  // partial command cannot combine with setRangeText.
  if (element.value !== before) {
    element.value = before;
    selectControlRange(element, start, end);
  }
  if (commandOk) return { ok: false, reason: 'unverified' };
  if (typeof element.setRangeText !== 'function') return { ok: false, reason: 'setRangeText-unavailable' };
  element.setRangeText(text, start, end, 'end');
  if (element.value !== expected) return { ok: false, reason: 'unverified' };
  dispatchInput(element, text);
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, method: 'setRangeText', verify: () => element.value === expected };
}

function snapshotNodes(host) {
  return Array.from(host.childNodes, (node) => node.cloneNode(true));
}

function restoreNodes(host, nodes) {
  // Clone again so a later restore still has the original nodes.
  host.replaceChildren(...nodes.map((node) => node.cloneNode(true)));
}

/**
 * Replace `range` inside a contenteditable host.
 * Tries execCommand('insertText'), then a cancelable beforeinput, then a
 * DOM insert plus an input event. Each failed attempt restores the snapshot
 * before the next one, and the result is accepted only when the host text
 * matches the edit exactly.
 */
export function replaceContentEditable(host, range, text, expectedOriginal) {
  const doc = host.ownerDocument;
  // REVIEW-2026-11-25 High: the live range moves with edits around it, but an
  // edit inside it changes its text. Refuse rather than replace what the user
  // typed since the capture.
  if (typeof expectedOriginal === 'string') {
    let current = null;
    try { current = range.toString(); } catch { current = null; }
    if (current !== expectedOriginal) return { ok: false, reason: 'changed' };
  }
  const snapshot = snapshotNodes(host);
  const before = editableText(host);
  const start = boundaryOffset(host, range.startContainer, range.startOffset);
  const end = boundaryOffset(host, range.endContainer, range.endOffset);
  if (start == null || end == null || end < start) return { ok: false, reason: 'no-selection' };
  const expected = before.slice(0, start) + text + before.slice(end);
  const verified = () => editableText(host) === expected;

  const reselect = () => {
    const selection = doc.getSelection?.();
    if (!selection) return;
    selection.removeAllRanges();
    try { selection.addRange(range); } catch { /* The range may have been detached by a failed edit. */ }
  };

  const attempt = (method, run) => {
    const prior = editableText(host);
    try { run(); } catch { /* The editor can throw from a command; treat it as a miss. */ }
    if (verified()) return { ok: true, method, verify: verified };
    if (editableText(host) !== prior) restoreNodes(host, snapshot);
    return null;
  };

  try { host.focus(); } catch { /* Focus is helpful, not required. */ }

  const command = attempt('execCommand', () => {
    reselect();
    // execCommand fires its own input event when the browser applies the text.
    doc.execCommand('insertText', false, text);
  });
  if (command?.ok) return command;

  const fromEvent = attempt('beforeinput', () => {
    reselect();
    host.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: text,
    }));
  });
  if (fromEvent?.ok) return fromEvent;

  const manual = attempt('input-event', () => {
    reselect();
    range.deleteContents();
    range.insertNode(doc.createTextNode(text));
    dispatchInput(host, text);
  });
  if (manual?.ok) return manual;

  if (editableText(host) !== before) restoreNodes(host, snapshot);
  return { ok: false, reason: 'unverified' };
}

/** Describe the current selection and keep a replace() closure over the live node. */
export function captureSelection(doc = document) {
  const active = doc.activeElement;
  const refused = secretFieldRefusal(active);
  if (refused) return refused;
  if (isTextControl(active)) {
    const start = active.selectionStart;
    const end = active.selectionEnd;
    const value = String(active.value ?? '');
    if (Number.isInteger(start) && Number.isInteger(end) && end > start) {
      const text = value.slice(start, end);
      if (text) {
        return {
          text,
          kind: active.tagName === 'TEXTAREA' ? 'textarea' : 'input',
          rect: rectOf(active),
          replace: (next) => replaceTextControl(active, next, start, end, text),
        };
      }
    }
  }

  const selection = doc.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString();
  if (!text) return null;
  let range;
  try { range = selection.getRangeAt(0).cloneRange(); } catch { return null; }
  const host = editableHost(range.commonAncestorContainer);
  const hostRefused = secretFieldRefusal(host);
  if (hostRefused) return hostRefused;
  if (!host) {
    return {
      text,
      kind: 'selection',
      rect: rectOfRange(range, null),
      replace: () => ({ ok: false, reason: 'not-editable' }),
    };
  }
  const rangeText = range.toString();
  return {
    text,
    kind: 'contenteditable',
    rect: rectOfRange(range, host),
    replace: (next) => replaceContentEditable(host, range, next, rangeText),
  };
}

/** Re-check a successful replace after the page has had a turn to revert it. */
export function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export async function confirmReplace(replace, text, wait = delay) {
  const result = replace(text);
  if (!result?.ok) return result || { ok: false, reason: 'unverified' };
  await wait(30);
  if (typeof result.verify === 'function' && !result.verify()) return { ok: false, reason: 'reverted' };
  return result;
}
