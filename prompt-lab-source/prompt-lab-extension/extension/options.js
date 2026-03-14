import { DEFAULTS, PROVIDER_SETTINGS_KEYS, VALID_PROVIDERS } from './lib/providerRegistry.js';

const els = {
  // Provider chips
  chips: document.querySelectorAll('.provider-chip'),
  // Sections
  anthropicSection: document.getElementById('anthropicSection'),
  openaiSection: document.getElementById('openaiSection'),
  geminiSection: document.getElementById('geminiSection'),
  openrouterSection: document.getElementById('openrouterSection'),
  ollamaSection: document.getElementById('ollamaSection'),
  // Anthropic
  anthropicKey: document.getElementById('anthropicKey'),
  anthropicModel: document.getElementById('anthropicModel'),
  // OpenAI
  openaiKey: document.getElementById('openaiKey'),
  openaiModel: document.getElementById('openaiModel'),
  // Gemini
  geminiKey: document.getElementById('geminiKey'),
  geminiModel: document.getElementById('geminiModel'),
  // OpenRouter
  openrouterKey: document.getElementById('openrouterKey'),
  openrouterModel: document.getElementById('openrouterModel'),
  // Ollama
  ollamaBaseUrl: document.getElementById('ollamaBaseUrl'),
  ollamaModel: document.getElementById('ollamaModel'),
  ollamaModelManual: document.getElementById('ollamaModelManual'),
  ollamaRefreshBtn: document.getElementById('ollamaRefreshBtn'),
  ollamaStatus: document.getElementById('ollamaStatus'),
  // Buttons & status
  saveBtn: document.getElementById('saveBtn'),
  testBtn: document.getElementById('testBtn'),
  status: document.getElementById('status'),
};

let currentProvider = DEFAULTS.provider;
let storedKeys = { apiKey: '', openaiApiKey: '', geminiApiKey: '', openrouterApiKey: '' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeProvider(p) { return VALID_PROVIDERS.includes(p) ? p : DEFAULTS.provider; }
function normalizeUrl(url, fallback) { return (url || fallback).trim().replace(/\/+$/, ''); }

function setStatus(message, type = 'ok') {
  els.status.textContent = message;
  els.status.className = `status ${type}`;
}

function clearStatus() {
  els.status.textContent = '';
  els.status.className = 'status';
}

// ── Ollama model discovery ───────────────────────────────────────────────────

function getOllamaBaseUrl() {
  return normalizeUrl(els.ollamaBaseUrl.value, DEFAULTS.ollamaBaseUrl);
}

function getOllamaModelValue() {
  // Manual input takes priority; fall back to dropdown selection
  const manual = (els.ollamaModelManual.value || '').trim();
  if (manual) return manual;
  return els.ollamaModel.value || DEFAULTS.ollamaModel;
}

function setOllamaStatus(text, type = '') {
  els.ollamaStatus.textContent = text;
  els.ollamaStatus.style.color = type === 'ok' ? 'var(--green)' : type === 'err' ? 'var(--red)' : 'var(--text-muted)';
}

function fetchOllamaModels(selectModel) {
  const baseUrl = getOllamaBaseUrl();
  setOllamaStatus('checking…');
  els.ollamaRefreshBtn.disabled = true;

  chrome.runtime.sendMessage(
    { type: 'OLLAMA_LIST_MODELS', baseUrl },
    (resp) => {
      els.ollamaRefreshBtn.disabled = false;

      if (chrome.runtime.lastError || resp?.error) {
        const errMsg = resp?.error || chrome.runtime.lastError?.message || 'Cannot reach Ollama';
        setOllamaStatus('offline', 'err');
        els.ollamaModel.innerHTML = '<option value="">— Ollama not reachable —</option>';
        setStatus(`Ollama: ${errMsg}`, 'err');
        return;
      }

      const models = resp.models || [];
      if (models.length === 0) {
        setOllamaStatus('no models', 'err');
        els.ollamaModel.innerHTML = '<option value="">— no models installed —</option>';
        return;
      }

      setOllamaStatus(`${models.length} model${models.length > 1 ? 's' : ''}`, 'ok');

      // Build dropdown options
      els.ollamaModel.innerHTML = models.map(m => {
        const sizeLabel = m.paramSize ? ` (${m.paramSize})` : '';
        return `<option value="${m.name}">${m.name}${sizeLabel}</option>`;
      }).join('');

      // Select the right model
      const target = selectModel || DEFAULTS.ollamaModel;
      const found = models.some(m => m.name === target);
      if (found) {
        els.ollamaModel.value = target;
      }
      // Clear manual input if dropdown has the model
      if (found && els.ollamaModelManual.value.trim() === target) {
        els.ollamaModelManual.value = '';
      }
    }
  );
}

function maskKey(key) {
  if (!key) return '';
  const prefix = key.slice(0, Math.min(8, Math.floor(key.length * 0.3)));
  const suffix = key.slice(-4);
  return `${prefix}${'•'.repeat(6)}${suffix}`;
}

// ── Section visibility ───────────────────────────────────────────────────────

const sectionMap = {
  anthropic: 'anthropicSection',
  openai: 'openaiSection',
  gemini: 'geminiSection',
  openrouter: 'openrouterSection',
  ollama: 'ollamaSection',
};

function renderSections() {
  // Hide all sections
  Object.values(sectionMap).forEach(id => els[id].classList.add('hidden'));
  // Show active
  const activeSection = sectionMap[currentProvider];
  if (activeSection) els[activeSection].classList.remove('hidden');
  // Update chips
  els.chips.forEach(chip => {
    chip.classList.toggle('active', chip.dataset.provider === currentProvider);
  });
}

// ── Load settings ────────────────────────────────────────────────────────────

function loadSettings() {
  chrome.storage.local.get(
    PROVIDER_SETTINGS_KEYS,
    (store) => {
      currentProvider = normalizeProvider(store.provider);

      // Stash stored keys so we don't clear them accidentally
      storedKeys.apiKey = store.apiKey || '';
      storedKeys.openaiApiKey = store.openaiApiKey || '';
      storedKeys.geminiApiKey = store.geminiApiKey || '';
      storedKeys.openrouterApiKey = store.openrouterApiKey || '';

      // Anthropic
      if (storedKeys.apiKey) els.anthropicKey.placeholder = maskKey(storedKeys.apiKey);
      if (store.anthropicModel) els.anthropicModel.value = store.anthropicModel;

      // OpenAI
      if (storedKeys.openaiApiKey) els.openaiKey.placeholder = maskKey(storedKeys.openaiApiKey);
      if (store.openaiModel) els.openaiModel.value = store.openaiModel;

      // Gemini
      if (storedKeys.geminiApiKey) els.geminiKey.placeholder = maskKey(storedKeys.geminiApiKey);
      if (store.geminiModel) els.geminiModel.value = store.geminiModel;

      // OpenRouter
      if (storedKeys.openrouterApiKey) els.openrouterKey.placeholder = maskKey(storedKeys.openrouterApiKey);
      els.openrouterModel.value = store.openrouterModel || DEFAULTS.openrouterModel;

      // Ollama
      els.ollamaBaseUrl.value = normalizeUrl(store.ollamaBaseUrl, DEFAULTS.ollamaBaseUrl);
      const savedOllamaModel = (store.ollamaModel || DEFAULTS.ollamaModel).trim();
      // Attempt to fetch models; if offline, fall back to manual input
      fetchOllamaModels(savedOllamaModel);

      renderSections();
    }
  );
}

// ── Save settings ────────────────────────────────────────────────────────────

function saveSettings() {
  clearStatus();
  const next = { provider: currentProvider };

  switch (currentProvider) {
    case 'anthropic': {
      const key = els.anthropicKey.value.trim();
      if (key && !key.startsWith('sk-ant-')) {
        setStatus('Anthropic key should start with sk-ant-.', 'err');
        return;
      }
      if (!key && !storedKeys.apiKey) {
        setStatus('Enter an Anthropic API key.', 'err');
        return;
      }
      if (key) { next.apiKey = key; storedKeys.apiKey = key; }
      next.anthropicModel = els.anthropicModel.value;
      break;
    }
    case 'openai': {
      const key = els.openaiKey.value.trim();
      if (!key && !storedKeys.openaiApiKey) {
        setStatus('Enter an OpenAI API key.', 'err');
        return;
      }
      if (key) { next.openaiApiKey = key; storedKeys.openaiApiKey = key; }
      next.openaiModel = els.openaiModel.value;
      break;
    }
    case 'gemini': {
      const key = els.geminiKey.value.trim();
      if (!key && !storedKeys.geminiApiKey) {
        setStatus('Enter a Gemini API key.', 'err');
        return;
      }
      if (key) { next.geminiApiKey = key; storedKeys.geminiApiKey = key; }
      next.geminiModel = els.geminiModel.value;
      break;
    }
    case 'openrouter': {
      const key = els.openrouterKey.value.trim();
      if (!key && !storedKeys.openrouterApiKey) {
        setStatus('Enter an OpenRouter API key.', 'err');
        return;
      }
      if (key) { next.openrouterApiKey = key; storedKeys.openrouterApiKey = key; }
      const model = els.openrouterModel.value.trim();
      if (!model) {
        setStatus('Enter an OpenRouter model slug.', 'err');
        return;
      }
      next.openrouterModel = model;
      break;
    }
    case 'ollama': {
      const url = normalizeUrl(els.ollamaBaseUrl.value, DEFAULTS.ollamaBaseUrl);
      if (!/^https?:\/\//.test(url)) {
        setStatus('Ollama URL must start with http:// or https://', 'err');
        return;
      }
      const model = getOllamaModelValue();
      if (!model) {
        setStatus('Select or enter an Ollama model.', 'err');
        return;
      }
      next.ollamaBaseUrl = url;
      next.ollamaModel = model;
      break;
    }
  }

  chrome.storage.local.set(next, () => {
    if (chrome.runtime.lastError) {
      setStatus(chrome.runtime.lastError.message || 'Failed to save.', 'err');
      return;
    }
    // Clear password fields and update placeholders
    els.anthropicKey.value = '';
    els.openaiKey.value = '';
    els.geminiKey.value = '';
    els.openrouterKey.value = '';

    if (storedKeys.apiKey) els.anthropicKey.placeholder = maskKey(storedKeys.apiKey);
    if (storedKeys.openaiApiKey) els.openaiKey.placeholder = maskKey(storedKeys.openaiApiKey);
    if (storedKeys.geminiApiKey) els.geminiKey.placeholder = maskKey(storedKeys.geminiApiKey);
    if (storedKeys.openrouterApiKey) els.openrouterKey.placeholder = maskKey(storedKeys.openrouterApiKey);

    setStatus('Saved ✓', 'ok');
  });
}

// ── Test connection ──────────────────────────────────────────────────────────

async function testConnection() {
  setStatus('Testing…', 'warn');

  try {
    const payload = {
      model: getActiveModel(),
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with exactly: ok' }],
    };

    const response = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'MODEL_REQUEST', payload },
        (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!resp) return reject(new Error('No response from background worker.'));
          if (resp.error) return reject(new Error(resp.error));
          resolve(resp.data);
        }
      );
    });

    // Check if we got text back
    const text = extractText(response);
    if (text.toLowerCase().includes('ok')) {
      setStatus(`Connected ✓  (${currentProvider} / ${getActiveModel()})`, 'ok');
    } else {
      setStatus(`Got a response but unexpected content. Provider may be working.`, 'warn');
    }
  } catch (e) {
    setStatus(`Connection failed: ${e.message}`, 'err');
  }
}

function getActiveModel() {
  switch (currentProvider) {
    case 'anthropic': return els.anthropicModel.value;
    case 'openai': return els.openaiModel.value;
    case 'gemini': return els.geminiModel.value;
    case 'openrouter': return els.openrouterModel.value.trim() || DEFAULTS.openrouterModel;
    case 'ollama': return getOllamaModelValue();
    default: return 'claude-sonnet-4-20250514';
  }
}

function extractText(data) {
  if (!data) return '';
  if (Array.isArray(data.content)) {
    return data.content.map(b => b?.text || '').join('');
  }
  if (typeof data.content === 'string') return data.content;
  return '';
}

// ── Events ───────────────────────────────────────────────────────────────────

els.chips.forEach(chip => {
  chip.addEventListener('click', () => {
    currentProvider = normalizeProvider(chip.dataset.provider);
    clearStatus();
    renderSections();
  });
});

els.saveBtn.addEventListener('click', saveSettings);
els.testBtn.addEventListener('click', () => {
  // Save first, then test
  saveSettings();
  // Small delay to let storage write complete
  setTimeout(testConnection, 200);
});

// Ollama: refresh button fetches model list
els.ollamaRefreshBtn.addEventListener('click', () => {
  clearStatus();
  fetchOllamaModels(getOllamaModelValue());
});

// Ollama: re-fetch models when base URL changes (on blur)
els.ollamaBaseUrl.addEventListener('blur', () => {
  if (currentProvider === 'ollama') fetchOllamaModels(getOllamaModelValue());
});

// Ollama: clear manual input when dropdown is used
els.ollamaModel.addEventListener('change', () => {
  els.ollamaModelManual.value = '';
});

loadSettings();
