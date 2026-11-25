import { afterEach, describe, expect, it } from 'vitest';
import { ALL_TAGS, DEFAULT_ENHANCE_TEMPERATURE } from '../constants.js';
import { buildGenerationSystemPrompt, resolveGenerationOptions } from '../lib/generationOptions.js';
import { mountAcceptCard } from '../lib/highlight/acceptCard.js';
import { cancelHighlight } from '../lib/highlight/cancelHighlight.js';
import { captureSelectionFromClipboard, pasteEnhancedAndRestore } from '../lib/highlight/clipboardEnhance.js';
import { buildHighlightPayload, enhanceHighlightText, readEnhancedText } from '../lib/highlight/enhancePayload.js';
import { PROSE_KEPT_CASES, SECRET_REDACTION_CASES } from '../__tests__/secretRedactionCases.js';
import { captureSelection, confirmReplace, replaceTextControl } from '../lib/highlight/selectionReplace.js';
import { enhanceDecision, secretFieldRefusal } from '../../extension/lib/highlightField.js';
import { applyHighlightDraft } from '../lib/highlight/sendToWrite.js';
import {
  defaultHighlightAccelerator,
  parseHighlightAccelerator,
  readHighlightSettings,
  writeHighlightSettings,
} from '../lib/highlight/shortcutSettings.js';

function installSetRangeText(prototype) {
  if (typeof prototype.setRangeText === 'function') return;
  prototype.setRangeText = function setRangeText(replacement, start, end) {
    const value = String(this.value);
    const next = String(replacement);
    this.value = value.slice(0, start) + next + value.slice(end);
    const cursor = start + next.length;
    this.selectionStart = cursor;
    this.selectionEnd = cursor;
  };
}

installSetRangeText(HTMLTextAreaElement.prototype);
installSetRangeText(HTMLInputElement.prototype);

function selectText(node, start, end) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = document.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  document.body.innerHTML = '';
  document.querySelectorAll('[data-prompt-lab-highlight]').forEach((node) => node.remove());
});

describe('selection capture and replace', () => {
  it('replaces a textarea through execCommand so the browser can undo it', () => {
    const field = document.createElement('textarea');
    field.value = 'hello world';
    document.body.append(field);
    field.focus();
    field.setSelectionRange(0, 5);
    const original = document.execCommand?.bind(document);
    document.execCommand = (command, _ui, value) => {
      if (command !== 'insertText') return false;
      const start = field.selectionStart;
      const end = field.selectionEnd;
      field.value = field.value.slice(0, start) + value + field.value.slice(end);
      return true;
    };
    const events = [];
    field.addEventListener('input', (event) => events.push(event.inputType));
    try {
      const result = replaceTextControl(field, 'HELLO', 0, 5);
      expect(result).toMatchObject({ ok: true, method: 'execCommand' });
      expect(field.value).toBe('HELLO world');
      expect(events).toEqual(['insertReplacementText']);
    } finally {
      document.execCommand = original;
    }
  });

  it('falls back to setRangeText only when execCommand returns false', () => {
    const field = document.createElement('textarea');
    field.value = 'hello world';
    document.body.append(field);
    field.focus();
    field.setSelectionRange(0, 5);
    const original = document.execCommand?.bind(document);
    document.execCommand = () => false;
    try {
      const result = replaceTextControl(field, 'HELLO', 0, 5);
      expect(result).toMatchObject({ ok: true, method: 'setRangeText' });
      expect(field.value).toBe('HELLO world');
    } finally {
      document.execCommand = original;
    }
  });

  it('replaces an input selection and refuses a password field', () => {
    const field = document.createElement('input');
    field.value = 'hello world';
    document.body.append(field);
    field.focus();
    field.setSelectionRange(6, 11);
    const captured = captureSelection(document);
    expect(captured.kind).toBe('input');
    expect(captured.replace('WORLD')).toMatchObject({ ok: true });
    expect(field.value).toBe('hello WORLD');

    const secret = document.createElement('input');
    secret.type = 'password';
    secret.value = 'hunter2';
    document.body.append(secret);
    secret.focus();
    secret.setSelectionRange(0, 7);
    expect(captureSelection(document)).toMatchObject({ blocked: 'password' });
    expect(secret.value).toBe('hunter2');
  });

  it('replaces a contenteditable selection when the editor handles beforeinput', () => {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    host.textContent = 'hello world';
    host.addEventListener('beforeinput', (event) => {
      if (event.inputType !== 'insertText' && event.inputType !== 'insertReplacementText') return;
      event.preventDefault();
      const range = document.getSelection().getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(event.data || ''));
    });
    document.body.append(host);
    selectText(host.firstChild, 0, 5);
    const captured = captureSelection(document);
    expect(captured.kind).toBe('contenteditable');
    expect(captured.text).toBe('hello');
    expect(captured.replace('HELLO').ok).toBe(true);
    expect(host.textContent).toBe('HELLO world');
  });

  it('reports an unverified contenteditable edit instead of leaving a partial change', async () => {
    const host = document.createElement('div');
    host.contentEditable = 'true';
    host.textContent = 'stay put';
    host.addEventListener('beforeinput', (event) => event.preventDefault());
    host.addEventListener('input', () => { host.textContent = 'stay put'; });
    document.body.append(host);
    selectText(host.firstChild, 0, 4);
    const captured = captureSelection(document);
    const result = await confirmReplace(captured.replace, 'GONE', async () => {});
    expect(result.ok).toBe(false);
    expect(host.textContent).toBe('stay put');
  });
});

describe('fail closed when the field cannot be classified', () => {
  it('refuses password fields, secret autocomplete, and a password shadow host', () => {
    const password = document.createElement('input');
    password.type = 'password';
    expect(secretFieldRefusal(password)?.blocked).toBe('password');

    const current = document.createElement('input');
    current.setAttribute('autocomplete', 'section-login current-password');
    expect(secretFieldRefusal(current)?.blocked).toBe('secret');

    const otp = document.createElement('input');
    otp.setAttribute('autocomplete', 'one-time-code');
    expect(secretFieldRefusal(otp)?.blocked).toBe('secret');

    const host = {
      tagName: 'INPUT',
      getAttribute: (name) => (name === 'type' ? 'password' : null),
      parentElement: null,
      getRootNode: () => ({}),
    };
    const inner = {
      tagName: 'SPAN',
      getAttribute: () => null,
      parentElement: null,
      getRootNode: () => ({ host }),
    };
    expect(secretFieldRefusal(inner)?.blocked).toBe('password');

    const field = document.createElement('input');
    field.type = 'password';
    field.value = 'secret';
    document.body.append(field);
    field.focus();
    expect(captureSelection(document)?.blocked).toBe('password');
    expect(field.value).toBe('secret');
  });

  it('does not send browser selection text when the field was not classified', () => {
    expect(enhanceDecision({ ok: false, reason: 'unclassified', fallback: 'secret from the menu' })).toMatchObject({
      proceed: false,
    });
    expect(enhanceDecision({ ok: false, reason: 'frame', message: 'frame blocked', fallback: 'hidden' }).proceed).toBe(false);
    expect(enhanceDecision({ ok: false, reason: 'password', message: 'Password fields are left alone. Nothing was sent.' }).proceed).toBe(false);
    expect(enhanceDecision({ ok: true, kind: 'selection', text: 'loose selection' }).proceed).toBe(false);
    expect(enhanceDecision({ ok: true, kind: 'textarea', text: 'hello' })).toEqual({ proceed: true, text: 'hello' });
    expect(enhanceDecision({ ok: true, kind: 'contenteditable', text: 'hello' }).proceed).toBe(true);
    const refused = enhanceDecision({ ok: false, fallback: 'must not be used' });
    expect(refused.proceed).toBe(false);
    expect(JSON.stringify(refused)).not.toContain('must not be used');
  });
});

describe('desktop clipboard save and restore', () => {
  function memoryClipboard(initial) {
    const state = { value: initial };
    return {
      state,
      read: async () => state.value,
      write: async (text) => { state.value = text; },
    };
  }

  it('restores the original clipboard when the copy does not land', async () => {
    const clip = memoryClipboard('keep me');
    const result = await captureSelectionFromClipboard({
      ...clip,
      copy: async () => {},
      wait: async () => {},
      nonce: '7',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('copy-failed');
    expect(clip.state.value).toBe('keep me');
    expect(result.message).not.toContain('promptlab-7');
  });

  it('returns the copied selection and restores the original immediately', async () => {
    const clip = memoryClipboard('original');
    const result = await captureSelectionFromClipboard({
      ...clip,
      copy: async () => { clip.state.value = 'selected text'; },
      wait: async () => {},
      nonce: '1',
    });
    expect(result).toMatchObject({ ok: true, original: 'original', selected: 'selected text' });
    expect(clip.state.value).toBe('original');
  });

  it('pastes the enhanced text and then restores the clipboard', async () => {
    const clip = memoryClipboard('original');
    let pasted = '';
    const result = await pasteEnhancedAndRestore({
      ...clip,
      enhanced: 'enhanced',
      paste: async () => { pasted = clip.state.value; },
      wait: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(pasted).toBe('enhanced');
    expect(clip.state.value).toBe('original');
  });

  it('restores the clipboard when the paste fails', async () => {
    const clip = memoryClipboard('original');
    const result = await pasteEnhancedAndRestore({
      ...clip,
      enhanced: 'enhanced',
      paste: async () => { throw new Error('paste failed'); },
      wait: async () => {},
    });
    expect(result).toMatchObject({ ok: false, code: 'paste-failed' });
    expect(clip.state.value).toBe('original');
  });
});

describe('highlight enhance payload', () => {
  it('uses the same system prompt, temperature, and parser as Create', () => {
    const generation = resolveGenerationOptions('refined', { strategy: 'expanded', task: 'general', target: 'general' });
    const payload = buildHighlightPayload('Make it clearer', generation, { provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(payload.temperature).toBe(DEFAULT_ENHANCE_TEMPERATURE);
    expect(payload.system).toBe(buildGenerationSystemPrompt(generation, ALL_TAGS));
    expect(payload.messages).toEqual([{ role: 'user', content: 'Make it clearer' }]);
    expect(readEnhancedText(JSON.stringify({ schema_version: 2, primary_id: 'refined', enhanced: 'Clearer prompt' }))).toBe('Clearer prompt');
  });

  it('does not call the provider when the selection contains sensitive data', async () => {
    let called = false;
    const result = await enhanceHighlightText('mail ada@example.com about the plan', {
      route: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      call: () => { called = true; },
    });
    expect(called).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'sensitive' });
  });

  it.each(SECRET_REDACTION_CASES)('does not send %s', async (_name, input, _expected, secret) => {
    const calls = [];
    const result = await enhanceHighlightText(input, {
      route: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      call: async (payload) => {
        calls.push(payload);
        return { content: [{ text: JSON.stringify({ schema_version: 2, primary_id: 'refined', enhanced: 'Clearer wording' }) }] };
      },
    });
    expect(result).toMatchObject({ ok: false, code: 'sensitive' });
    expect(calls).toEqual([]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it.each(PROSE_KEPT_CASES)('still sends ordinary prose: %s', async (text) => {
    const calls = [];
    const result = await enhanceHighlightText(text, {
      route: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      call: async (payload) => {
        calls.push(payload.messages[0].content);
        return { content: [{ text: JSON.stringify({ schema_version: 2, primary_id: 'refined', enhanced: 'Clearer wording' }) }] };
      },
    });
    expect(result).toMatchObject({ ok: true, enhanced: 'Clearer wording' });
    expect(calls).toEqual([text]);
  });
});

describe('highlight settings and Write handoff', () => {
  it('parses the desktop shortcut and can turn it off', () => {
    expect(defaultHighlightAccelerator(true)).toBe('alt+command+E');
    expect(defaultHighlightAccelerator(false)).toBe('alt+control+E');
    expect(parseHighlightAccelerator('Alt+Command+E', { mac: true }).accelerator).toBe('alt+command+E');
    expect(parseHighlightAccelerator('Ctrl+Alt+E', { mac: false }).accelerator).toBe('alt+control+E');
    expect(parseHighlightAccelerator('E').ok).toBe(false);
    const storage = { value: '', getItem: () => storage.value, setItem: (_key, value) => { storage.value = value; } };
    expect(writeHighlightSettings({ enabled: false, accelerator: 'Ctrl+Alt+E' }, storage).value.enabled).toBe(false);
    expect(readHighlightSettings(storage, false).enabled).toBe(false);
  });

  it('loads a selection into Write', () => {
    const actions = { opened: false, cleared: false, raw: '', notice: '', openWrite() { this.opened = true; }, clearEditor() { this.cleared = true; }, setRaw(text) { this.raw = text; }, notify(message) { this.notice = message; } };
    expect(applyHighlightDraft({ text: '  ' }, actions)).toBe(false);
    expect(applyHighlightDraft({ text: 'Selected line', notice: 'Selection loaded in Write' }, actions)).toBe(true);
    expect(actions).toMatchObject({ opened: true, cleared: true, raw: 'Selected line', notice: 'Selection loaded in Write' });
  });
});

describe('desktop cancel', () => {
  it('aborts the controller and still closes the native session', () => {
    const controller = new AbortController();
    let nativeCalls = 0;
    cancelHighlight(controller, () => { nativeCalls += 1; });
    expect(controller.signal.aborted).toBe(true);
    expect(nativeCalls).toBe(1);
  });

  it('still closes the native session when abort is called on the signal', () => {
    const signal = new AbortController().signal;
    let nativeCalls = 0;
    cancelHighlight(signal, () => { nativeCalls += 1; });
    expect(signal.aborted).toBe(false);
    expect(nativeCalls).toBe(1);
  });
});

describe('accept card', () => {
  it('accepts with Enter, cancels with Esc, and keeps page CSS out of the shadow tree', async () => {
    document.body.style.color = 'rgb(1, 2, 3)';
    let accepted = '';
    let cancelled = false;
    const card = mountAcceptCard(document, {
      theme: 'dark',
      anchor: { left: 12, top: 20, bottom: 48, width: 80, height: 28 },
      onAccept: async (text) => { accepted = text; return { ok: true, message: 'Replaced the selection.' }; },
      onCancel: () => { cancelled = true; },
    });
    card.showResult({ originalText: 'hello', enhancedText: 'Hello there' });
    expect(card.query('style').textContent).toContain('#101018');
    expect(card.query('pre').textContent).toBe('hello');
    expect(card.host.shadowRoot).toBeNull();
    card.query('.card').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await Promise.resolve();
    expect(accepted).toBe('Hello there');

    const light = mountAcceptCard(document, {
      theme: 'light',
      onCancel: () => { cancelled = true; },
    });
    light.showResult({ originalText: 'x', enhancedText: 'y' });
    expect(light.query('style').textContent).toContain('#ffffff');
    light.query('.card').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(cancelled).toBe(true);
    expect(document.querySelectorAll('[data-prompt-lab-highlight]')).toHaveLength(0);
  });
});
