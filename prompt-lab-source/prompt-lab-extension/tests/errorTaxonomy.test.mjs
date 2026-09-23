import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AppError,
  ErrorCategory,
  HostedLimitCode,
  formatResetHint,
  hostedLimitError,
  isRetryable,
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

test('rate-limit errors are not auto-retried but keep a manual Try Again', () => {
  const result = normalizeError(new Error('429 Too Many Requests'), 'openai');

  assert.equal(result.category, ErrorCategory.RATE_LIMIT);
  assert.equal(result.retryable, false);
  assert.equal(isRetryable(result), false);
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

// ── Hosted proxy limits ─────────────────────────────────────────────

const NOW = Date.parse('2026-09-22T15:36:00.000Z');

function proxy429(code, { limit, resetAt, message = 'proxy limit' } = {}) {
  const error = new Error(message);
  error.status = 429;
  error.code = code;
  if (limit != null) error.limit = limit;
  if (resetAt) error.resetAt = resetAt;
  return error;
}

test('reset hints read as a relative time and degrade to empty when unknown', () => {
  assert.equal(formatResetHint('2026-09-22T15:36:01.000Z', NOW), 'in 1 second');
  assert.equal(formatResetHint('2026-09-22T15:36:40.000Z', NOW), 'in 40 seconds');
  assert.equal(formatResetHint('2026-09-22T15:41:00.000Z', NOW), 'in about 5 minutes');
  assert.equal(formatResetHint('2026-09-22T16:36:00.000Z', NOW), 'in about 1 hour');
  assert.equal(formatResetHint('2026-09-23T14:36:00.000Z', NOW), 'in about 23 hours');
  assert.equal(formatResetHint('2026-09-22T15:00:00.000Z', NOW), 'in a moment');
  assert.equal(formatResetHint(undefined, NOW), '');
  assert.equal(formatResetHint('not a date', NOW), '');
});

test('demo cap is attributed to Prompt Lab and points at adding a key instead of retrying', () => {
  const error = hostedLimitError(HostedLimitCode.DEMO, {
    limit: 3,
    resetAt: '2026-09-23T14:36:00.000Z',
    detail: 'Daily hosted demo limit reached. Add your own Anthropic key to keep going.',
    now: NOW,
  });

  assert.equal(error.userMessage,
    "Prompt Lab's free hosted demo limit is used up (3 requests per day). "
    + 'This is a Prompt Lab limit, not an Anthropic one. It resets in about 23 hours.');
  assert.deepEqual(error.suggestions, [
    'Add your own Anthropic API key in Provider Settings to keep going now.',
    'Or wait until it resets in about 23 hours.',
  ]);
  assert.deepEqual(error.actions, ['open_provider_settings']);
  assert.equal(error.category, ErrorCategory.RATE_LIMIT);
  assert.equal(error.source, 'prompt-lab');
  assert.equal(error.status, 429);
  assert.equal(error.retryable, false);
  assert.equal(isRetryable(error), false);
  assert.match(error.debugMessage, /Daily hosted demo limit reached/);
});

test('global budget is attributed to Prompt Lab and offers a key instead of retrying', () => {
  const error = hostedLimitError(HostedLimitCode.GLOBAL, { limit: 100, resetAt: '2026-09-22T20:36:00.000Z', now: NOW });

  assert.equal(error.userMessage,
    "Prompt Lab's shared hosted budget for today is used up. "
    + 'This is a Prompt Lab limit, not an Anthropic one. It resets in about 5 hours.');
  assert.deepEqual(error.actions, ['open_provider_settings']);
  assert.equal(error.suggestions[0], 'Add your own Anthropic API key in Provider Settings to keep going now.');
  assert.equal(error.retryable, false);
});

test('burst limit keeps Try Again but is not auto-retried inside its window', () => {
  const error = hostedLimitError(HostedLimitCode.BURST, { limit: 30, resetAt: '2026-09-22T15:36:40.000Z', now: NOW });

  assert.equal(error.userMessage,
    "Too many requests to Prompt Lab's hosted service in the last minute (limit 30). "
    + 'This is a Prompt Lab limit, not an Anthropic one. You can try again in 40 seconds.');
  assert.deepEqual(error.suggestions, [
    'Try again in 40 seconds.',
    'Close other Prompt Lab tabs that are sending requests.',
  ]);
  assert.deepEqual(error.actions, ['retry']);
  assert.equal(error.retryable, false);
});

test('hosted limit copy stays accurate when the limit or reset time is missing', () => {
  const demo = hostedLimitError(HostedLimitCode.DEMO, { now: NOW });
  assert.equal(demo.userMessage,
    "Prompt Lab's free hosted demo limit is used up for today. This is a Prompt Lab limit, not an Anthropic one.");
  assert.equal(demo.suggestions[1], 'Or wait for the daily reset.');

  const single = hostedLimitError(HostedLimitCode.DEMO, { limit: 1, now: NOW });
  assert.match(single.userMessage, /\(1 request per day\)/);

  const burst = hostedLimitError(HostedLimitCode.BURST, { now: NOW });
  assert.equal(burst.suggestions[0], 'Wait about a minute, then try again.');
});

test('normalizeError routes coded proxy 429s to hosted limits before message heuristics', () => {
  // The demo message mentions an Anthropic key; it must not be treated as an auth error.
  const demo = normalizeError(
    proxy429(HostedLimitCode.DEMO, { limit: 3, message: 'Daily hosted demo limit reached. Add your own Anthropic key to keep going.' }),
    'anthropic',
  );
  assert.equal(demo.code, HostedLimitCode.DEMO);
  assert.equal(demo.source, 'prompt-lab');
  assert.doesNotMatch(demo.userMessage, /anthropic rate limit hit/i);

  // The burst message contains "rate"; it must still get hosted copy.
  const burst = normalizeError(proxy429(HostedLimitCode.BURST, { message: 'Rate limit exceeded. Try again shortly.' }), 'anthropic');
  assert.equal(burst.code, HostedLimitCode.BURST);
  assert.equal(burst.retryable, false);
});

test('uncoded 429s keep the provider rate-limit behavior', () => {
  const upstream = normalizeError(proxy429(undefined, { message: 'Number of request tokens has exceeded your rate limit.' }), 'anthropic');
  assert.equal(upstream.userMessage, 'anthropic rate limit hit — wait a moment and retry.');
  assert.equal(upstream.source, 'anthropic');
  assert.equal(upstream.retryable, false);
  assert.deepEqual(upstream.actions, ['retry']);
  assert.equal(upstream.code, undefined);

  // Unknown codes (e.g. a Node system error code) are ignored.
  const unknownCode = normalizeError(proxy429('ECONNRESET', { message: 'failed (429)' }), 'openai');
  assert.equal(unknownCode.source, 'openai');
  assert.equal(unknownCode.retryable, false);
});
