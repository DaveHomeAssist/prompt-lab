import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOSTED_OUTPUT_CAP_STORAGE_KEY,
  getHostedOutputCap,
  recordHostedOutputCap,
  requestedMaxTokens,
} from '../lib/hostedOutputCap.js';

describe('hosted output cap', () => {
  beforeEach(() => {
    globalThis.localStorage?.removeItem(HOSTED_OUTPUT_CAP_STORAGE_KEY);
  });

  it('reads max_tokens from the proxy envelope', () => {
    expect(requestedMaxTokens(JSON.stringify({ body: JSON.stringify({ max_tokens: 4096 }) }))).toBe(4096);
  });

  it('records a lower hosted cap from a successful response', () => {
    recordHostedOutputCap(new Response('', { status: 200, headers: { 'X-Hosted-Max-Tokens': '2048' } }), 4096);
    expect(getHostedOutputCap()).toBe(2048);
  });

  it('clears a previously observed cap when the response proves it is sufficient', () => {
    recordHostedOutputCap(new Response('', { status: 200, headers: { 'X-Hosted-Max-Tokens': '2048' } }), 4096);
    recordHostedOutputCap(new Response('', { status: 200, headers: { 'X-Hosted-Max-Tokens': '4096' } }), 4096);
    expect(getHostedOutputCap()).toBe(null);
  });

  it('ignores non-success responses and malformed requests', () => {
    recordHostedOutputCap(new Response('', { status: 429, headers: { 'X-Hosted-Max-Tokens': '2048' } }), 4096);
    expect(getHostedOutputCap()).toBe(null);
    expect(requestedMaxTokens('{bad json')).toBe(null);
  });
});
