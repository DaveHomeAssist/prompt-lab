import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scanSensitiveData,
  redactPayload,
  summarizeMatches,
  DEFAULT_REDACTION_SETTINGS,
} from '../src/piiScanner.js';

// ── scanSensitiveData ───────────────────────────────────────────────────────

test('scan: returns empty for empty input', () => {
  const { matches } = scanSensitiveData({ prompt: '' });
  assert.equal(matches.length, 0);
});

test('scan: returns empty when disabled', () => {
  const { matches } = scanSensitiveData(
    { prompt: 'sk-ant-abc123456789012345' },
    { enabled: false },
  );
  assert.equal(matches.length, 0);
});

test('scan: detects sk- API key pattern', () => {
  // regex expects sk-[A-Za-z0-9]{16,} — no hyphens after sk-
  const { matches } = scanSensitiveData({ prompt: 'key is sk-abc12345678901234567890' });
  assert.ok(matches.some(m => m.type === 'api_key'));
});

test('scan: detects GitHub PAT', () => {
  const { matches } = scanSensitiveData({ prompt: 'token ghp_abcdefghij1234567890AB' });
  assert.ok(matches.some(m => m.type === 'api_key'));
});

test('scan: detects Google AI key pattern', () => {
  const { matches } = scanSensitiveData({ prompt: 'key AIzaSyA1234567890abcdefghijk' });
  assert.ok(matches.some(m => m.type === 'api_key'));
});

test('scan: detects Slack tokens', () => {
  const { matches } = scanSensitiveData({ prompt: 'xoxb-1234567890-abcdefghij' });
  assert.ok(matches.some(m => m.type === 'api_key'));
});

test('scan: detects email addresses', () => {
  const { matches } = scanSensitiveData({ prompt: 'Contact me at user@example.com please' });
  assert.ok(matches.some(m => m.type === 'email'));
});

test('scan: detects credit card with valid Luhn', () => {
  // 4111111111111111 is a well-known Luhn-valid test card
  const { matches } = scanSensitiveData({ prompt: 'card: 4111111111111111' });
  assert.ok(matches.some(m => m.type === 'credit_card'));
});

test('scan: rejects card numbers that fail Luhn', () => {
  const { matches } = scanSensitiveData({ prompt: 'number: 1234567890123456' });
  assert.ok(!matches.some(m => m.type === 'credit_card'));
});

test('scan: detects secret assignments', () => {
  const { matches } = scanSensitiveData({ prompt: 'password = hunter2secret' });
  assert.ok(matches.some(m => m.type === 'secret_value' || m.type === 'api_key'));
});

test('scan: detects token assignment', () => {
  const { matches } = scanSensitiveData({ prompt: 'token: abcdef123456ghij7890' });
  assert.ok(matches.length > 0);
});

test('scan: ignores normal text', () => {
  const { matches } = scanSensitiveData({ prompt: 'The weather is nice today.' });
  assert.equal(matches.length, 0);
});

test('scan: searches variables too', () => {
  const { matches } = scanSensitiveData({
    prompt: 'hello',
    variables: { key: 'sk-abc12345678901234567890' },
  });
  assert.ok(matches.some(m => m.type === 'api_key'));
});

test('scan: searches nested payload strings', () => {
  const { matches } = scanSensitiveData({
    prompt: '',
    payload: { messages: [{ content: 'user@test.com' }] },
  });
  assert.ok(matches.some(m => m.type === 'email'));
});

test('scan: custom patterns work', () => {
  const { matches } = scanSensitiveData(
    { prompt: 'INTERNAL-REF-12345 is classified' },
    { ...DEFAULT_REDACTION_SETTINGS, types: { ...DEFAULT_REDACTION_SETTINGS.types, custom: true }, customPatterns: ['INTERNAL-REF-\\d+'] },
  );
  assert.ok(matches.some(m => m.type === 'custom'));
});

test('scan: invalid custom regex is silently skipped', () => {
  const { matches } = scanSensitiveData(
    { prompt: 'test text' },
    { ...DEFAULT_REDACTION_SETTINGS, customPatterns: ['[invalid('] },
  );
  // Should not throw
  assert.ok(Array.isArray(matches));
});

test('scan: respects per-type disable', () => {
  const settings = {
    enabled: true,
    types: { api_key: false, email: true, credit_card: false, secret_value: false, custom: false },
    customPatterns: [],
  };
  const { matches } = scanSensitiveData(
    { prompt: 'sk-ant-abc12345678901234567890 and user@test.com' },
    settings,
  );
  assert.ok(matches.every(m => m.type === 'email'));
});

test('scan: deduplicates matches', () => {
  const { matches } = scanSensitiveData({ prompt: 'user@test.com user@test.com' });
  const emails = matches.filter(m => m.type === 'email');
  // Should have exactly 2 (different positions)
  assert.equal(emails.length, 2);
  assert.notEqual(emails[0].start, emails[1].start);
});

// ── redactPayload ───────────────────────────────────────────────────────────

test('redact: returns unchanged payload with no matches', () => {
  const payload = { prompt: 'hello' };
  const result = redactPayload(payload, []);
  assert.deepEqual(result, payload);
});

test('redact: replaces matched text with placeholder', () => {
  const payload = { prompt: 'email is user@test.com' };
  const { matches } = scanSensitiveData({ prompt: payload.prompt });
  const result = redactPayload(payload, matches.map(m => ({ ...m, path: ['prompt'] })));
  assert.ok(!result.prompt.includes('user@test.com'));
  assert.ok(result.prompt.includes('[EMAIL]'));
});

test('redact: handles null payload', () => {
  const result = redactPayload(null, []);
  assert.deepEqual(result, {});
});

test('redact: does not mutate original', () => {
  const payload = { prompt: 'user@test.com' };
  const original = JSON.parse(JSON.stringify(payload));
  redactPayload(payload, [{ type: 'email', snippet: 'user@test.com', path: ['prompt'], start: 0, end: 13 }]);
  assert.deepEqual(payload, original);
});

// ── summarizeMatches ────────────────────────────────────────────────────────

test('summarize: adds placeholder and preview', () => {
  const matches = [{ type: 'email', snippet: 'user@test.com' }];
  const result = summarizeMatches(matches);
  assert.equal(result[0].placeholder, '[EMAIL]');
  assert.equal(result[0].preview, 'user@test.com');
});

test('summarize: truncates long snippets', () => {
  const matches = [{ type: 'api_key', snippet: 'a'.repeat(60) }];
  const result = summarizeMatches(matches);
  assert.ok(result[0].preview.includes('…'));
  assert.ok(result[0].preview.length < 60);
});

test('summarize: handles empty array', () => {
  assert.deepEqual(summarizeMatches([]), []);
});

test('summarize: handles null', () => {
  assert.deepEqual(summarizeMatches(null), []);
});
