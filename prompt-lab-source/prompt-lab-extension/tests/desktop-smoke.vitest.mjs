import { describe, it, expect, beforeEach, vi } from 'vitest';

const freshImport = (path) => import(`${path}?t=${Date.now()}-${Math.random()}`);

describe('desktop smoke', () => {
  beforeEach(() => {
    delete globalThis.chrome;
    localStorage.clear();
  });

  it('platform.js uses desktop storage and events', async () => {
    const eventPromise = new Promise((resolve) => window.addEventListener('pl:open-settings', resolve, { once: true }));
    const platform = await freshImport('../src/lib/platform.js');
    expect(platform.isExtension).toBe(false);
    platform.sessionSet({ alpha: { ok: true } });
    const value = await new Promise((resolve) => platform.sessionGet('alpha', resolve));
    expect(value).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem('pl2-session-alpha'))).toEqual({ ok: true });
    await platform.saveProviderSettings({ provider: 'ollama', ollamaModel: 'llama3.2:3b' });
    expect(await platform.loadProviderSettings()).toMatchObject({ provider: 'ollama', ollamaModel: 'llama3.2:3b' });
    expect(JSON.parse(localStorage.getItem('pl2-provider-settings'))).toMatchObject({ provider: 'ollama' });
    platform.openSettings();
    const event = await eventPromise;
    expect(event.type).toBe('pl:open-settings');
  });

  it('desktopApi.js persists settings and rejects unconfigured model calls', async () => {
    const desktopApi = await freshImport('../src/lib/desktopApi.js');
    expect(desktopApi.loadSettings()).toEqual({});
    desktopApi.saveSettings({ provider: 'ollama' });
    expect(desktopApi.loadSettings()).toMatchObject({ provider: 'ollama' });
    localStorage.clear();
    await expect(desktopApi.callModelDirect({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
  });

  it('providers.js routes Ollama calls and maps model listings', async () => {
    const { callProvider, listOllamaModels } = await freshImport('../src/lib/providers.js');
    const chatFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'ok' } }),
    });
    const result = await callProvider({
      provider: 'ollama',
      payload: { messages: [{ role: 'user', content: 'hi' }] },
      settings: { ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'llama3.2:3b' },
      fetchImpl: chatFetch,
    });
    expect(result.provider).toBe('ollama');
    expect(chatFetch.mock.calls[0][0]).toContain('/api/chat');

    const tagsFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: 'llama3.2:3b', details: { parameter_size: '3B' }, size: 1 }],
      }),
    });
    const models = await listOllamaModels('http://localhost:11434', tagsFetch);
    expect(tagsFetch.mock.calls[0][0]).toContain('/api/tags');
    expect(models).toEqual([
      expect.objectContaining({ name: 'llama3.2:3b', paramSize: '3B' }),
    ]);
  });
});
