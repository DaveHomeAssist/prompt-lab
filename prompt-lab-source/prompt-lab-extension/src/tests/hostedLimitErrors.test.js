import { describe, expect, it, vi } from 'vitest';
import { callProvider } from '../lib/providers.js';
import { AppError, HostedLimitCode } from '../lib/errorTaxonomy.js';

const PAYLOAD = { messages: [{ role: 'user', content: 'hello' }], max_tokens: 64 };
const SETTINGS = { apiKey: '__plb_hosted_shared_key__', anthropicModel: 'claude-sonnet-4-6' };

function limitResponse(body, status = 429) {
  return { ok: false, status, json: async () => body };
}

async function rejectionOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the provider call to reject');
}

describe('hosted proxy limit errors', () => {
  const demoBody = {
    error: 'Daily hosted demo limit reached. Add your own Anthropic key to keep going.',
    code: HostedLimitCode.DEMO,
    limit: 3,
    reset_at: new Date(Date.now() + 23 * 60 * 60_000).toISOString(),
    demo_remaining: 0,
  };

  it.each([
    ['non-streaming', undefined],
    ['streaming', vi.fn()],
  ])('keeps the proxy code, limit, and reset time on %s calls', async (_label, onChunk) => {
    const fetchImpl = vi.fn().mockResolvedValue(limitResponse(demoBody));

    const error = await rejectionOf(callProvider({
      provider: 'anthropic', payload: PAYLOAD, settings: SETTINGS, fetchImpl, onChunk,
    }));

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(HostedLimitCode.DEMO);
    expect(error.source).toBe('prompt-lab');
    expect(error.retryable).toBe(false);
    expect(error.userMessage).toMatch(/free hosted demo limit is used up \(3 requests per day\)/);
    expect(error.userMessage).toMatch(/not an Anthropic one\. It resets in about 23 hours\./);
    expect(error.actions).toEqual(['open_provider_settings']);
    expect(error.debugMessage).toBe(demoBody.error);
  });

  it('still reports an uncoded provider 429 as a provider rate limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(limitResponse({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Number of requests has exceeded your rate limit.' },
    }));

    const error = await rejectionOf(callProvider({
      provider: 'anthropic', payload: PAYLOAD, settings: { apiKey: 'sk-ant' }, fetchImpl,
    }));

    expect(error.code).toBeUndefined();
    expect(error.source).toBe('anthropic');
    expect(error.retryable).toBe(true);
    expect(error.userMessage).toBe('anthropic rate limit hit — wait a moment and retry.');
  });
});
