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

vi.mock('../lib/platform.js', () => ({
  isExtension: false,
  loadProviderSettings,
  saveProviderSettings,
  listOllamaModels,
  testProviderConnection,
}));

import DesktopSettingsModal from '../DesktopSettingsModal.jsx';

const theme = {
  input: 'bg-slate-900',
  border: 'border-slate-700',
  text: 'text-white',
  textAlt: 'text-slate-200',
  textMuted: 'text-slate-400',
  btn: 'bg-slate-800',
  bg: 'bg-slate-950',
};

function renderModal(props = {}) {
  const onClose = vi.fn();
  const notify = vi.fn();
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
    vi.unstubAllEnvs();
  });

  it('provider_selection_persists_and_rehydrates', async () => {
    const firstView = renderModal();

    const providerSelect = await screen.findByLabelText(/provider/i);
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
    renderModal();

    const rehydratedProvider = await screen.findByLabelText(/provider/i);
    fireEvent.change(rehydratedProvider, { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.getByLabelText(/model/i)).toHaveValue('gpt-4o-mini');
    });
  });

  it('connection_test_sets_success_state', async () => {
    renderModal();

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

    renderModal();

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh Models' }));

    expect(await screen.findByRole('option', { name: /llama3\.2:8b/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/base url/i)).toHaveValue('http://localhost:11434');
    expect(saveProviderSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'openai' } });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toHaveValue('sk-openai-preserved');
    });
  });

  it('platform_branch_behavior_matches_contract', async () => {
    const payload = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    };

    vi.unmock('../lib/platform.js');
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
    expect(callModelDirect).toHaveBeenCalledWith(payload);

    vi.resetModules();
    vi.stubEnv('VITE_WEB_MODE', 'true');
    const callProvider = vi.fn().mockResolvedValue({ provider: 'openai', model: 'web-model' });
    const listModels = vi.fn();
    const createProxyFetch = vi.fn(() => 'proxy-fetch');
    const normalizeProvider = vi.fn((provider) => provider || 'anthropic');
    vi.doMock('../lib/providers.js', () => ({
      callProvider,
      listOllamaModels: listModels,
    }));
    vi.doMock('../lib/providerRegistry.js', () => ({
      normalizeProvider,
    }));
    vi.doMock('../lib/proxyFetch.js', () => ({
      createProxyFetch,
    }));
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      provider: 'openai',
      openaiModel: 'gpt-4o',
    }));
    const desktopApi = await import('../lib/desktopApi.js');
    await desktopApi.callModelDirect(payload);

    expect(createProxyFetch).toHaveBeenCalledTimes(1);
    expect(callProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      payload,
      settings: expect.objectContaining({
        openaiApiKey: 'demo',
        openaiModel: 'gpt-4o',
      }),
      fetchImpl: 'proxy-fetch',
    }));
  });
});
