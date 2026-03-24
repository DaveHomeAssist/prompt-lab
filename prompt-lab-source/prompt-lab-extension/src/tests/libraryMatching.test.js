import { describe, expect, it } from 'vitest';
import {
  getLibraryEntrySignature,
  matchesLibrarySearch,
  mergeLibraryEntries,
} from '../lib/libraryMatching.js';

function makeEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry-1',
    title: overrides.title || 'Prompt Entry',
    original: overrides.original || 'Original body',
    enhanced: overrides.enhanced || overrides.original || 'Enhanced body',
    notes: overrides.notes || '',
    tags: overrides.tags || [],
    collection: overrides.collection || '',
    createdAt: overrides.createdAt || '2026-03-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt || overrides.createdAt || '2026-03-20T00:00:00.000Z',
  };
}

describe('libraryMatching', () => {
  it('dedupes exact prompt bodies even when titles differ', () => {
    const existing = [
      makeEntry({
        id: 'existing',
        title: 'Original title',
        enhanced: 'Match this exact prompt body',
      }),
    ];
    const incoming = [
      makeEntry({
        id: 'incoming',
        title: 'Different title',
        enhanced: 'Match this exact prompt body',
      }),
    ];

    const result = mergeLibraryEntries(existing, incoming, { prepend: true });

    expect(getLibraryEntrySignature(existing[0])).toBe(getLibraryEntrySignature(incoming[0]));
    expect(result.importedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.library).toHaveLength(1);
  });

  it('prepends imported prompts when requested', () => {
    const existing = [makeEntry({ id: 'existing', title: 'Existing prompt' })];
    const incoming = [makeEntry({ id: 'incoming', title: 'Incoming prompt', enhanced: 'Fresh body' })];

    const result = mergeLibraryEntries(existing, incoming, { prepend: true });

    expect(result.importedCount).toBe(1);
    expect(result.library[0].id).toBe('incoming');
    expect(result.library[1].id).toBe('existing');
  });

  it('matches search queries across collection, notes, tags, and prompt body', () => {
    const entry = makeEntry({
      title: 'Planner handoff',
      collection: 'Launch Ops',
      notes: 'Contains venue briefing notes',
      tags: ['security', 'event'],
      enhanced: 'Generate a staffing plan for a high-volume venue entrance.',
    });

    expect(matchesLibrarySearch(entry, 'launch ops')).toBe(true);
    expect(matchesLibrarySearch(entry, 'briefing')).toBe(true);
    expect(matchesLibrarySearch(entry, 'security')).toBe(true);
    expect(matchesLibrarySearch(entry, 'staffing plan')).toBe(true);
    expect(matchesLibrarySearch(entry, 'nonexistent')).toBe(false);
  });
});
