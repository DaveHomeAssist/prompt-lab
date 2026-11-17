import { describe, expect, it } from 'vitest';
import { getActiveProvider } from '../lib/platform.js';
import { activeProviderSelection } from '../lib/providerRegistry.js';

describe('active provider selection', () => {
  it('uses the selected model and drops secrets', () => {
    expect(activeProviderSelection({
      provider: 'openai',
      apiKey: 'sk-ant-present',
      openaiApiKey: 'sk-openai-present',
      anthropicModel: 'claude-sonnet-4-6',
      openaiModel: 'gpt-4o-mini',
    })).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });

  it('asks the extension for the saved selection instead of reading localStorage', async () => {
    localStorage.setItem('pl2-provider-settings', JSON.stringify({
      provider: 'gemini',
      geminiModel: 'gemini-2.5-pro',
    }));
    chrome.runtime.sendMessage = (message, callback) => {
      expect(message).toEqual({ type: 'GET_PROVIDER_SETTINGS' });
      callback({
        providers: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
        active: { provider: 'openai', model: 'gpt-4o-mini' },
      });
    };
    await expect(getActiveProvider()).resolves.toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
  });
});