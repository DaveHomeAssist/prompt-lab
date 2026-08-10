import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError,
  ErrorCategory,
  normalizeError,
  providerError,
  validationError,
} from '../src/lib/errorTaxonomy.js';

test('auth errors expose settings recovery without retry', () => {
  const result = normalizeError(new Error('401 Unauthorized'), 'anthropic');

  assert.equal(result.category, ErrorCategory.AUTH);
  assert.equal(result.source, 'anthropic');
  assert.equal(result.retryable, false);
  assert.ok(result.actions.includes('open_provider_settings'));
  assert.ok(result.suggestions.length > 0);
});

test('auth classification handles API-key text and explicit status', () => {
  assert.equal(normalizeError(new Error('Invalid API key')).category, ErrorCategory.AUTH);
  assert.equal(normalizeError({ message: 'Forbidden', status: 403 }).category, ErrorCategory.AUTH);
});

test('rate-limit errors are retryable', () => {
  const result = normalizeError(new Error('429 Too Many Requests'), 'openai');

  assert.equal(result.category, ErrorCategory.RATE_LIMIT);
  assert.equal(result.retryable, true);
  assert.ok(result.actions.includes('retry'));
});

test('network errors include fetch, DNS, and timeout failures', () => {
  for (const message of ['Failed to fetch', 'DNS resolution failed', 'Request timeout']) {
    assert.equal(normalizeError(new Error(message)).category, ErrorCategory.NETWORK);
  }
});

test('provider status is preserved and controls retryability', () => {
  const badRequest = normalizeError({ message: 'Request failed', status: 400 }, 'anthropic');
  const unavailable = normalizeError(new Error('Request failed (503)'), 'anthropic');

  assert.equal(badRequest.category, ErrorCategory.PROVIDER);
  assert.equal(badRequest.status, 400);
  assert.equal(badRequest.retryable, false);
  assert.equal(unavailable.category, ErrorCategory.PROVIDER);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.retryable, true);
});

test('unknown values produce a safe AppError envelope', () => {
  for (const input of [null, undefined, 'Something unexpected']) {
    const result = normalizeError(input);
    assert.ok(result instanceof AppError);
    assert.equal(result.category, ErrorCategory.UNKNOWN);
    assert.equal(typeof result.userMessage, 'string');
    assert.equal(typeof result.debugMessage, 'string');
  }
});

test('existing AppErrors retain identity and validation recovery shape', () => {
  const original = validationError('enhance', 'Prompt text is required.');

  assert.equal(normalizeError(original), original);
  assert.equal(original.category, ErrorCategory.VALIDATION);
  assert.deepEqual(original.actions, []);
  assert.ok(original.suggestions.includes('Check your input and try again.'));
});

test('provider factory returns user-safe details', () => {
  const result = providerError('anthropic', 500, 'upstream trace data');

  assert.equal(result.userMessage, 'anthropic request failed (500).');
  assert.equal(result.debugMessage, 'upstream trace data');
  assert.equal(result.retryable, true);
});
