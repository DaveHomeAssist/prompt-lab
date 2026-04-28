import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadProviderSettings,
  saveProviderSettings,
  listOllamaModels,
  testProviderConnection,
} = vi.hoisted(() => ({
  loadProviderSettings: vi.fn(),
  saveProviderSettings: vi.fn(),
  listOllamaModels: vi.fn(),
  testProviderConnection: vi.fn(),
}));

const theme = {
  input: 'bg-slate-900',
  border: 'border-slate-700',
  text: 'text-white',
  textAlt: 'text-slate-200',
  textMuted: 'text-slate-400',
  btn: 'bg-slate-800',
  bg: 'bg-slate-950',
};

async function renderModal(props = {}) {
  const onClose = vi.fn();
  const notify = vi.fn();
  vi.resetModules();
  delete globalThis.chrome;
  vi.doMock('../lib/platform.js', () => ({
    isExtension: false,
    callModel: async (payload, options) => {
      if (
        typeof globalThis.chrome !== 'undefined' &&
        typeof globalThis.chrome.runtime?.sendMessage === 'function'
      ) {
        return new Promise((resolve, reject) => {
          globalThis.chrome.runtime.sendMessage(
            { type: 'MODEL_REQUEST', payload },
            (response) => {
              if (!response) return reject(new Error('No response from background.'));
              if (response.error) return reject(new Error(response.error));
              resolve(response.data);
            }
          );
        });
      }
      const { callModelDirect } = await import('../lib/desktopApi.js');
      return callModelDirect(payload, options);
    },
    loadProviderSettings,
    saveProviderSettings,
    listOllamaModels,
    testProviderConnection,
  }));
  const { default: DesktopSettingsModal } = await import('../DesktopSettingsModal.jsx');
  const view = render(
    <DesktopSettingsModal
      show
      onClose={onClose}
      m={theme}
      notify={notify}
      {...props}
    />
  );
  return { ...view, onClose, notify };
}

describe('DesktopSettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadProviderSettings.mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      anthropicModel: 'claude-sonnet-4-20250514',
      openaiApiKey: 'sk-openai',
      openaiModel: 'gpt-4o',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2:3b',
    });
    saveProviderSettings.mockResolvedValue(undefined);
    listOllamaModels.mockResolvedValue([]);
    testProviderConnection.mockResolvedValue({ ok: true });
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../lib/platform.js');
    vi.doUnmock('../lib/desktopApi.js');
    vi.doUnmock('../lib/providers.js');
    vi.doUnmock('../lib/providerRegistry.js');
    vi.doUnmock('../lib/proxyFetch.js');
    vi.unstubAllEnvs();
  });

  it('provider_selection_persists_and_rehydrates', async () => {
    const firstView = await renderModal();

    const providerSelect = await screen.findByRole('combobox', { name: 'Provider' });
    fireEvent.change(providerSelect, { target: { value: 'openai' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveProviderSettings).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'openai',
        openaiApiKey: 'sk-openai',
        openaiModel: 'gpt-4o',
      }));
    });

    loadProviderSettings.mockResolvedValueOnce({
      provider: 'openai',
      openaiApiKey: 'sk-openai',
      openaiModel: 'gpt-4o-mini',
    });

    firstView.unmount();
    await renderModal();

    const rehydratedProvider = await screen.findByRole('combobox', { name: 'Provider' });
    fireEvent.change(rehydratedProvider, { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('gpt-4o-mini');
    });
  });

  it('connection_test_sets_success_state', async () => {
    await renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText('Connected!')).toBeInTheDocument();
    expect(testProviderConnection).toHaveBeenCalledTimes(1);
    // Verify the test payload includes the resolved model and minimal messages
    expect(testProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        messages: expect.arrayContaining([expect.objectContaining({ role: 'user' })]),
      }),
      expect.objectContaining({ provider: 'anthropic' }),
    );
  });

  it('ollama_refresh_updates_model_list_only', async () => {
    loadProviderSettings.mockResolvedValueOnce({
      provider: 'ollama',
      openaiApiKey: 'sk-openai-preserved',
      openaiModel: 'gpt-4o',
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaModel: 'llama3.2:3b',
    });
    listOllamaModels.mockResolvedValueOnce([
      { name: 'llama3.2:8b', paramSize: '8B' },
      { name: 'mistral:7b', paramSize: '7B' },
    ]);

    await renderModal();
    const providerSelect = await screen.findByRole('combobox', { name: 'Provider' });

    await waitFor(() => {
      expect(providerSelect).toHaveValue('ollama');
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh Models' }));

    expect(await screen.findByRole('option', { name: /llama3\.2:8b/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Base URL' })).toHaveValue('http://localhost:11434');
    expect(saveProviderSettings).not.toHaveBeenCalled();

    fireEvent.change(providerSelect, { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.getByDisplayValue('sk-openai-preserved')).toBeInTheDocument();
    });
  });

  it('hosted_web_mode_locks_provider_to_anthropic_and_makes_api_key_optional', async () => {
    vi.stubEnv('VITE_WEB_MODE', 'true');
    loadProviderSettings.mockResolvedValueOnce({
      provider: 'openai',
      openaiApiKey: 'sk-openai',
      openaiModel: 'gpt-4o',
      apiKey: '',
      anthropicModel: 'claude-sonnet-4-20250514',
    });

    await renderModal();

    expect(screen.queryByRole('combobox', { name: 'Provider' })).not.toBeInTheDocument();
    expect(await screen.findByText('Hosted access')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Anthropic (hosted default)')).toBeDisabled();
    expect(screen.getByLabelText('Personal API Key (optional)')).toHaveValue('');
    expect(screen.getByRole('textbox', { name: 'Model' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveProviderSettings).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'anthropic',
        anthropicModel: 'claude-sonnet-4-20250514',
      }));
    });
  });

  it('platform_branch_behavior_matches_contract', async () => {
    const payload = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    vi.doUnmock('../lib/platform.js');
    vi.resetModules();
    globalThis.chrome = {
      runtime: {
        sendMessage: vi.fn((_msg, cb) => cb({ data: { provider: 'anthropic', model: 'ext-model' } })),
        openOptionsPage: vi.fn(),
      },
      storage: {
        session: {
          get: vi.fn((_key, cb) => cb({})),
          set: vi.fn(),
        },
      },
    };
    const extensionPlatform = await import('../lib/platform.js');
    const extensionResult = await extensionPlatform.callModel(payload);
    expect(extensionResult).toEqual({ provider: 'anthropic', model: 'ext-model' });
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'MODEL_REQUEST', payload },
      expect.any(Function),
    );

    vi.resetModules();
    delete globalThis.chrome;
    const callModelDirect = vi.fn().mockResolvedValue({ provider: 'openai', model: 'desktop-model' });
    vi.doMock('../lib/desktopApi.js', () => ({
      callModelDirect,
      listOllamaModelsDirect: vi.fn(),
      loadSettings: vi.fn(),
      saveSettings: vi.fn(),
    }));
    const desktopPlatform = await import('../lib/platform.js');
    const desktopResult = await desktopPlatform.callModel(payload);
    expect(desktopResult).toEqual({ provider: 'openai', model: 'desktop-model' });
    expect(callModelDirect).toHaveBeenCalledWith(payload, undefined);

    vi.resetModules();
    vi.stubEnv('VITE_WEB_MODE', 'true');
    vi.doMock('../lib/desktopApi.js', async (importOriginal) => importOriginal());
    const callProvider = vi.fn().mockResolvedValue({ provider: 'openai', model: 'web-model' });
    const listModels = vi.fn();
    const normalizeProvider = vi.fn((provider) => provider || 'anthropic');
    vi.doMock('../lib/providers.js', () => ({
      callProvider,
      listOllamaModels: listModels,
    }));
    vi.doMock('../lib/providerRegistry.js', () => ({
      DEFAULTS: { anthropicModel: 'claude-sonnet-4-20250514' },
      normalizeProvider,
    }));
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      provider: 'openai',
      openaiModel: 'gpt-4o',
    }));
    const desktopApi = await import('../lib/desktopApi.js');
    await desktopApi.callModelDirect(payload);

    expect(callProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'anthropic',
      payload,
      settings: expect.objectContaining({
        provider: 'anthropic',
        anthropicModel: 'claude-sonnet-4-20250514',
        apiKey: expect.any(String),
      }),
      fetchImpl: expect.any(Function),
    }));
  });
});
