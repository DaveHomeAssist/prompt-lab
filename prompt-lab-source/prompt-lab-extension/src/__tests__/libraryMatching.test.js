import { describe, expect, it } from 'vitest';
import {
  getLibraryEntrySignature,
  matchesLibrarySearch,
  mergeLibraryEntries,
} from '../lib/libraryMatching.js';
import { createPromptEntry } from '../lib/promptSchema.js';

const NOW = '2026-04-10T12:00:00.000Z';

function makeEntry(overrides = {}) {
  return createPromptEntry({
    title: 'Test Prompt',
    original: 'Original body text',
    enhanced: 'Enhanced body text',
    notes: '',
    tags: [],
    collection: '',
    ...overrides,
  }, { now: NOW });
}

// ──────────────────────────────────────────────────────────────────────────────
// getLibraryEntrySignature
// ──────────────────────────────────────────────────────────────────────────────
describe('getLibraryEntrySignature', () => {
  it('returns empty string for null/undefined entry', () => {
    expect(getLibraryEntrySignature(null)).toBe('');
    expect(getLibraryEntrySignature(undefined)).toBe('');
  });

  it('returns empty string for entry with no body', () => {
    expect(getLibraryEntrySignature({ enhanced: '', original: '' })).toBe('');
  });

  it('produces stable hash for same content', () => {
    const a = makeEntry({ enhanced: 'Hello world' });
    const b = makeEntry({ enhanced: 'Hello world', id: 'different-id', title: 'Different Title' });
    expect(getLibraryEntrySignature(a)).toBe(getLibraryEntrySignature(b));
  });

  it('produces different hashes for different content', () => {
    const a = makeEntry({ enhanced: 'Hello world' });
    const b = makeEntry({ enhanced: 'Goodbye world' });
    expect(getLibraryEntrySignature(a)).not.toBe(getLibraryEntrySignature(b));
  });

  it('normalizes whitespace before hashing', () => {
    const a = makeEntry({ enhanced: 'Hello   world\n\t here' });
    const b = makeEntry({ enhanced: 'Hello world here' });
    expect(getLibraryEntrySignature(a)).toBe(getLibraryEntrySignature(b));
  });

  it('is case-insensitive', () => {
    const a = makeEntry({ enhanced: 'Hello World' });
    const b = makeEntry({ enhanced: 'hello world' });
    expect(getLibraryEntrySignature(a)).toBe(getLibraryEntrySignature(b));
  });

  it('uses enhanced over original when both present', () => {
    const entry = makeEntry({ original: 'Fallback', enhanced: 'Primary' });
    const enhancedOnly = makeEntry({ enhanced: 'Primary' });
    expect(getLibraryEntrySignature(entry)).toBe(getLibraryEntrySignature(enhancedOnly));
  });

  it('falls back to original when enhanced is missing', () => {
    const a = { original: 'Only original' };
    const b = { original: 'Only original' };
    expect(getLibraryEntrySignature(a)).toBe(getLibraryEntrySignature(b));
    expect(getLibraryEntrySignature(a)).not.toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// matchesLibrarySearch
// ──────────────────────────────────────────────────────────────────────────────
describe('matchesLibrarySearch', () => {
  const entry = makeEntry({
    title: 'Code Review Helper',
    collection: 'Engineering',
    notes: 'Detailed code review checklist',
    tags: ['Code', 'Analysis'],
    enhanced: 'Review the code and provide feedback on bugs, security, and performance.',
    original: 'Review my code',
  });

  it('returns true for empty query', () => {
    expect(matchesLibrarySearch(entry, '')).toBe(true);
    expect(matchesLibrarySearch(entry, null)).toBe(true);
    expect(matchesLibrarySearch(entry, undefined)).toBe(true);
  });

  it('matches against title', () => {
    expect(matchesLibrarySearch(entry, 'code review')).toBe(true);
    expect(matchesLibrarySearch(entry, 'helper')).toBe(true);
  });

  it('matches against collection', () => {
    expect(matchesLibrarySearch(entry, 'engineering')).toBe(true);
  });

  it('matches against notes', () => {
    expect(matchesLibrarySearch(entry, 'checklist')).toBe(true);
  });

  it('matches against tags', () => {
    expect(matchesLibrarySearch(entry, 'analysis')).toBe(true);
  });

  it('matches against enhanced text', () => {
    expect(matchesLibrarySearch(entry, 'security')).toBe(true);
  });

  it('matches against original text', () => {
    expect(matchesLibrarySearch(entry, 'review my code')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(matchesLibrarySearch(entry, 'CODE REVIEW')).toBe(true);
    expect(matchesLibrarySearch(entry, 'Engineering')).toBe(true);
  });

  it('returns false for non-matching query', () => {
    expect(matchesLibrarySearch(entry, 'machine learning')).toBe(false);
    expect(matchesLibrarySearch(entry, 'xyz123')).toBe(false);
  });

  it('handles null/undefined entry gracefully', () => {
    expect(matchesLibrarySearch(null, 'test')).toBe(false);
    expect(matchesLibrarySearch(undefined, 'test')).toBe(false);
  });

  it('handles entry with missing fields', () => {
    expect(matchesLibrarySearch({ enhanced: 'Hello' }, 'hello')).toBe(true);
    expect(matchesLibrarySearch({}, 'hello')).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// mergeLibraryEntries
// ──────────────────────────────────────────────────────────────────────────────
describe('mergeLibraryEntries', () => {
  it('appends new entries by default', () => {
    const existing = [makeEntry({ id: 'a', enhanced: 'Alpha prompt' })];
    const incoming = [makeEntry({ id: 'b', enhanced: 'Bravo prompt' })];
    const result = mergeLibraryEntries(existing, incoming);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.library).toHaveLength(2);
    // Default is append, so existing should come first
    expect(result.library[0].enhanced).toContain('Alpha');
  });

  it('prepends when option is set', () => {
    const existing = [makeEntry({ id: 'a', enhanced: 'Alpha prompt' })];
    const incoming = [makeEntry({ id: 'b', enhanced: 'Bravo prompt' })];
    const result = mergeLibraryEntries(existing, incoming, { prepend: true });
    expect(result.importedCount).toBe(1);
    expect(result.library[0].enhanced).toContain('Bravo');
  });

  it('skips duplicates based on content hash', () => {
    const existing = [makeEntry({ id: 'a', enhanced: 'Same content' })];
    const incoming = [makeEntry({ id: 'b', enhanced: 'Same content' })];
    const result = mergeLibraryEntries(existing, incoming);
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.library).toHaveLength(1);
  });

  it('handles empty existing library', () => {
    const incoming = [
      makeEntry({ id: 'a', enhanced: 'Alpha' }),
      makeEntry({ id: 'b', enhanced: 'Bravo' }),
    ];
    const result = mergeLibraryEntries([], incoming);
    expect(result.importedCount).toBe(2);
    expect(result.library).toHaveLength(2);
  });

  it('handles empty incoming library', () => {
    const existing = [makeEntry({ id: 'a', enhanced: 'Alpha' })];
    const result = mergeLibraryEntries(existing, []);
    expect(result.importedCount).toBe(0);
    expect(result.library).toHaveLength(1);
  });

  it('handles both empty', () => {
    const result = mergeLibraryEntries([], []);
    expect(result.importedCount).toBe(0);
    expect(result.library).toHaveLength(0);
  });

  it('deduplicates within incoming entries', () => {
    const incoming = [
      makeEntry({ id: 'a', enhanced: 'Duplicate content' }),
      makeEntry({ id: 'b', enhanced: 'Duplicate content' }),
    ];
    const result = mergeLibraryEntries([], incoming);
    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('handles non-array inputs gracefully', () => {
    const result = mergeLibraryEntries(null, null);
    expect(result.library).toEqual([]);
    expect(result.importedCount).toBe(0);
  });

  it('normalizes entries during merge', () => {
    const existing = [{ enhanced: 'Valid existing', id: 'a' }];
    const incoming = [{ enhanced: 'Valid incoming', id: 'b' }];
    const result = mergeLibraryEntries(existing, incoming);
    // Should have all normalized fields
    result.library.forEach((entry) => {
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('title');
      expect(entry).toHaveProperty('createdAt');
      expect(entry).toHaveProperty('tags');
    });
  });

  // Bug #6: Double normalization can mutate IDs
  it('preserves entry IDs through merge (documents Bug #6)', () => {
    const existing = [makeEntry({ id: 'keep-this-id', enhanced: 'Existing prompt content' })];
    const incoming = [makeEntry({ id: 'keep-incoming-id', enhanced: 'New prompt content' })];
    const result = mergeLibraryEntries(existing, incoming);
    const ids = result.library.map((e) => e.id);
    expect(ids).toContain('keep-this-id');
    expect(ids).toContain('keep-incoming-id');
  });
});
