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
      payload: { messages: [{ role: 'user', content: 'hello' }], max_tokens: 64, temperature: 0.2 },
      settings: {
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'mock-model',
        ollamaContextLength: 2048,
      },
      fetchImpl: fetchMock,
    })).resolves.toEqual({
      content: [{ type: 'text', text: '{"enhanced":"Improved prompt","variants":[],"notes":"","tags":[]}' }],
      model: 'mock-model',
      provider: 'ollama',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      think: false,
      options: { num_ctx: 2048, num_predict: 64, temperature: 0.2 },
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

  it('omits sampling params for Anthropic models that reject them (Opus 4.7+)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Improved prompt' }] }),
    });

    await callProvider({
      provider: 'anthropic',
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 256,
        temperature: 0.4,
      },
      settings: { apiKey: 'sk-ant', anthropicModel: 'claude-opus-4-8' },
      fetchImpl: fetchMock,
    });

    const [, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(init.body);
    expect(requestBody.model).toBe('claude-opus-4-8');
    // Opus 4.8 returns a 400 if temperature/top_p/top_k are present.
    expect(requestBody.temperature).toBeUndefined();
  });
});
