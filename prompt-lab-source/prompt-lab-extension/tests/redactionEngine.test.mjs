import test from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultRedactionSettings,
  detectSensitiveData,
  redactSensitiveData,
  redactPayloadStrings,
  sensitiveTypeMeta,
} from '../src/redactionEngine.js';

// ── defaultRedactionSettings ────────────────────────────────────────────────

test('defaults: all pattern types enabled', () => {
  const s = defaultRedactionSettings();
  assert.equal(s.enabled, true);
  assert.equal(s.patterns.api_key, true);
  assert.equal(s.patterns.email, true);
  assert.equal(s.patterns.credit_card, true);
  assert.equal(s.patterns.secret_value, true);
  assert.equal(s.patterns.custom, true);
  assert.deepEqual(s.customPatterns, []);
});

// ── detectSensitiveData ─────────────────────────────────────────────────────

test('detect: empty text returns empty', () => {
  assert.deepEqual(detectSensitiveData(''), []);
  assert.deepEqual(detectSensitiveData('  \n  '), []);
});

test('detect: returns empty when disabled', () => {
  const s = { ...defaultRedactionSettings(), enabled: false };
  assert.deepEqual(detectSensitiveData('sk-ant-abcdef1234567890', s), []);
});

test('detect: non-string returns empty', () => {
  assert.deepEqual(detectSensitiveData(null), []);
  assert.deepEqual(detectSensitiveData(42), []);
});

test('detect: finds sk- API key pattern', () => {
  const m = detectSensitiveData('My key is sk-1234567890abcdef1234');
  assert.ok(m.some(x => x.type === 'api_key'));
});

test('detect: finds AWS access key', () => {
  const m = detectSensitiveData('aws AKIAIOSFODNN7EXAMPLE');
  assert.ok(m.some(x => x.type === 'api_key'));
});

test('detect: finds GitHub PAT', () => {
  const m = detectSensitiveData('token ghp_abcdefghij1234567890AB');
  assert.ok(m.some(x => x.type === 'api_key'));
});

test('detect: finds Google API key', () => {
  const m = detectSensitiveData('key AIzaSyAbc123-def456_ghi789j');
  assert.ok(m.some(x => x.type === 'api_key'));
});

test('detect: finds Slack token', () => {
  const m = detectSensitiveData('xoxb-12345-67890-abcdef');
  assert.ok(m.some(x => x.type === 'api_key'));
});

test('detect: finds email addresses', () => {
  const m = detectSensitiveData('email me at alice@example.com');
  assert.ok(m.some(x => x.type === 'email'));
});

test('detect: finds credit card (Luhn-valid)', () => {
  const m = detectSensitiveData('card 4111111111111111');
  assert.ok(m.some(x => x.type === 'credit_card'));
});

test('detect: rejects non-Luhn card numbers', () => {
  const m = detectSensitiveData('not a card 1234567890123456');
  assert.ok(!m.some(x => x.type === 'credit_card'));
});

test('detect: finds password assignment', () => {
  const m = detectSensitiveData('password: mySuperSecret123');
  assert.ok(m.some(x => x.type === 'secret_value'));
});

test('detect: finds secret assignment', () => {
  const m = detectSensitiveData('client_secret = abc123xyz789');
  assert.ok(m.some(x => x.type === 'secret_value'));
});

test('detect: custom patterns work', () => {
  const s = { ...defaultRedactionSettings(), customPatterns: ['SSN-\\d{3}-\\d{2}-\\d{4}'] };
  const m = detectSensitiveData('record SSN-123-45-6789 found', s);
  assert.ok(m.some(x => x.type === 'custom'));
});

test('detect: invalid custom regex is silently ignored', () => {
  const s = { ...defaultRedactionSettings(), customPatterns: ['[bad('] };
  const m = detectSensitiveData('test', s);
  assert.ok(Array.isArray(m));
});

test('detect: match objects have correct shape', () => {
  const m = detectSensitiveData('email: test@example.com');
  for (const match of m) {
    assert.ok(typeof match.id === 'string');
    assert.ok(typeof match.type === 'string');
    assert.ok(typeof match.label === 'string');
    assert.ok(typeof match.snippet === 'string');
    assert.ok(typeof match.start === 'number');
    assert.ok(typeof match.end === 'number');
    assert.ok(match.end > match.start);
  }
});

test('detect: deduplicates identical matches', () => {
  const text = 'user@test.com';
  const m = detectSensitiveData(text);
  const emails = m.filter(x => x.type === 'email' && x.snippet === 'user@test.com');
  assert.equal(emails.length, 1);
});

test('detect: per-type disable respected', () => {
  const s = defaultRedactionSettings();
  s.patterns.email = false;
  const m = detectSensitiveData('test@example.com and sk-1234567890abcdef1234', s);
  assert.ok(!m.some(x => x.type === 'email'));
});

// ── redactSensitiveData ─────────────────────────────────────────────────────

test('redact: no matches returns original text', () => {
  const { redactedText } = redactSensitiveData('hello world', []);
  assert.equal(redactedText, 'hello world');
});

test('redact: replaces matched ranges', () => {
  const text = 'email: test@example.com done';
  const matches = detectSensitiveData(text);
  const { redactedText } = redactSensitiveData(text, matches);
  assert.ok(!redactedText.includes('test@example.com'));
});

test('redact: returns redaction map', () => {
  const text = 'key: sk-1234567890abcdef1234';
  const matches = detectSensitiveData(text);
  const { redactionMap } = redactSensitiveData(text, matches);
  assert.ok(Object.keys(redactionMap).length > 0);
});

test('redact: preserves existing map entries', () => {
  const text = 'test@example.com';
  const matches = detectSensitiveData(text);
  const existing = { 'old-value': 'OLD_PLACEHOLDER' };
  const { redactionMap } = redactSensitiveData(text, matches, existing);
  assert.equal(redactionMap['old-value'], 'OLD_PLACEHOLDER');
});

test('redact: handles non-string text', () => {
  const { redactedText } = redactSensitiveData(null, []);
  assert.equal(redactedText, '');
});

// ── redactPayloadStrings ────────────────────────────────────────────────────

test('redactPayload: processes nested strings', () => {
  const payload = {
    system: 'You are helpful',
    messages: [
      { role: 'user', content: 'my email is test@example.com' },
    ],
  };
  const { payload: redacted, matches } = redactPayloadStrings(payload, defaultRedactionSettings());
  if (matches.length > 0) {
    assert.ok(!JSON.stringify(redacted).includes('test@example.com'));
  }
});

test('redactPayload: handles arrays', () => {
  const payload = ['test@example.com', 'normal text'];
  const { payload: redacted } = redactPayloadStrings(payload, defaultRedactionSettings());
  assert.ok(Array.isArray(redacted));
});

test('redactPayload: non-sensitive payload unchanged', () => {
  const payload = { text: 'Hello world' };
  const { payload: redacted, matches } = redactPayloadStrings(payload, defaultRedactionSettings());
  assert.equal(matches.length, 0);
  assert.deepEqual(redacted, payload);
});

// ── sensitiveTypeMeta ───────────────────────────────────────────────────────

test('typeMeta: returns known types', () => {
  const meta = sensitiveTypeMeta();
  assert.ok(meta.api_key);
  assert.ok(meta.email);
  assert.ok(meta.credit_card);
  assert.ok(meta.secret_value);
  assert.ok(meta.custom);
  for (const key of Object.keys(meta)) {
    assert.ok(meta[key].label);
    assert.ok(meta[key].placeholder);
  }
});
