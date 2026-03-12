import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wordDiff,
  scorePrompt,
  extractVars,
  encodeShare,
  decodeShare,
  extractTextFromAnthropic,
  parseEnhancedPayload,
  ensureString,
  safeDate,
  suggestTitleFromText,
  normalizeEntry,
  normalizeLibrary,
  looksSensitive,
  isTransientError,
} from '../src/promptUtils.js';

// ── wordDiff ────────────────────────────────────────────────────────────────

test('wordDiff: identical strings return all "eq"', () => {
  const result = wordDiff('hello world', 'hello world');
  assert.ok(result.every(d => d.t === 'eq'));
});

test('wordDiff: completely different strings', () => {
  const result = wordDiff('foo', 'bar');
  assert.ok(result.some(d => d.t === 'add'));
  assert.ok(result.some(d => d.t === 'del'));
});

test('wordDiff: additions detected', () => {
  const result = wordDiff('hello', 'hello world');
  assert.ok(result.some(d => d.t === 'add' && d.v === 'world'));
});

test('wordDiff: deletions detected', () => {
  const result = wordDiff('hello world', 'hello');
  assert.ok(result.some(d => d.t === 'del' && d.v === 'world'));
});

test('wordDiff: handles empty strings', () => {
  // ''.split(' ') => [''], so diff produces one eq entry for ''
  const result = wordDiff('', '');
  assert.equal(result.length, 1);
  assert.equal(result[0].t, 'eq');
});

test('wordDiff: handles non-strings gracefully', () => {
  const result = wordDiff(null, undefined);
  assert.ok(Array.isArray(result));
});

test('wordDiff: truncates at 200 words per side', () => {
  const long = Array(300).fill('word').join(' ');
  const result = wordDiff(long, long);
  assert.ok(result.length <= 200);
});

// ── scorePrompt (extended) ──────────────────────────────────────────────────

test('scorePrompt: detects role patterns', () => {
  const s = scorePrompt('You are a helpful assistant.');
  assert.equal(s.role, true);
});

test('scorePrompt: detects task patterns', () => {
  assert.equal(scorePrompt('Please write a summary.').task, true);
  assert.equal(scorePrompt('Generate a report.').task, true);
  assert.equal(scorePrompt('Analyze the data.').task, true);
});

test('scorePrompt: detects format patterns', () => {
  assert.equal(scorePrompt('Return as JSON.').format, true);
  assert.equal(scorePrompt('Use markdown format.').format, true);
  assert.equal(scorePrompt('Output a table.').format, true);
});

test('scorePrompt: detects constraint patterns', () => {
  assert.equal(scorePrompt('Do not include personal info.').constraints, true);
  assert.equal(scorePrompt('You must be concise.').constraints, true);
  assert.equal(scorePrompt('Always use formal tone.').constraints, true);
});

test('scorePrompt: context true for long text', () => {
  assert.equal(scorePrompt('x'.repeat(81)).context, true);
  assert.equal(scorePrompt('x'.repeat(80)).context, false);
});

test('scorePrompt: token count approximation', () => {
  const s = scorePrompt('Hello world, this is a test prompt.');
  assert.ok(s.tokens > 0);
  assert.equal(s.tokens, Math.round('Hello world, this is a test prompt.'.length / 4));
});

// ── extractVars (extended) ──────────────────────────────────────────────────

test('extractVars: multiple unique vars', () => {
  assert.deepEqual(extractVars('{{a}} {{b}} {{c}}'), ['a', 'b', 'c']);
});

test('extractVars: deduplicates', () => {
  assert.deepEqual(extractVars('{{x}} {{x}} {{y}}'), ['x', 'y']);
});

test('extractVars: supports spaces in var names', () => {
  assert.deepEqual(extractVars('{{first name}}'), ['first name']);
});

test('extractVars: no false positives on single braces', () => {
  assert.deepEqual(extractVars('{not a var}'), []);
});

// ── encodeShare / decodeShare ───────────────────────────────────────────────

test('share: roundtrip encode/decode', () => {
  const entry = { title: 'Test', original: 'hello', enhanced: 'world', tags: ['Code'] };
  const encoded = encodeShare(entry);
  assert.ok(typeof encoded === 'string');
  const decoded = decodeShare(encoded);
  assert.equal(decoded.title, 'Test');
  assert.equal(decoded.original, 'hello');
  assert.deepEqual(decoded.tags, ['Code']);
});

test('share: handles unicode', () => {
  const entry = { title: 'Émojis 🎉', original: 'café', enhanced: '日本語' };
  const encoded = encodeShare(entry);
  const decoded = decodeShare(encoded);
  assert.equal(decoded.title, 'Émojis 🎉');
  assert.equal(decoded.enhanced, '日本語');
});

test('share: decodeShare returns null on garbage', () => {
  assert.equal(decodeShare('not-valid-base64!!!'), null);
  assert.equal(decodeShare(''), null);
});

test('share: encodeShare strips extra fields', () => {
  const entry = { title: 'T', original: 'O', enhanced: 'E', secretField: 'leaked' };
  const decoded = decodeShare(encodeShare(entry));
  assert.equal(decoded.secretField, undefined);
});

// ── extractTextFromAnthropic ────────────────────────────────────────────────

test('extract: normal content array', () => {
  const data = { content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }] };
  assert.equal(extractTextFromAnthropic(data), 'hello world');
});

test('extract: throws on error field', () => {
  assert.throws(() => extractTextFromAnthropic({ error: { message: 'bad' } }), /bad/);
});

test('extract: throws on missing content', () => {
  assert.throws(() => extractTextFromAnthropic({}), /no content/i);
});

test('extract: throws on empty content', () => {
  assert.throws(() => extractTextFromAnthropic({ content: [{ text: '' }] }), /empty/i);
});

test('extract: handles mixed block types', () => {
  const data = { content: [{ type: 'text', text: 'ok' }, { type: 'image', url: '...' }] };
  assert.equal(extractTextFromAnthropic(data), 'ok');
});

// ── parseEnhancedPayload (extended) ─────────────────────────────────────────

test('parse: clean JSON', () => {
  const r = parseEnhancedPayload('{"enhanced":"yes"}');
  assert.equal(r.enhanced, 'yes');
});

test('parse: JSON in markdown code fence', () => {
  const r = parseEnhancedPayload('```json\n{"key":"val"}\n```');
  assert.equal(r.key, 'val');
});

test('parse: JSON with leading/trailing noise', () => {
  const r = parseEnhancedPayload('Here is the result: {"x":1} hope that helps!');
  assert.equal(r.x, 1);
});

test('parse: throws on empty', () => {
  assert.throws(() => parseEnhancedPayload(''), /empty/i);
  assert.throws(() => parseEnhancedPayload(null), /empty/i);
});

test('parse: throws on non-JSON', () => {
  assert.throws(() => parseEnhancedPayload('This is just plain text without any JSON'), /not valid JSON/i);
});

// ── ensureString ────────────────────────────────────────────────────────────

test('ensureString: returns strings as-is', () => {
  assert.equal(ensureString('hello'), 'hello');
  assert.equal(ensureString(''), '');
});

test('ensureString: returns empty for non-strings', () => {
  assert.equal(ensureString(null), '');
  assert.equal(ensureString(42), '');
  assert.equal(ensureString(undefined), '');
  assert.equal(ensureString({}), '');
});

// ── safeDate ────────────────────────────────────────────────────────────────

test('safeDate: valid ISO string returns ISO', () => {
  const d = safeDate('2026-01-01T00:00:00Z');
  assert.equal(d, '2026-01-01T00:00:00.000Z');
});

test('safeDate: invalid date returns current ISO', () => {
  const d = safeDate('not-a-date');
  assert.ok(d.match(/^\d{4}-\d{2}-\d{2}T/));
});

test('safeDate: null returns current ISO', () => {
  const d = safeDate(null);
  assert.ok(d.match(/^\d{4}-\d{2}-\d{2}T/));
});

// ── suggestTitleFromText (extended) ─────────────────────────────────────────

test('suggestTitle: short text returned as-is', () => {
  assert.equal(suggestTitleFromText('My prompt'), 'My prompt');
});

test('suggestTitle: long text truncated with ellipsis', () => {
  const t = suggestTitleFromText('a'.repeat(100));
  assert.ok(t.length <= 73);
  assert.ok(t.endsWith('…'));
});

test('suggestTitle: whitespace collapsed', () => {
  assert.equal(suggestTitleFromText('  hello   world  '), 'hello world');
});

test('suggestTitle: empty returns "Untitled Prompt"', () => {
  assert.equal(suggestTitleFromText(''), 'Untitled Prompt');
  assert.equal(suggestTitleFromText('   '), 'Untitled Prompt');
});

// ── normalizeEntry (extended) ────────────────────────────────────────────────

test('normalizeEntry: valid minimal entry', () => {
  const e = normalizeEntry({ original: 'hello' });
  assert.ok(e);
  assert.ok(e.id);
  assert.equal(e.original, 'hello');
  assert.equal(e.enhanced, 'hello'); // falls back to original
});

test('normalizeEntry: variants normalized', () => {
  const e = normalizeEntry({
    original: 'test',
    variants: [
      { label: 'V1', content: 'content1' },
      { label: '', content: '' },
      { content: 'content3' },
    ],
  });
  assert.equal(e.variants.length, 2); // empty content filtered
  assert.equal(e.variants[1].label, 'Variant'); // default label
});

test('normalizeEntry: versions normalized', () => {
  const e = normalizeEntry({
    original: 'test',
    versions: [
      { enhanced: 'v1', savedAt: '2026-01-01' },
      { enhanced: '', savedAt: '2026-01-02' },
    ],
  });
  assert.equal(e.versions.length, 1); // empty enhanced filtered
});

test('normalizeEntry: collection field preserved', () => {
  const e = normalizeEntry({ original: 'test', collection: 'My Collection' });
  assert.equal(e.collection, 'My Collection');
});

test('normalizeEntry: non-finite useCount defaults to 0', () => {
  assert.equal(normalizeEntry({ original: 'x', useCount: NaN }).useCount, 0);
  assert.equal(normalizeEntry({ original: 'x', useCount: Infinity }).useCount, 0);
  assert.equal(normalizeEntry({ original: 'x', useCount: 'abc' }).useCount, 0);
});

// ── normalizeLibrary (extended) ──────────────────────────────────────────────

test('normalizeLibrary: non-array returns empty', () => {
  assert.deepEqual(normalizeLibrary(null), []);
  assert.deepEqual(normalizeLibrary('string'), []);
  assert.deepEqual(normalizeLibrary(42), []);
});

test('normalizeLibrary: filters out invalid entries', () => {
  const result = normalizeLibrary([
    { original: 'good' },
    null,
    { title: 'no content' },
    42,
  ]);
  assert.equal(result.length, 1);
});

test('normalizeLibrary: deduplicates IDs', () => {
  const result = normalizeLibrary([
    { id: 'same', original: 'a' },
    { id: 'same', original: 'b' },
    { id: 'same', original: 'c' },
  ]);
  const ids = result.map(e => e.id);
  assert.equal(new Set(ids).size, 3);
});

test('normalizeLibrary: preserves order', () => {
  const result = normalizeLibrary([
    { id: 'first', original: 'a' },
    { id: 'second', original: 'b' },
  ]);
  assert.equal(result[0].id, 'first');
  assert.equal(result[1].id, 'second');
});

// ── looksSensitive (extended) ────────────────────────────────────────────────

test('looksSensitive: detects api_key pattern', () => {
  assert.equal(looksSensitive('my api_key is here'), true);
  assert.equal(looksSensitive('api-key = abc123'), true);
});

test('looksSensitive: detects bearer token', () => {
  assert.equal(looksSensitive('Authorization: Bearer xyz'), true);
});

test('looksSensitive: detects password', () => {
  assert.equal(looksSensitive('password: secret123'), true);
});

test('looksSensitive: detects access_token', () => {
  assert.equal(looksSensitive('access_token=xyz'), true);
});

test('looksSensitive: false for normal text', () => {
  assert.equal(looksSensitive('The weather is sunny today.'), false);
});

test('looksSensitive: handles non-string', () => {
  assert.equal(looksSensitive(null), false);
  assert.equal(looksSensitive(42), false);
});

// ── isTransientError (extended) ──────────────────────────────────────────────

test('isTransientError: 429 is transient', () => {
  assert.equal(isTransientError(new Error('429 Too Many Requests')), true);
});

test('isTransientError: rate limit is transient', () => {
  assert.equal(isTransientError(new Error('Rate limit exceeded')), true);
});

test('isTransientError: timeout is transient', () => {
  assert.equal(isTransientError(new Error('Request timeout')), true);
});

test('isTransientError: network error is transient', () => {
  assert.equal(isTransientError(new Error('Network error')), true);
});

test('isTransientError: failed to fetch is transient', () => {
  assert.equal(isTransientError(new Error('Failed to fetch')), true);
});

test('isTransientError: temporary is transient', () => {
  assert.equal(isTransientError(new Error('Temporary server error')), true);
});

test('isTransientError: auth error is NOT transient', () => {
  assert.equal(isTransientError(new Error('Invalid API key')), false);
});

test('isTransientError: handles string input', () => {
  assert.equal(isTransientError('network failure'), true);
});

test('isTransientError: handles null', () => {
  assert.equal(isTransientError(null), false);
});
