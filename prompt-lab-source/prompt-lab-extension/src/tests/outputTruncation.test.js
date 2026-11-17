import { describe, expect, it, vi } from 'vitest';
import { callProvider } from '../lib/providers.js';
import { callProvider as callExtensionProvider } from '../../extension/lib/providers.js';
import { parseEnhancedPayload, stitchContinuation } from '../promptUtils.js';
import { normalizeError } from '../lib/errorTaxonomy.js';
import {
  hostedOutputCap, isOutputTruncated, maxOutputTokens, nextOutputBudget, responseWasTruncated,
} from '../../../shared/outputLimits.js';

const CUT = '{"schema_version":2,"primary_id":"expanded","enhanced":"# handle-intake and route the request';

function streamOf(frames) {
  const encoder = new TextEncoder();
  return {
    ok: true,
    body: new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  };
}

const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;

describe('output truncation detection', () => {
  it('recognizes each provider stop reason and ignores a normal finish', () => {
    expect(isOutputTruncated('anthropic', 'max_tokens')).toBe(true);
    expect(isOutputTruncated('anthropic', 'end_turn')).toBe(false);
    expect(isOutputTruncated('openai', 'length')).toBe(true);
    expect(isOutputTruncated('openai', 'stop')).toBe(false);
    expect(isOutputTruncated('openrouter', 'length')).toBe(true);
    expect(isOutputTruncated('gemini', 'MAX_TOKENS')).toBe(true);
    expect(isOutputTruncated('gemini', 'STOP')).toBe(false);
    expect(isOutputTruncated('ollama', 'length')).toBe(true);
    expect(isOutputTruncated('ollama', 'stop')).toBe(false);
    expect(responseWasTruncated({ provider: 'anthropic', stop_reason: 'max_tokens' })).toBe(true);
    expect(responseWasTruncated({ provider: 'openai', choices: [{ finish_reason: 'length' }] })).toBe(true);
    expect(responseWasTruncated({ provider: 'gemini', candidates: [{ finishReason: 'MAX_TOKENS' }] })).toBe(true);
  });

  it('flags a streamed Anthropic max_tokens stop', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([
      frame({ type: 'message_start', message: { usage: { input_tokens: 911 } } }),
      frame({ type: 'content_block_delta', delta: { text: CUT } }),
      frame({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 2048 } }),
      frame({ type: 'message_stop' }),
    ]));
    const result = await callProvider({
      provider: 'anthropic',
      payload: { messages: [{ role: 'user', content: 'Refine this' }], max_tokens: 2048 },
      settings: { apiKey: 'fixture', anthropicModel: 'claude-sonnet-4-6' },
      fetchImpl,
      onChunk: vi.fn(),
    });
    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe('max_tokens');
    expect(result.usage).toEqual({ input: 911, output: 2048, total: 2959 });
    expect(result.content[0].text).toBe(CUT);
  });

  it.each([
    ['openai', 'openaiApiKey', { choices: [{ delta: { content: CUT }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'length' }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }],
    ['openrouter', 'openrouterApiKey', { choices: [{ delta: { content: CUT } }] }, { choices: [{ finish_reason: 'length' }] }],
  ])('flags a streamed %s length stop', async (provider, key, first, last) => {
    const fetchImpl = vi.fn().mockResolvedValue(streamOf([
      frame(first),
      frame(last),
      'data: [DONE]\n\n',
    ]));
    const result = await callProvider({
      provider,
      payload: { messages: [{ role: 'user', content: 'Refine this' }] },
      settings: { [key]: 'fixture' },
      fetchImpl,
      onChunk: vi.fn(),
    });
    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe('length');
  });

  it('flags a Gemini MAX_TOKENS response and an Ollama length stop', async () => {
    const gemini = await callProvider({
      provider: 'gemini',
      payload: { messages: [{ role: 'user', content: 'Refine this' }] },
      settings: { geminiApiKey: 'fixture', geminiModel: 'gemini-2.5-flash' },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: CUT }] } }],
          usageMetadata: { promptTokenCount: 911, candidatesTokenCount: 2048, totalTokenCount: 2959 },
        }),
      }),
    });
    expect(gemini).toMatchObject({ truncated: true, stopReason: 'MAX_TOKENS', provider: 'gemini' });

    const ollama = await callProvider({
      provider: 'ollama',
      payload: { messages: [{ role: 'user', content: 'Refine this' }], max_tokens: 2048 },
      settings: { ollamaModel: 'llama3.2' },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: CUT }, done_reason: 'length' }),
      }),
    });
    expect(ollama).toMatchObject({ truncated: true, stopReason: 'length', provider: 'ollama' });
  });

  it('flags the same stops on the extension background transport', async () => {
    const anthropic = await callExtensionProvider({
      provider: 'anthropic',
      payload: { messages: [{ role: 'user', content: 'Refine this' }] },
      settings: { apiKey: 'fixture', anthropicModel: 'claude-sonnet-4-6' },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: CUT }], stop_reason: 'max_tokens' }),
      }),
    });
    expect(anthropic.truncated).toBe(true);
    const openai = await callExtensionProvider({
      provider: 'openai',
      payload: { messages: [{ role: 'user', content: 'Refine this' }] },
      settings: { openaiApiKey: 'fixture' },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ finish_reason: 'length', message: { content: CUT } }] }),
      }),
    });
    expect(openai.truncated).toBe(true);
  });
});

describe('partial JSON salvage', () => {
  it('recovers the live Expanded cutoff, including a primary field other than enhanced', () => {
    const result = parseEnhancedPayload(CUT, { modern: true });
    expect(result).toMatchObject({
      enhanced: '# handle-intake and route the request',
      partial: true,
      primary_id: 'expanded',
      schema_version: 2,
    });
    const fromContent = parseEnhancedPayload('{"schema_version":2,"content":"# handle-intake from content');
    expect(fromContent.enhanced).toBe('# handle-intake from content');
    expect(fromContent.partial).toBe(true);
    expect(() => parseEnhancedPayload('not json at all')).toThrow(/not valid JSON/i);
  });

  it('stitches a continuation onto the cutoff and prefers a restarted object', () => {
    expect(stitchContinuation(CUT, ' before closing.","variants":[]}')).toBe(`${CUT} before closing.","variants":[]}`);
    const restarted = '{"schema_version":2,"enhanced":"# handle-intake complete"}';
    expect(stitchContinuation(CUT, restarted)).toBe(restarted);
    expect(parseEnhancedPayload(stitchContinuation(CUT, ' before closing."}')).enhanced).toBe('# handle-intake and route the request before closing.');
  });

  it('keeps a repeated letter when the tail starts at the cutoff', () => {
    const prefix = 'Write a let';
    const tail = 'ter for the customer."}';
    expect(stitchContinuation(prefix, tail)).toBe('Write a letter for the customer."}');
    const repeated = 'and route the request';
    expect(stitchContinuation(`${CUT.slice(0, -'request'.length)}${repeated}`, `${repeated} before closing."}`))
      .toBe(`${CUT.slice(0, -'request'.length)}${repeated} before closing."}`);
  });

  it('names truncation, provider, network and parse failures differently', () => {
    expect(normalizeError(Object.assign(new Error('cut'), { code: 'output_truncated' })).userMessage)
      .toBe('Response was cut off at the output limit');
    expect(normalizeError(Object.assign(new Error('nope'), { status: 500 }), 'anthropic').userMessage)
      .toBe('anthropic request failed (500).');
    expect(normalizeError(new Error('Failed to fetch'), 'anthropic').category).toBe('network');
    expect(normalizeError(new Error('Model response was not valid JSON. Try again.')).code).toBe('parse_error');
    expect(normalizeError(new Error('Model response was not valid JSON. Try again.')).userMessage)
      .toMatch(/Parse error/);
  });
});

describe('output budgets stay inside published limits', () => {
  it('gives Sonnet 4.6 and Opus 4.x their real ceilings and steps a retry upward', () => {
    expect(maxOutputTokens('anthropic', 'claude-sonnet-4-6')).toBe(128000);
    expect(maxOutputTokens('anthropic', 'claude-opus-4-6')).toBe(128000);
    expect(maxOutputTokens('anthropic', 'claude-opus-4-1')).toBe(32000);
    expect(maxOutputTokens('anthropic', 'claude-sonnet-4-5')).toBe(64000);
    expect(maxOutputTokens('openai', 'gpt-4o')).toBe(16384);
    expect(maxOutputTokens('gemini', 'gemini-2.5-pro')).toBe(65536);
    expect(maxOutputTokens('ollama', 'llama3.2')).toBe(32768);
    expect(maxOutputTokens('openrouter', 'anthropic/claude-sonnet-4.6')).toBe(128000);
    expect(nextOutputBudget(2048, 'anthropic', 'claude-sonnet-4-6')).toBe(4096);
    expect(nextOutputBudget(8192, 'openai', 'gpt-4o')).toBe(16384);
    expect(nextOutputBudget(16384, 'openai', 'gpt-4o')).toBe(16384);
  });

  it('holds only the shared key to 8192 and lets Ollama use its model budget', () => {
    expect(hostedOutputCap('claude-sonnet-4-6')).toBe(8192);
    expect(hostedOutputCap('claude-sonnet-4-6', '')).toBe(8192);
    expect(hostedOutputCap('claude-sonnet-4-6', '16384')).toBe(16384);
    expect(hostedOutputCap('claude-sonnet-4-6', '200000')).toBe(128000);
    expect(hostedOutputCap('claude-3-haiku')).toBe(4096);
    expect(maxOutputTokens('ollama', 'llama3.2')).toBe(32768);
  });
});
