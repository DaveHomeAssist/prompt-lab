import { describe, expect, it, vi } from 'vitest';
import { callProvider } from '../lib/providers.js';

function makeSseStream(frames) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

describe('current provider adapter', () => {
  it('bounds Ollama context and generation options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'ok' } }),
    });

    await callProvider({
      provider: 'ollama',
      payload: {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 64,
        temperature: 0.2,
      },
      settings: {
        ollamaBaseUrl: 'http://localhost:11434',
        ollamaModel: 'mock-model',
        ollamaContextLength: 2048,
      },
      fetchImpl: fetchMock,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      think: false,
      options: { num_ctx: 2048, num_predict: 64, temperature: 0.2 },
    });
  });

  it('surfaces an actionable Ollama out-of-memory message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'cudaMalloc failed: out of memory' }),
    });

    await expect(callProvider({
      provider: 'ollama',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
      settings: { ollamaModel: 'large-model' },
      fetchImpl: fetchMock,
    })).rejects.toMatchObject({
      userMessage: 'Ollama ran out of memory. Choose a smaller model or lower the context length.',
      debugMessage: 'cudaMalloc failed: out of memory',
    });
  });

  it('surfaces an actionable empty Ollama response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: '' } }),
    });

    await expect(callProvider({
      provider: 'ollama',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
      settings: { ollamaModel: 'reasoning-model' },
      fetchImpl: fetchMock,
    })).rejects.toMatchObject({
      userMessage: 'Ollama returned no text. Increase the generation limit or choose another model.',
      debugMessage: expect.stringContaining('Ollama returned empty content'),
    });
  });

  it('uses SSE for anthropic streaming calls and strips unsupported fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Improved"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":" prompt"}}\n\n',
      ]),
    });
    const onChunk = vi.fn();

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
      onChunk,
    })).resolves.toEqual({
      content: [{ type: 'text', text: 'Improved prompt' }],
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    });

    const [, init] = fetchMock.mock.calls[0];
    const requestBody = JSON.parse(init.body);
    expect(requestBody).toEqual({
      model: 'claude-sonnet-4-6',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      system: 'Return valid JSON.',
      temperature: 0.4,
    });
    expect(requestBody.responseFormat).toBeUndefined();
    expect(onChunk).toHaveBeenCalledWith('Improved', 'Improved');
    expect(onChunk).toHaveBeenLastCalledWith(' prompt', 'Improved prompt');
  });

  it('preserves provider HTTP status for error normalization', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          message: 'responseFormat: Extra inputs are not permitted',
        },
      }),
    });

    await expect(callProvider({
      provider: 'anthropic',
      payload: { messages: [{ role: 'user', content: 'hello' }] },
      settings: { apiKey: 'sk-ant', anthropicModel: 'claude-sonnet-4-6' },
      fetchImpl: fetchMock,
    })).rejects.toMatchObject({
      name: 'AppError',
      category: 'provider',
      status: 400,
      debugMessage: 'responseFormat: Extra inputs are not permitted',
    });
  });
});
