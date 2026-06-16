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

  it('sanitizes anthropic payloads before sending them upstream', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Improved prompt' }],
      }),
    });

    await expect(callProvider({
      provider: 'anthropic',
      payload: {
        system: 'Return valid JSON.',
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 256,
        temperature: 0.4,
        responseFormat: 'json',
      },
      settings: { apiKey: 'sk-ant', anthropicModel: 'claude-sonnet-4-6' },
      fetchImpl: fetchMock,
    })).resolves.toEqual(expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }));

    const [, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(init.body);
    expect(requestBody).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
      system: 'Return valid JSON.',
      temperature: 0.4,
    });
    expect(requestBody.responseFormat).toBeUndefined();
  });

  it('maps retired anthropic model ids to the current default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: 'Improved prompt' }],
      }),
    });

    await expect(callProvider({
      provider: 'anthropic',
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
      },
      settings: { apiKey: 'sk-ant', anthropicModel: 'claude-sonnet-4-20250514' },
      fetchImpl: fetchMock,
    })).resolves.toEqual(expect.objectContaining({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }));

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe('claude-sonnet-4-6');
  });
});
