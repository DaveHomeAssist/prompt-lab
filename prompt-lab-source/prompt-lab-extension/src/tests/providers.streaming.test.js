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
  it('uses SSE for anthropic streaming calls and strips unsupported fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSseStream([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":31}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Improved"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":" prompt"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":7},"delta":{}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
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
      usage: { input: 31, output: 7, total: 38 },
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
