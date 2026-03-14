import { describe, expect, it, vi } from 'vitest';
import {
  callProvider,
  listOllamaModels,
  normalizeProvider,
} from '../../extension/lib/providers.js';

describe('provider registry', () => {
  it('normalizes unknown providers to anthropic', () => {
    expect(normalizeProvider('openai')).toBe('openai');
    expect(normalizeProvider('unknown')).toBe('anthropic');
  });

  it('lists ollama models from the provider adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: 'mock-model',
            size: 123,
            modified_at: '2026-03-13T00:00:00Z',
            details: { family: 'llama', parameter_size: '3B' },
          },
        ],
      }),
    });

    await expect(listOllamaModels('http://localhost:11434', fetchMock)).resolves.toEqual([
      {
        name: 'mock-model',
        size: 123,
        modified: '2026-03-13T00:00:00Z',
        family: 'llama',
        paramSize: '3B',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.any(Object));
  });

  it('dispatches provider calls through the abstraction layer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '{"enhanced":"Improved prompt","variants":[],"notes":"","tags":[]}' },
      }),
    });

    await expect(callProvider({
      provider: 'ollama',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
      settings: { ollamaBaseUrl: 'http://localhost:11434', ollamaModel: 'mock-model' },
      fetchImpl: fetchMock,
    })).resolves.toEqual({
      content: [{ type: 'text', text: '{"enhanced":"Improved prompt","variants":[],"notes":"","tags":[]}' }],
      model: 'mock-model',
      provider: 'ollama',
    });
  });
});
