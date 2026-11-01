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


it('records the upstream stream model rather than the requested alias', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true,
    headers: new Headers({ 'X-Hosted-Model': 'claude-sonnet-5-5' }),
    body: makeSseStream([
      'data: {"type":"message_start","message":{"model":"claude-sonnet-5-5-20260928","usage":{"input_tokens":5}}}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"Done"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]),
  });
  const result = await callProvider({ provider: 'anthropic', payload: { messages: [{ role: 'user', content: 'test' }], temperature: 0.4 }, settings: { apiKey: 'fixture', anthropicModel: 'claude-sonnet-5-5' }, fetchImpl, onChunk: vi.fn() });
  expect(result.model).toBe('claude-sonnet-5-5-20260928');
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('temperature');
});

it.each(['claude-haiku-5-5', 'claude-opus-5-5'])('omits incompatible sampling parameters for %s', async model => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Done' }], model }) });
  await callProvider({ provider: 'anthropic', payload: { temperature: 0.4, messages: [{ role: 'user', content: 'test' }] }, settings: { apiKey: 'fixture', anthropicModel: model }, fetchImpl });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ model });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty('temperature');
});
