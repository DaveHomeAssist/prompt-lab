/*
  Shared runtime for the Prompt Lab prototypes (no build step, works from file://).

  - Proto.store   JSON localStorage with try/catch (private windows still work)
  - Proto.theme   light by default, a visible toggle, saved per browser
  - Proto.keys    bring-your-own API keys, kept in this browser only
  - Proto.claude  Messages API from the browser with the caller's key
  - Proto.tabs    bottom-rail panel switching on phones
  - helpers       esc, toast, copy, download, uid, fmtDate
*/
(function () {
  'use strict';

  const PREFIX = 'proto:';

  // ── storage ──────────────────────────────────────────────
  const memory = new Map();
  const store = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(PREFIX + key);
        return raw == null ? (memory.has(key) ? memory.get(key) : fallback) : JSON.parse(raw);
      } catch {
        return memory.has(key) ? memory.get(key) : fallback;
      }
    },
    set(key, value) {
      memory.set(key, value);
      try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      memory.delete(key);
      try { window.localStorage.removeItem(PREFIX + key); } catch { /* storage blocked */ }
    },
  };

  // ── theme ────────────────────────────────────────────────
  const theme = {
    current() { return store.get('theme', 'light') === 'dark' ? 'dark' : 'light'; },
    apply(name) {
      document.documentElement.setAttribute('data-theme', name);
      document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        const dark = name === 'dark';
        btn.textContent = dark ? '☀' : '☾';
        btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
        btn.title = btn.getAttribute('aria-label');
      });
      document.dispatchEvent(new CustomEvent('proto:theme', { detail: name }));
    },
    toggle() {
      const next = theme.current() === 'dark' ? 'light' : 'dark';
      store.set('theme', next);
      theme.apply(next);
    },
  };
  // Apply before first paint (this file loads in <head>).
  document.documentElement.setAttribute('data-theme', theme.current());

  // ── helpers ──────────────────────────────────────────────
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let toastEl = null;
  let toastTimer = 0;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'proto-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function uid(prefix) {
    const rand = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rand;
  }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ── keys ─────────────────────────────────────────────────
  const PROVIDERS = {
    anthropic: { label: 'Anthropic', placeholder: 'sk-ant-…', help: 'console.anthropic.com → API keys' },
    openai: { label: 'OpenAI', placeholder: 'sk-…', help: 'platform.openai.com → API keys' },
    gemini: { label: 'Google Gemini', placeholder: 'AIza…', help: 'aistudio.google.com → Get API key' },
  };
  const sessionKeys = new Map();

  const keys = {
    providers: PROVIDERS,
    get(provider) {
      return sessionKeys.get(provider) || store.get('key:' + provider, '') || '';
    },
    has(provider) { return Boolean(keys.get(provider)); },
    set(provider, value, remember) {
      const v = String(value || '').trim();
      if (!v) {
        sessionKeys.delete(provider);
        store.remove('key:' + provider);
      } else if (remember) {
        sessionKeys.delete(provider);
        store.set('key:' + provider, v);
      } else {
        sessionKeys.set(provider, v);
        store.remove('key:' + provider);
      }
      keys.refreshStatus();
      document.dispatchEvent(new CustomEvent('proto:keys'));
    },
    refreshStatus() {
      document.querySelectorAll('[data-key-status]').forEach((el) => {
        const wanted = (el.getAttribute('data-key-status') || 'anthropic').split(',');
        const ok = wanted.every((p) => keys.has(p));
        el.className = 'chip ' + (ok ? 'ok' : 'warn');
        el.textContent = ok ? 'Key set' : 'No key';
      });
    },
    mount(providerList) {
      const list = (providerList && providerList.length ? providerList : ['anthropic']).filter((p) => PROVIDERS[p]);
      const dlg = document.createElement('dialog');
      dlg.className = 'proto-dialog';
      dlg.setAttribute('aria-labelledby', 'proto-keys-title');
      dlg.innerHTML = `
        <form method="dialog">
          <div class="dlg-head"><h2 id="proto-keys-title">API keys</h2>
            <button class="btn ghost icon" value="cancel" aria-label="Close">✕</button></div>
          <div class="dlg-body">
            <p class="hint">Keys stay in this browser and go only to the provider you call. Shared by every prototype in this folder.</p>
            ${list.map((p) => `
              <div class="field">
                <label class="label" for="proto-key-${p}">${esc(PROVIDERS[p].label)}</label>
                <div class="key-input">
                  <input class="input mono" id="proto-key-${p}" data-key-field="${p}" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(PROVIDERS[p].placeholder)}">
                  <button type="button" class="btn sm" data-key-reveal="${p}" aria-label="Show ${esc(PROVIDERS[p].label)} key">Show</button>
                </div>
                <p class="hint">${esc(PROVIDERS[p].help)}</p>
              </div>`).join('')}
            <label class="row" style="gap:8px"><input type="checkbox" data-key-remember checked> Remember on this device</label>
          </div>
          <div class="dlg-foot">
            <button type="button" class="btn danger" data-key-clear>Clear all</button>
            <span class="spacer"></span>
            <button class="btn" value="cancel">Cancel</button>
            <button class="btn primary" value="save" data-key-save>Save</button>
          </div>
        </form>`;
      document.body.appendChild(dlg);

      const remember = dlg.querySelector('[data-key-remember]');
      dlg.querySelectorAll('[data-key-reveal]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const input = dlg.querySelector(`[data-key-field="${btn.dataset.keyReveal}"]`);
          const show = input.type === 'password';
          input.type = show ? 'text' : 'password';
          btn.textContent = show ? 'Hide' : 'Show';
        });
      });
      dlg.querySelector('[data-key-clear]').addEventListener('click', () => {
        list.forEach((p) => keys.set(p, '', true));
        dlg.querySelectorAll('[data-key-field]').forEach((i) => { i.value = ''; });
        toast('Keys cleared from this browser.');
      });
      dlg.addEventListener('close', () => {
        if (dlg.returnValue !== 'save') return;
        dlg.querySelectorAll('[data-key-field]').forEach((input) => keys.set(input.dataset.keyField, input.value, remember.checked));
        toast('Keys saved.');
      });

      keys.open = () => {
        dlg.querySelectorAll('[data-key-field]').forEach((input) => {
          input.value = keys.get(input.dataset.keyField);
          input.type = 'password';
        });
        dlg.querySelectorAll('[data-key-reveal]').forEach((b) => { b.textContent = 'Show'; });
        remember.checked = list.every((p) => !sessionKeys.has(p));
        dlg.showModal();
        const first = list.find((p) => !keys.has(p)) || list[0];
        const input = dlg.querySelector(`[data-key-field="${first}"]`);
        if (input) input.focus();
      };
      document.querySelectorAll('[data-keys-open]').forEach((btn) => btn.addEventListener('click', () => keys.open()));
      keys.refreshStatus();
    },
    open() { /* replaced by mount() */ },
  };

  // ── Claude (Messages API, browser, caller's key) ─────────
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2026-10-21';
  const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
  const MODELS = [
    { id: 'claude-opus-5-5', label: 'Opus 5.5', fallback: true },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', fallback: true },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5', fallback: false },
    { id: 'claude-fable-5-2', label: 'Fable 5.2', fallback: true },
  ];

  class ProtoError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  function statusMessage(status, data) {
    const apiMsg = data && data.error && data.error.message ? data.error.message : '';
    if (status === 401) return 'Anthropic rejected the API key. Check it in API keys.';
    if (status === 403) return 'This key is not allowed to use that model.' + (apiMsg ? ' ' + apiMsg : '');
    if (status === 404) return 'Model not found for this key.' + (apiMsg ? ' ' + apiMsg : '');
    if (status === 413) return 'The request is too large.';
    if (status === 429) return 'Rate limited. Wait a moment and try again.';
    if (status === 529) return 'Anthropic is overloaded right now. Try again shortly.';
    if (status >= 500) return 'Anthropic had a server error (' + status + '). Try again.';
    return apiMsg || ('Request failed (' + status + ').');
  }

  const claude = {
    models: MODELS,
    defaultModel: MODELS[0].id,
    async send(opts) {
      const apiKey = keys.get('anthropic');
      if (!apiKey) throw new ProtoError('Add your Anthropic API key first.', 'no-key');
      const model = MODELS.find((m) => m.id === opts.model) || MODELS[0];
      const body = {
        model: model.id,
        max_tokens: opts.maxTokens || 16000,
        messages: opts.messages,
      };
      if (opts.system) body.system = opts.system;
      const outputConfig = {};
      if (opts.effort) outputConfig.effort = opts.effort;
      if (opts.schema) outputConfig.format = { type: 'json_schema', schema: opts.schema };
      if (Object.keys(outputConfig).length) body.output_config = outputConfig;

      const headers = {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      };
      if (model.fallback) {
        body.fallbacks = 'default';
        headers['anthropic-beta'] = FALLBACK_BETA;
      }

      let res;
      try {
        res = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        throw new ProtoError('Could not reach api.anthropic.com. Check your connection.', 'network');
      }
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) throw new ProtoError(statusMessage(res.status, data), 'http-' + res.status);
      if (!data) throw new ProtoError('Anthropic returned an unreadable response.', 'parse');

      if (data.stop_reason === 'refusal') {
        const cat = data.stop_details && data.stop_details.category;
        throw new ProtoError('Claude declined this request' + (cat ? ' (' + cat + ')' : '') + '.', 'refusal');
      }
      const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      let json;
      if (opts.schema) {
        if (data.stop_reason === 'max_tokens') throw new ProtoError('The reply was cut off before it finished. Try again.', 'max-tokens');
        try { json = JSON.parse(text); } catch { throw new ProtoError('Claude returned malformed JSON. Try again.', 'parse'); }
      }
      return { text, json, model: data.model, stopReason: data.stop_reason, usage: data.usage || {} };
    },
  };

  // ── mobile tabs ──────────────────────────────────────────
  const tabs = {
    show(name) {
      document.querySelectorAll('.proto-main > [data-panel]').forEach((p) => p.classList.toggle('is-active', p.dataset.panel === name));
      document.querySelectorAll('.proto-rail [data-tab], .proto-tabs [data-tab]').forEach((b) => {
        if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
        else b.removeAttribute('aria-current');
      });
      document.dispatchEvent(new CustomEvent('proto:tab', { detail: name }));
    },
    init(defaultName) {
      document.querySelectorAll('.proto-rail [data-tab], .proto-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => tabs.show(b.dataset.tab)));
      const first = defaultName || (document.querySelector('.proto-main > [data-panel]') || {}).dataset?.panel;
      if (first) tabs.show(first);
    },
  };

  function boot() {
    theme.apply(theme.current());
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => btn.addEventListener('click', theme.toggle));
    keys.refreshStatus();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.Proto = { store, theme, keys, claude, tabs, esc, toast, copy, download, uid, fmtDate, ProtoError };
})();
