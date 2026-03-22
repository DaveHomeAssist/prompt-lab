import { describe, expect, it } from 'vitest';

import { getProvider } from '../lib/providerRegistry.js';

describe('providerRegistry stream parsers', () => {
  it('exposes an anthropic SSE parser on the registry descriptor', () => {
    const parser = getProvider('anthropic').parseStream;
    expect(typeof parser).toBe('function');
    expect(
      parser(
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n\n',
        true,
      ),
    ).toEqual({
      buffer: '',
      chunks: ['Hello'],
    });
  });

  it('exposes OpenAI-compatible SSE parsers for chat providers', () => {
    const frame =
      'data: {"choices":[{"delta":{"content":"World"}}]}\n\n';

    expect(getProvider('openai').parseStream(frame, true)).toEqual({
      buffer: '',
      chunks: ['World'],
    });
    expect(getProvider('openrouter').parseStream(frame, true)).toEqual({
      buffer: '',
      chunks: ['World'],
    });
  });
});
