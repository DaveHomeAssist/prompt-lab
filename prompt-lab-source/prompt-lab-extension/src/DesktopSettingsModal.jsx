import { useEffect, useMemo, useState } from 'react';
import Ic from './icons';
import { DEFAULTS } from './lib/providerRegistry.js';
import {
  isExtension,
  listOllamaModels,
  loadProviderSettings,
  saveProviderSettings,
  testProviderConnection,
} from './lib/platform.js';

const IS_WEB = typeof import.meta !== 'undefined'
  && import.meta.env?.VITE_WEB_MODE === 'true';

const DEFAULT_SETTINGS = {
  provider: 'anthropic',
  apiKey: '',
  anthropicModel: DEFAULTS.anthropicModel,
  openaiApiKey: '',
  openaiModel: DEFAULTS.openaiModel,
  geminiApiKey: '',
  geminiModel: DEFAULTS.geminiModel,
  openrouterApiKey: '',
  openrouterModel: DEFAULTS.openrouterModel,
  ollamaBaseUrl: DEFAULTS.ollamaBaseUrl,
  ollamaModel: DEFAULTS.ollamaModel,
};

export default function DesktopSettingsModal({ show, onClose, m, notify }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollama, setOllama] = useState({ message: '', tone: 'neutral' });
  const [connection, setConnection] = useState({ message: '', tone: 'neutral' });
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const inputClass = `w-full px-3 py-2 rounded-lg border text-sm ${m.input} ${m.border} ${m.text}`;
  const buttonClass = `px-4 py-2 rounded-lg text-sm font-medium ${m.btn} ${m.textAlt}`;
  const readOnlyInputClass = `${inputClass} cursor-not-allowed opacity-70`;
  const isHostedWeb = !isExtension && IS_WEB;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setConnection({ message: '', tone: 'neutral' });
    setOllama({ message: '', tone: 'neutral' });
    setOllamaModels([]);
    loadProviderSettings()
      .then((stored) => {
        if (!cancelled) {
          const nextSettings = {
            ...DEFAULT_SETTINGS,
            ...(stored && typeof stored === 'object' ? stored : {}),
          };
          if (isHostedWeb) {
            nextSettings.provider = 'anthropic';
            nextSettings.anthropicModel = nextSettings.anthropicModel || DEFAULT_SETTINGS.anthropicModel;
          }
          setSettings(nextSettings);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSettings(isHostedWeb ? { ...DEFAULT_SETTINGS, provider: 'anthropic' } : DEFAULT_SETTINGS);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isHostedWeb, show]);

  useEffect(() => {
    if (connection.tone !== 'success') return;
    const t = setTimeout(() => setConnection({ message: '', tone: 'neutral' }), 3000);
    return () => clearTimeout(t);
  }, [connection]);

  useEffect(() => {
    if (ollama.tone !== 'success') return;
    const t = setTimeout(() => setOllama({ message: '', tone: 'neutral' }), 3000);
    return () => clearTimeout(t);
  }, [ollama]);

  const currentModel = useMemo(() => {
    switch (settings.provider) {
      case 'openai':
        return settings.openaiModel || DEFAULT_SETTINGS.openaiModel;
      case 'gemini':
        return settings.geminiModel || DEFAULT_SETTINGS.geminiModel;
      case 'openrouter':
        return settings.openrouterModel || DEFAULT_SETTINGS.openrouterModel;
      case 'ollama':
        return settings.ollamaModel || DEFAULT_SETTINGS.ollamaModel;
      case 'anthropic':
      default:
        return settings.anthropicModel || DEFAULT_SETTINGS.anthropicModel;
    }
  }, [settings]);

  if (isExtension || !show) return null;

  function updateSetting(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    try {
      await saveProviderSettings(settings);
      setConnection({ message: 'Settings saved.', tone: 'success' });
      notify?.('Provider settings saved');
    } catch (error) {
      setConnection({ message: error?.message || 'Failed to save settings.', tone: 'error' });
    }
  }

  async function handleRefreshModels() {
    setIsRefreshingModels(true);
    setOllama({ message: '', tone: 'neutral' });
    try {
      const models = await listOllamaModels(settings.ollamaBaseUrl || DEFAULT_SETTINGS.ollamaBaseUrl);
      setOllamaModels(models);
      const modelNames = models.map((model) => model.name);
      if (modelNames.length > 0 && !modelNames.includes(settings.ollamaModel)) {
        updateSetting('ollamaModel', modelNames[0]);
      }
      setOllama({ message: `${modelNames.length} model${modelNames.length === 1 ? '' : 's'} found`, tone: 'success' });
    } catch (error) {
      setOllamaModels([]);
      setOllama({ message: error?.message || 'Failed to load models', tone: 'error' });
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function handleTestConnection() {
    setIsTestingConnection(true);
    setConnection({ message: '', tone: 'neutral' });
    try {
      await testProviderConnection({
        model: currentModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      }, settings);
      setConnection({ message: 'Connected!', tone: 'success' });
    } catch (error) {
      setConnection({ message: error?.message || 'Connection failed.', tone: 'error' });
    } finally {
      setIsTestingConnection(false);
    }
  }

  const statusClass = connection.tone === 'success'
    ? 'text-emerald-400'
    : connection.tone === 'error'
      ? 'text-red-400'
      : m.textMuted;

  const ollamaStatusClass = ollama.tone === 'success'
    ? 'text-emerald-400'
    : ollama.tone === 'error'
      ? 'text-red-400'
      : m.textMuted;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-md rounded-2xl border p-5 shadow-2xl ${m.bg} ${m.border} ${m.text}`}
        onClick={event => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className={`text-base font-semibold ${m.text}`}>Provider Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-lg p-2 ${m.btn} ${m.textAlt}`}
            aria-label="Close provider settings"
          >
            <Ic n="X" size={15} />
          </button>
        </div>

        <div className="space-y-4">
          {isHostedWeb ? (
            <>
              <div className={`space-y-2 rounded-xl border p-3 ${m.border} ${m.btn}`}>
                <p className={`text-sm font-semibold ${m.text}`}>Hosted access</p>
                <p className={`text-xs ${m.textMuted}`}>
                  Hosted Prompt Lab is currently locked to Anthropic. The shared hosted key is used
                  automatically when you leave the personal key field blank.
                </p>
              </div>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Provider</span>
                <input
                  type="text"
                  value="Anthropic (hosted default)"
                  readOnly
                  disabled
                  className={readOnlyInputClass}
                />
              </label>
            </>
          ) : (
            <label className="block space-y-1">
              <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Provider</span>
              <select
                value={settings.provider}
                onChange={event => updateSetting('provider', event.target.value)}
                className={inputClass}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </label>
          )}

          {settings.provider === 'anthropic' && (
            <>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>
                  {isHostedWeb ? 'Personal API Key (optional)' : 'API Key'}
                </span>
                <input
                  type="password"
                  placeholder={isHostedWeb ? 'Optional personal override' : 'sk-ant-...'}
                  value={settings.apiKey}
                  onChange={event => updateSetting('apiKey', event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Model</span>
                <input
                  type="text"
                  value={settings.anthropicModel}
                  onChange={event => updateSetting('anthropicModel', event.target.value)}
                  readOnly={isHostedWeb}
                  disabled={isHostedWeb}
                  className={isHostedWeb ? readOnlyInputClass : inputClass}
                />
              </label>
              {isHostedWeb && (
                <p className={`text-xs ${m.textMuted}`}>
                  Hosted mode keeps Anthropic fixed for now so shared usage stays predictable.
                </p>
              )}
            </>
          )}

          {!isHostedWeb && settings.provider === 'openai' && (
            <>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>API Key</span>
                <input
                  type="password"
                  value={settings.openaiApiKey}
                  onChange={event => updateSetting('openaiApiKey', event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Model</span>
                <input
                  type="text"
                  value={settings.openaiModel}
                  onChange={event => updateSetting('openaiModel', event.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {!isHostedWeb && settings.provider === 'gemini' && (
            <>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>API Key</span>
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={event => updateSetting('geminiApiKey', event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Model</span>
                <input
                  type="text"
                  value={settings.geminiModel}
                  onChange={event => updateSetting('geminiModel', event.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {!isHostedWeb && settings.provider === 'openrouter' && (
            <>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>API Key</span>
                <input
                  type="password"
                  value={settings.openrouterApiKey}
                  onChange={event => updateSetting('openrouterApiKey', event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Model</span>
                <input
                  type="text"
                  value={settings.openrouterModel}
                  onChange={event => updateSetting('openrouterModel', event.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}

          {!isHostedWeb && settings.provider === 'ollama' && (
            <>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Base URL</span>
                <input
                  type="text"
                  value={settings.ollamaBaseUrl}
                  onChange={event => updateSetting('ollamaBaseUrl', event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block space-y-1">
                <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Model</span>
                <input
                  type="text"
                  value={settings.ollamaModel}
                  onChange={event => updateSetting('ollamaModel', event.target.value)}
                  className={inputClass}
                />
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshModels}
                  disabled={isRefreshingModels}
                  className={`${buttonClass} shrink-0`}
                >
                  {isRefreshingModels ? 'Refreshing...' : 'Refresh Models'}
                </button>
                <span className={`text-xs ${ollamaStatusClass}`}>{ollama.message || 'Load available local models'}</span>
              </div>
              {ollamaModels.length > 0 && (
                <label className="block space-y-1">
                  <span className={`text-xs font-medium uppercase tracking-wide ${m.textMuted}`}>Available Models</span>
                  <select
                    value={settings.ollamaModel}
                    onChange={event => updateSetting('ollamaModel', event.target.value)}
                    className={inputClass}
                  >
                    {ollamaModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.paramSize ? `${model.name} (${model.paramSize})` : model.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}

          <div className={`space-y-3 border-t ${m.border} pt-4`}>
            {connection.message && <p className={`text-sm ${statusClass}`}>{connection.message}</p>}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTestingConnection}
                className={buttonClass}
              >
                {isTestingConnection ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
