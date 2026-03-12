import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeError } from '../src/errorTaxonomy.js';

// ── Category routing ────────────────────────────────────────────────────────

test('auth: 401 status code', () => {
  const r = normalizeError(new Error('401 Unauthorized'));
  assert.equal(r.category, 'auth');
  assert.ok(r.suggestions.length > 0);
  assert.ok(r.actions.includes('open_provider_settings'));
});

test('auth: invalid api key string', () => {
  assert.equal(normalizeError(new Error('Invalid API key provided')).category, 'auth');
});

test('auth: 403 forbidden', () => {
  assert.equal(normalizeError(new Error('403 Forbidden')).category, 'auth');
});

test('auth: missing api key', () => {
  assert.equal(normalizeError(new Error('Missing API key')).category, 'auth');
});

test('quota: 429 rate limit', () => {
  const r = normalizeError(new Error('429 Too Many Requests'));
  assert.equal(r.category, 'quota');
  assert.ok(r.actions.includes('retry'));
});

test('quota: insufficient_quota', () => {
  assert.equal(normalizeError(new Error('insufficient_quota')).category, 'quota');
});

test('network: failed to fetch', () => {
  const r = normalizeError(new Error('Failed to fetch'));
  assert.equal(r.category, 'network');
});

test('network: DNS error', () => {
  assert.equal(normalizeError(new Error('DNS resolution failed')).category, 'network');
});

test('network: SSL error', () => {
  assert.equal(normalizeError(new Error('SSL certificate expired')).category, 'network');
});

test('network: CORS error', () => {
  assert.equal(normalizeError(new Error('CORS policy blocked')).category, 'network');
});

test('timeout: timed out', () => {
  const r = normalizeError(new Error('Request timed out'));
  assert.equal(r.category, 'timeout');
});

test('timeout: 504 gateway', () => {
  assert.equal(normalizeError(new Error('504 Gateway Timeout')).category, 'timeout');
});

test('timeout: context length exceeded', () => {
  assert.equal(normalizeError(new Error('context length exceeded')).category, 'timeout');
});

test('schema: unexpected token', () => {
  const r = normalizeError(new Error('Unexpected token < in JSON'));
  assert.equal(r.category, 'schema');
});

test('schema: malformed response', () => {
  assert.equal(normalizeError(new Error('Malformed response body')).category, 'schema');
});

test('provider: unknown error falls through', () => {
  const r = normalizeError(new Error('Something totally weird happened'));
  assert.equal(r.category, 'provider');
  assert.ok(r.actions.includes('retry'));
});

// ── Edge cases ──────────────────────────────────────────────────────────────

test('handles null error', () => {
  const r = normalizeError(null);
  assert.equal(r.category, 'provider');
});

test('handles undefined error', () => {
  const r = normalizeError(undefined);
  assert.equal(r.category, 'provider');
});

test('handles plain string instead of Error', () => {
  const r = normalizeError('rate limit exceeded');
  assert.equal(r.category, 'quota');
});

test('handles error with stack trace in details', () => {
  const err = new Error('authentication failed');
  const r = normalizeError(err);
  assert.ok(r.details.includes('authentication failed'));
});

test('code extraction picks 3-letter uppercase codes', () => {
  const r = normalizeError(new Error('ERR_CONNECTION_REFUSED network'));
  assert.equal(r.code, 'ERR_CONNECTION_REFUSED');
});

test('code extraction picks first matching code token', () => {
  const r = normalizeError(new Error('HTTP 503 Service Unavailable'));
  // pickCode grabs first 3+ char uppercase or 3-digit numeric — 'HTTP' matches first
  assert.equal(r.code, 'HTTP');
});

test('all results have required shape', () => {
  const cases = [null, '', new Error('test'), 'string error', { message: '429' }];
  for (const input of cases) {
    const r = normalizeError(input);
    assert.ok(r.category);
    assert.ok(r.code);
    assert.ok(typeof r.userMessage === 'string');
    assert.ok(typeof r.details === 'string');
    assert.ok(Array.isArray(r.suggestions));
    assert.ok(Array.isArray(r.actions));
  }
});
