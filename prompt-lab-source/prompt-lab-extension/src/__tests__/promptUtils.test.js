import { describe, expect, it } from 'vitest';
import {
  encodeShare,
  decodeShare,
  extractVars,
  isGhostVar,
  looksSensitive,
  matchesLibrarySearch,
  ngramSimilarity,
  parseEnhancedPayload,
  resolveGhostVars,
  scorePrompt,
  wordDiff,
} from '../promptUtils.js';

// ──────────────────────────────────────────────────────────────────────────────
// extractVars
// ──────────────────────────────────────────────────────────────────────────────
describe('extractVars', () => {
  it('extracts template variables from text', () => {
    const vars = extractVars('Hello {{name}}, welcome to {{place}}');
    expect(vars).toEqual(['name', 'place']);
  });

  it('deduplicates variables', () => {
    const vars = extractVars('{{name}} and {{name}} again');
    expect(vars).toEqual(['name']);
  });

  it('returns empty array for no variables', () => {
    expect(extractVars('No variables here')).toEqual([]);
  });

  it('returns empty array for non-string input', () => {
    expect(extractVars(null)).toEqual([]);
    expect(extractVars(42)).toEqual([]);
    expect(extractVars(undefined)).toEqual([]);
  });

  it('handles variables with spaces', () => {
    const vars = extractVars('{{first name}} and {{last name}}');
    expect(vars).toEqual(['first name', 'last name']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isGhostVar
// ──────────────────────────────────────────────────────────────────────────────
describe('isGhostVar', () => {
  it('recognizes built-in ghost variables', () => {
    expect(isGhostVar('date')).toBe(true);
    expect(isGhostVar('time')).toBe(true);
    expect(isGhostVar('datetime')).toBe(true);
    expect(isGhostVar('timestamp')).toBe(true);
    expect(isGhostVar('year')).toBe(true);
    expect(isGhostVar('clipboard')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isGhostVar('DATE')).toBe(true);
    expect(isGhostVar('Time')).toBe(true);
  });

  it('returns false for non-ghost variables', () => {
    expect(isGhostVar('name')).toBe(false);
    expect(isGhostVar('custom_var')).toBe(false);
    expect(isGhostVar('')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// resolveGhostVars
// ──────────────────────────────────────────────────────────────────────────────
describe('resolveGhostVars', () => {
  it('resolves date-related ghost vars', async () => {
    const result = await resolveGhostVars(['date', 'year', 'timestamp']);
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.year).toMatch(/^\d{4}$/);
    expect(result.timestamp).toMatch(/^\d+$/);
  });

  it('ignores non-ghost vars', async () => {
    const result = await resolveGhostVars(['name', 'date']);
    expect(result).not.toHaveProperty('name');
    expect(result).toHaveProperty('date');
  });

  it('handles empty input', async () => {
    const result = await resolveGhostVars([]);
    expect(result).toEqual({});
  });

  it('handles non-array input', async () => {
    const result = await resolveGhostVars(null);
    expect(result).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// scorePrompt
// ──────────────────────────────────────────────────────────────────────────────
describe('scorePrompt', () => {
  it('returns null for empty/non-string input', () => {
    expect(scorePrompt('')).toBeNull();
    expect(scorePrompt('   ')).toBeNull();
    expect(scorePrompt(null)).toBeNull();
    expect(scorePrompt(42)).toBeNull();
  });

  it('scores a basic prompt', () => {
    const result = scorePrompt('Write a haiku');
    expect(result).not.toBeNull();
    expect(result.task).toBe(true); // "Write" matches task pattern
    expect(result.points).toBeGreaterThan(0);
    expect(result.maxPoints).toBe(5);
  });

  it('detects role assignment', () => {
    const result = scorePrompt('You are an expert writer. Create a blog post about AI.');
    expect(result.role).toBe(true);
    expect(result.task).toBe(true);
  });

  it('detects format requirements', () => {
    const result = scorePrompt('Return the result as a JSON object');
    expect(result.format).toBe(true);
  });

  it('detects constraints', () => {
    const result = scorePrompt('Do not include personal opinions. Always cite sources.');
    expect(result.constraints).toBe(true);
  });

  it('awards context point for long prompts', () => {
    const longPrompt = 'A'.repeat(81);
    const result = scorePrompt(longPrompt);
    expect(result.context).toBe(true);
  });

  it('estimates token count', () => {
    const result = scorePrompt('Hello world this is a test');
    expect(result.tokens).toBe(Math.round('Hello world this is a test'.length / 4));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// encodeShare / decodeShare
// ──────────────────────────────────────────────────────────────────────────────
describe('encodeShare / decodeShare', () => {
  it('roundtrips a share payload', () => {
    const entry = {
      title: 'Test Prompt',
      original: 'Original text',
      enhanced: 'Enhanced text',
      variants: [{ label: 'V1', content: 'Variant content' }],
      tags: ['Code'],
      notes: 'Some notes',
    };
    const encoded = encodeShare(entry);
    expect(encoded).toBeTruthy();
    const decoded = decodeShare(encoded);
    expect(decoded.title).toBe(entry.title);
    expect(decoded.enhanced).toBe(entry.enhanced);
    expect(decoded.variants).toEqual(entry.variants);
    expect(decoded.tags).toEqual(entry.tags);
  });

  it('handles unicode characters', () => {
    const entry = {
      title: '日本語テスト',
      original: 'Café résumé',
      enhanced: '中文 emoji 🎉',
      variants: [],
      tags: [],
      notes: '',
    };
    const encoded = encodeShare(entry);
    const decoded = decodeShare(encoded);
    expect(decoded.title).toBe(entry.title);
    expect(decoded.enhanced).toBe(entry.enhanced);
  });

  it('decodeShare returns null for invalid input', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('not-valid-base64!!!')).toBeNull();
    expect(decodeShare(null)).toBeNull();
  });

  it('encodeShare handles entries with undefined fields', () => {
    // encodeShare extracts specific fields, so this should still produce valid output
    const entry = { title: 'Test', original: undefined, enhanced: 'Content' };
    const encoded = encodeShare(entry);
    expect(encoded).toBeTruthy();
    const decoded = decodeShare(encoded);
    expect(decoded.title).toBe('Test');
    expect(decoded.enhanced).toBe('Content');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// looksSensitive
// ──────────────────────────────────────────────────────────────────────────────
describe('looksSensitive', () => {
  it('detects API keys', () => {
    expect(looksSensitive('my api_key is sk-abc123')).toBe(true);
    expect(looksSensitive('sk-ant-api03-something')).toBe(true);
  });

  it('detects passwords', () => {
    expect(looksSensitive('password: secret123')).toBe(true);
  });

  it('detects bearer tokens', () => {
    expect(looksSensitive('Authorization: Bearer eyJ...')).toBe(true);
  });

  it('detects access tokens', () => {
    expect(looksSensitive('access_token=abc123')).toBe(true);
  });

  it('returns false for safe text', () => {
    expect(looksSensitive('Write a blog post about cats')).toBe(false);
    expect(looksSensitive('')).toBe(false);
  });

  it('handles non-string input', () => {
    expect(looksSensitive(null)).toBe(false);
    expect(looksSensitive(42)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// parseEnhancedPayload
// ──────────────────────────────────────────────────────────────────────────────
describe('parseEnhancedPayload', () => {
  it('parses valid JSON payload', () => {
    const json = JSON.stringify({
      enhanced: 'Enhanced prompt text',
      variants: [{ label: 'V1', content: 'Variant 1' }],
      notes: 'Some notes',
      assumptions: ['Assumed formal tone'],
      tags: ['Writing'],
    });
    const result = parseEnhancedPayload(json);
    expect(result.enhanced).toBe('Enhanced prompt text');
    expect(result.variants).toHaveLength(1);
    expect(result.notes).toBe('Some notes');
  });

  it('strips markdown code fences', () => {
    const json = '```json\n{"enhanced":"Hello","variants":[],"notes":"","assumptions":[],"tags":[]}\n```';
    const result = parseEnhancedPayload(json);
    expect(result.enhanced).toBe('Hello');
  });

  it('extracts JSON from surrounding text', () => {
    const json = 'Here is the result: {"enhanced":"Hello","variants":[],"notes":"","assumptions":[],"tags":[]} Hope this helps!';
    const result = parseEnhancedPayload(json);
    expect(result.enhanced).toBe('Hello');
  });

  it('throws on empty content', () => {
    expect(() => parseEnhancedPayload('')).toThrow();
    expect(() => parseEnhancedPayload(null)).toThrow();
  });

  it('throws on non-JSON content', () => {
    expect(() => parseEnhancedPayload('This is not JSON at all')).toThrow();
  });

  it('throws when enhanced field is missing', () => {
    expect(() => parseEnhancedPayload('{"notes":"only notes"}')).toThrow();
  });

  it('throws when enhanced field is empty', () => {
    expect(() => parseEnhancedPayload('{"enhanced":"","notes":"notes"}')).toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// wordDiff
// ──────────────────────────────────────────────────────────────────────────────
describe('wordDiff', () => {
  it('returns single eq token for identical empty strings', () => {
    // ''.split(' ') produces [''], so diff returns one eq token for the empty word
    expect(wordDiff('', '')).toEqual([{ t: 'eq', v: '' }]);
  });

  it('detects all-equal words', () => {
    const result = wordDiff('hello world', 'hello world');
    expect(result.every((r) => r.t === 'eq')).toBe(true);
  });

  it('detects additions', () => {
    const result = wordDiff('hello', 'hello world');
    expect(result.some((r) => r.t === 'add' && r.v === 'world')).toBe(true);
  });

  it('detects deletions', () => {
    const result = wordDiff('hello world', 'hello');
    expect(result.some((r) => r.t === 'del' && r.v === 'world')).toBe(true);
  });

  it('handles null/undefined gracefully', () => {
    // null → '' → split(' ') → [''] so there's a del '' plus an add 'hello'
    const result1 = wordDiff(null, 'hello');
    expect(result1.some((r) => r.t === 'add' && r.v === 'hello')).toBe(true);

    const result2 = wordDiff('hello', null);
    expect(result2.some((r) => r.t === 'del' && r.v === 'hello')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ngramSimilarity
// ──────────────────────────────────────────────────────────────────────────────
describe('ngramSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(ngramSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 0 for completely different strings', () => {
    const result = ngramSimilarity('abc', 'xyz');
    expect(result).toBe(0);
  });

  it('returns 1 for both empty', () => {
    expect(ngramSimilarity('', '')).toBe(1);
  });

  it('returns 0 for one empty', () => {
    expect(ngramSimilarity('hello', '')).toBe(0);
    expect(ngramSimilarity('', 'hello')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(ngramSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('returns value between 0 and 1 for similar strings', () => {
    const result = ngramSimilarity('hello world', 'hello earth');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });
});
