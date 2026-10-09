import test from 'node:test';
import assert from 'node:assert/strict';
import { wordDiff, scorePrompt, extractVars, encodeShare, decodeShare, extractTextFromAnthropic,
  parseEnhancedPayload, suggestTitleFromText, normalizeLibrary, looksSensitive, isTransientError } from '../src/promptUtils.js';
import { ensureString, safeDate } from '../src/lib/utils.js';
import { normalizeEntry } from '../src/lib/promptSchema.js';

test('wordDiff: identical strings return all "eq"', () => { assert.ok(wordDiff('hello world', 'hello world').every(d => d.t === 'eq')); });
test('wordDiff: completely different strings', () => {
  const result = wordDiff('foo', 'bar'); assert.ok(result.some(d => d.t === 'add')); assert.ok(result.some(d => d.t === 'del'));
});
test('wordDiff: additions retain whitespace', () => {
  assert.equal(wordDiff('hello', 'hello world').filter(d => d.t === 'add').map(d => d.v).join(''), ' world');
});
test('wordDiff: deletions retain whitespace', () => {
  assert.equal(wordDiff('hello world', 'hello').filter(d => d.t === 'del').map(d => d.v).join(''), ' world');
});
test('wordDiff: handles empty strings', () => {
  const result = wordDiff('', ''); assert.equal(result.length, 1); assert.equal(result[0].t, 'eq');
});
test('wordDiff: handles non-strings gracefully', () => { assert.ok(Array.isArray(wordDiff(null, undefined))); });
test('wordDiff: retains all words and a change beyond word 200', () => {
  const long = Array(300).fill('word').join(' ');
  const before = `${long} final A`; const after = `${long} final B`;
  const result = wordDiff(before, after);
  assert.equal(result.filter(d => d.t !== 'add').map(d => d.v).join(''), before);
  assert.equal(result.filter(d => d.t !== 'del').map(d => d.v).join(''), after);
  assert.ok(result.some(d => d.t === 'add' && d.v.includes('B')));
});
test('scorePrompt: detects role patterns', () => { assert.equal(scorePrompt('You are a helpful assistant.').role, true); });
test('scorePrompt: detects task patterns', () => {
  assert.equal(scorePrompt('Please write a summary.').task, true); assert.equal(scorePrompt('Generate a report.').task, true); assert.equal(scorePrompt('Analyze the data.').task, true);
});
test('scorePrompt: detects format patterns', () => {
  assert.equal(scorePrompt('Return as JSON.').format, true); assert.equal(scorePrompt('Use markdown format.').format, true); assert.equal(scorePrompt('Output a table.').format, true);
});
test('scorePrompt: detects constraint patterns', () => {
  assert.equal(scorePrompt('Do not include personal info.').constraints, true); assert.equal(scorePrompt('You must be concise.').constraints, true); assert.equal(scorePrompt('Always use formal tone.').constraints, true);
});
test('scorePrompt: context true for long text', () => { assert.equal(scorePrompt('x'.repeat(81)).context, true); assert.equal(scorePrompt('x'.repeat(80)).context, false); });
test('scorePrompt: token count approximation', () => {
  const s = scorePrompt('Hello world, this is a test prompt.'); assert.ok(s.tokens > 0); assert.equal(s.tokens, Math.round('Hello world, this is a test prompt.'.length / 4));
});
test('extractVars: multiple unique vars', () => { assert.deepEqual(extractVars('{{a}} {{b}} {{c}}'), ['a', 'b', 'c']); });
test('extractVars: deduplicates', () => { assert.deepEqual(extractVars('{{x}} {{x}} {{y}}'), ['x', 'y']); });
test('extractVars: supports spaces in var names', () => { assert.deepEqual(extractVars('{{first name}}'), ['first name']); });
test('extractVars: no false positives on single braces', () => { assert.deepEqual(extractVars('{not a var}'), []); });
test('share: roundtrip encode/decode', () => {
  const encoded = encodeShare({ title: 'Test', original: 'hello', enhanced: 'world', tags: ['Code'] });
  assert.ok(typeof encoded === 'string'); const decoded = decodeShare(encoded);
  assert.equal(decoded.title, 'Test'); assert.equal(decoded.original, 'hello'); assert.deepEqual(decoded.tags, ['Code']);
});
test('share: handles unicode', () => {
  const decoded = decodeShare(encodeShare({ title: 'Émojis 🎉', original: 'café', enhanced: '日本語' }));
  assert.equal(decoded.title, 'Émojis 🎉'); assert.equal(decoded.enhanced, '日本語');
});
test('share: decodeShare returns null on garbage', () => { assert.equal(decodeShare('not-valid-base64!!!'), null); assert.equal(decodeShare(''), null); });
test('share: encodeShare strips extra fields', () => { assert.equal(decodeShare(encodeShare({ title: 'T', original: 'O', enhanced: 'E', secretField: 'leaked' })).secretField, undefined); });
test('extract: normal content array', () => { assert.equal(extractTextFromAnthropic({ content: [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }] }), 'hello world'); });
test('extract: throws on error field', () => { assert.throws(() => extractTextFromAnthropic({ error: { message: 'bad' } }), /bad/); });
test('extract: throws on missing content', () => { assert.throws(() => extractTextFromAnthropic({}), /no.*text.*content/i); });
test('extract: throws on empty content', () => { assert.throws(() => extractTextFromAnthropic({ content: [{ text: '' }] }), /no.*content/i); });
test('extract: handles mixed block types', () => { assert.equal(extractTextFromAnthropic({ content: [{ type: 'text', text: 'ok' }, { type: 'image', url: '...' }] }), 'ok'); });
test('parse: clean JSON', () => { assert.equal(parseEnhancedPayload('{"enhanced":"yes"}').enhanced, 'yes'); });
test('parse: JSON in markdown code fence', () => { assert.equal(parseEnhancedPayload('```json\n{"enhanced":"val"}\n```').enhanced, 'val'); });
test('parse: JSON with leading/trailing noise', () => { assert.equal(parseEnhancedPayload('Here is the result: {"enhanced":"cleaned up"} hope that helps!').enhanced, 'cleaned up'); });
test('parse: throws on empty', () => { assert.throws(() => parseEnhancedPayload(''), /empty/i); assert.throws(() => parseEnhancedPayload(null), /empty/i); });
test('parse: throws on non-JSON', () => { assert.throws(() => parseEnhancedPayload('This is just plain text without any JSON'), /not valid JSON/i); });
test('parse: stringifies object-shaped prompt fields', () => {
  const r = parseEnhancedPayload(JSON.stringify({
    enhanced: { role: 'expert', task: 'analyze', clarity_specificity: 'high', format: 'report', constraints: 'strict' },
    variants: [{ label: 'Variant A', content: { role: 'reviewer', task: 'audit' } }, { role: 'fallback', task: 'summarize' }],
    notes: { source: 'model' }, tags: ['Analysis', { type: 'Other' }],
  }));
  assert.match(r.enhanced, /role: expert/); assert.equal(r.variants[0].label, 'Variant A'); assert.match(r.variants[0].content, /role: reviewer/);
  assert.equal(r.variants[1].label, 'Variant'); assert.match(r.variants[1].content, /role: fallback/);
  assert.match(r.notes, /source: model/); assert.equal(r.tags[0], 'Analysis'); assert.match(r.tags[1], /type: Other/);
});
test('ensureString: returns strings as-is', () => { assert.equal(ensureString('hello'), 'hello'); assert.equal(ensureString(''), ''); });
test('ensureString: returns empty for non-strings', () => { for (const value of [null, 42, undefined, {}]) assert.equal(ensureString(value), ''); });
test('safeDate: valid ISO string returns ISO', () => { assert.equal(safeDate('2026-01-01T00:00:00Z'), '2026-01-01T00:00:00.000Z'); });
test('safeDate: invalid date returns current ISO', () => { assert.ok(safeDate('not-a-date').match(/^\d{4}-\d{2}-\d{2}T/)); });
test('safeDate: null returns current ISO', () => { assert.ok(safeDate(null).match(/^\d{4}-\d{2}-\d{2}T/)); });
test('suggestTitle: short text returned as-is', () => { assert.equal(suggestTitleFromText('My prompt'), 'My prompt'); });
test('suggestTitle: long text truncated with ellipsis', () => { const t = suggestTitleFromText('a'.repeat(100)); assert.ok(t.length <= 73); assert.ok(t.endsWith('…')); });
test('suggestTitle: whitespace collapsed and first letter capitalized', () => { assert.equal(suggestTitleFromText('  hello   world  '), 'Hello world'); });
test('suggestTitle: empty returns "Untitled Prompt"', () => { assert.equal(suggestTitleFromText(''), 'Untitled Prompt'); assert.equal(suggestTitleFromText('   '), 'Untitled Prompt'); });
test('normalizeEntry: valid minimal entry', () => { const e = normalizeEntry({ original: 'hello' }); assert.ok(e); assert.ok(e.id); assert.equal(e.original, 'hello'); assert.equal(e.enhanced, 'hello'); });
test('normalizeEntry: variants normalized', () => {
  const e = normalizeEntry({ original: 'test', variants: [{ label: 'V1', content: 'content1' }, { label: '', content: '' }, { content: 'content3' }] });
  assert.equal(e.variants.length, 2); assert.equal(e.variants[1].label, 'Variant');
});
test('normalizeEntry: versions normalized', () => {
  const e = normalizeEntry({ original: 'test', versions: [{ enhanced: 'v1', savedAt: '2026-01-01' }, { enhanced: '', savedAt: '2026-01-02' }] }); assert.equal(e.versions.length, 1);
});
test('normalizeEntry: collection field preserved', () => { assert.equal(normalizeEntry({ original: 'test', collection: 'My Collection' }).collection, 'My Collection'); });
test('normalizeEntry: non-finite useCount defaults to 0', () => { for (const useCount of [NaN, Infinity, 'abc']) assert.equal(normalizeEntry({ original: 'x', useCount }).useCount, 0); });
test('normalizeLibrary: non-array returns empty', () => { for (const value of [null, 'string', 42]) assert.deepEqual(normalizeLibrary(value), []); });
test('normalizeLibrary: filters out invalid entries', () => { assert.equal(normalizeLibrary([{ original: 'good' }, null, { title: 'no content' }, 42]).length, 1); });
test('normalizeLibrary: deduplicates IDs', () => {
  const result = normalizeLibrary([{ id: 'same', original: 'a' }, { id: 'same', original: 'b' }, { id: 'same', original: 'c' }]); assert.equal(new Set(result.map(e => e.id)).size, 3);
});
test('normalizeLibrary: preserves order', () => {
  const result = normalizeLibrary([{ id: 'first', original: 'a' }, { id: 'second', original: 'b' }]); assert.equal(result[0].id, 'first'); assert.equal(result[1].id, 'second');
});
test('looksSensitive: detects api_key pattern', () => { assert.equal(looksSensitive('my api_key is here'), true); assert.equal(looksSensitive('api-key = abc123'), true); });
test('looksSensitive: detects bearer token', () => { assert.equal(looksSensitive('Authorization: Bearer xyz'), true); });
test('looksSensitive: detects password', () => { assert.equal(looksSensitive('password: secret123'), true); });
test('looksSensitive: detects access_token', () => { assert.equal(looksSensitive('access_token=xyz'), true); });
test('looksSensitive: false for normal text', () => { assert.equal(looksSensitive('The weather is sunny today.'), false); });
test('looksSensitive: handles non-string', () => { assert.equal(looksSensitive(null), false); assert.equal(looksSensitive(42), false); });
test('isTransientError: rate limit is NOT transient', () => { assert.equal(isTransientError(new Error('Rate limit exceeded')), false); });
test('isTransientError: words containing "rate" are NOT transient', () => { assert.equal(isTransientError(new Error('Failed to generate a response')), false); });
test('isTransientError: timeout is transient', () => { assert.equal(isTransientError(new Error('Request timeout')), true); });
test('isTransientError: network error is transient', () => { assert.equal(isTransientError(new Error('Network error')), true); });
test('isTransientError: failed to fetch is transient', () => { assert.equal(isTransientError(new Error('Failed to fetch')), true); });
test('isTransientError: temporary is transient', () => { assert.equal(isTransientError(new Error('Temporary server error')), true); });
test('isTransientError: auth error is NOT transient', () => { assert.equal(isTransientError(new Error('Invalid API key')), false); });
test('isTransientError: handles string input', () => { assert.equal(isTransientError('network failure'), true); });
test('isTransientError: handles null', () => { assert.equal(isTransientError(null), false); });
