import { expect, it, vi } from 'vitest';
import { callProvider } from '../lib/providers.js';

const settings = { apiKey: 'fixture', openaiApiKey: 'fixture', openrouterApiKey: 'fixture' };
const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (provider, text) => frame(provider === 'anthropic'
  ? { type: 'content_block_delta', delta: { text } }
  : { choices: [{ delta: { content: text } }] });
const terminal = (provider) => provider === 'anthropic' ? frame({ type: 'message_stop' }) : 'data: [DONE]\n\n';
function response(bytes) {
  return { ok: true, body: new ReadableStream({ start(controller) {
    bytes.forEach((part) => controller.enqueue(part)); controller.close();
  } }) };
}
const encode = (text) => new TextEncoder().encode(text);
const request = (provider, fetchImpl, onChunk = vi.fn(), signal) => callProvider({ provider, settings, payload: { messages: [{ role: 'user', content: 'Fixture' }] }, fetchImpl, onChunk, signal });

for (const provider of ['anthropic', 'openai', 'openrouter']) {
  it(`${provider}: accepts completion with split UTF-8 and CRLF boundaries`, async () => {
    const bytes = encode((delta(provider, 'Hello 🌍') + terminal(provider)).replaceAll('\n', '\r\n'));
    const chunks = vi.fn();
    const result = await request(provider, vi.fn().mockResolvedValue(response([...bytes].map((byte) => Uint8Array.of(byte)))), chunks);
    expect(result.content[0].text).toBe('Hello 🌍');
    expect(chunks).toHaveBeenCalledWith('Hello 🌍', 'Hello 🌍');
  });

  it(`${provider}: keeps partial text but rejects an error in the same transport chunk`, async () => {
    const bytes = encode(delta(provider, 'Partial') + frame({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded fixture' } }) + terminal(provider));
    const chunks = vi.fn();
    await expect(request(provider, vi.fn().mockResolvedValue(response([bytes])), chunks)).rejects.toMatchObject({ category: 'provider', status: 529, partialText: 'Partial' });
    expect(chunks).toHaveBeenCalledOnce();
  });

  it(`${provider}: rejects unexpected EOF after content`, async () => {
    await expect(request(provider, vi.fn().mockResolvedValue(response([encode(delta(provider, 'Partial'))])))).rejects.toMatchObject({ category: 'network', partialText: 'Partial' });
  });

  it(`${provider}: distinguishes malformed complete events from partial frames`, async () => {
    await expect(request(provider, vi.fn().mockResolvedValue(response([encode(delta(provider, 'Partial') + 'data: {broken}\n\n')])))).rejects.toMatchObject({ status: 502, partialText: 'Partial' });
  });
}

it('handles multi-line data fields and ignores comment/unknown events', async () => {
  const text = ': keepalive\n\n' + frame({ type: 'future_event' }) + 'data: {"type":"content_block_delta",\ndata: "delta":{"text":"Hello"}}\n\n' + terminal('anthropic');
  await expect(request('anthropic', vi.fn().mockResolvedValue(response([encode(text)])))).resolves.toMatchObject({ content: [{ type: 'text', text: 'Hello' }] });
});

it('rejects OpenRouter finish_reason error without a top-level error object', async () => {
  const text = delta('openrouter', 'Partial') + frame({ choices: [{ delta: {}, finish_reason: 'error' }] });
  await expect(request('openrouter', vi.fn().mockResolvedValue(response([encode(text)])))).rejects.toMatchObject({ status: 502, partialText: 'Partial' });
});

it('aborts before fetch and during a pending read without late chunks or retries', async () => {
  const pre = new AbortController(); pre.abort();
  const fetch = vi.fn();
  await expect(request('anthropic', fetch, vi.fn(), pre.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetch).not.toHaveBeenCalled();
  const controller = new AbortController();
  const cancel = vi.fn();
  const chunks = vi.fn();
  const pending = request('anthropic', vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ cancel }) }), chunks, controller.signal);
  await Promise.resolve();
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancel).toHaveBeenCalledOnce();
  expect(chunks).not.toHaveBeenCalled();
});
