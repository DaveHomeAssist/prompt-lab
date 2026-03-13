import { describe, it, expect } from 'vitest';
import { ensureString, randomId, hashText, luhnPasses, normalizeVariant, safeDate } from '../lib/utils.js';

describe('ensureString', () => {
  it('returns string values unchanged', () => {
    expect(ensureString('hello')).toBe('hello');
  });
  it('returns empty string for non-strings', () => {
    expect(ensureString(42)).toBe('');
    expect(ensureString(null)).toBe('');
    expect(ensureString(undefined)).toBe('');
    expect(ensureString({})).toBe('');
  });
});

describe('randomId', () => {
  it('returns a non-empty string', () => {
    const id = randomId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });
  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(ids.size).toBe(50);
  });
});

describe('hashText', () => {
  it('returns deterministic hash with h_ prefix', () => {
    const h = hashText('hello');
    expect(h).toMatch(/^h_[0-9a-f]+$/);
    expect(hashText('hello')).toBe(h);
  });
  it('differs for different inputs', () => {
    expect(hashText('a')).not.toBe(hashText('b'));
  });
  it('handles empty/null', () => {
    expect(hashText('')).toMatch(/^h_/);
    expect(hashText(null)).toMatch(/^h_/);
  });
});

describe('luhnPasses', () => {
  it('validates a known good card number', () => {
    expect(luhnPasses('4111111111111111')).toBe(true);
  });
  it('rejects an invalid number', () => {
    expect(luhnPasses('4111111111111112')).toBe(false);
  });
  it('rejects too-short numbers', () => {
    expect(luhnPasses('123456')).toBe(false);
  });
});

describe('normalizeVariant', () => {
  it('normalizes a valid variant', () => {
    expect(normalizeVariant({ label: 'A', content: 'x' })).toEqual({ label: 'A', content: 'x' });
  });
  it('defaults label to Variant', () => {
    expect(normalizeVariant({ content: 'x' })).toEqual({ label: 'Variant', content: 'x' });
  });
  it('handles null/undefined', () => {
    expect(normalizeVariant(null)).toEqual({ label: 'Variant', content: '' });
  });
});

describe('safeDate', () => {
  it('parses a valid ISO string', () => {
    expect(safeDate('2024-01-15T12:00:00Z')).toBe('2024-01-15T12:00:00.000Z');
  });
  it('returns current date for invalid input', () => {
    const d = safeDate('not-a-date');
    expect(new Date(d).getTime()).toBeGreaterThan(0);
  });
});
