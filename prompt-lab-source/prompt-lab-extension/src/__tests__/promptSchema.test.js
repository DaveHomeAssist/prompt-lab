import { describe, expect, it } from 'vitest';
import {
  arePromptSnapshotsEqual,
  appendVersionSnapshot,
  createPromptEntry,
  normalizeEntry,
  normalizeLibrary,
  normalizeVersion,
  normalizeTestCase,
  restorePromptVersion,
  suggestTitleFromText,
  updatePromptEntry,
  getPromptSnapshot,
  PROMPT_STATUS,
} from '../lib/promptSchema.js';

const NOW = '2026-04-10T12:00:00.000Z';

function makeEntry(overrides = {}) {
  return createPromptEntry({
    title: 'Test Prompt',
    original: 'Original text',
    enhanced: 'Enhanced text',
    notes: 'Some notes',
    tags: ['Code'],
    collection: 'TestCol',
    ...overrides,
  }, { now: NOW });
}

// ──────────────────────────────────────────────────────────────────────────────
// normalizeEntry
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeEntry', () => {
  it('returns null for null/undefined/non-object input', () => {
    expect(normalizeEntry(null)).toBeNull();
    expect(normalizeEntry(undefined)).toBeNull();
    expect(normalizeEntry('string')).toBeNull();
    expect(normalizeEntry(42)).toBeNull();
  });

  it('returns null when enhanced resolves to empty string', () => {
    expect(normalizeEntry({ original: '', enhanced: '' })).toBeNull();
    expect(normalizeEntry({ original: '   ', enhanced: '   ' })).toBeNull();
  });

  it('falls back to original when enhanced is missing', () => {
    const entry = normalizeEntry({ original: 'My prompt', enhanced: '' });
    // normalizeContentShape: enhanced = ensureString(enhanced) || ensureString(original)
    expect(entry).not.toBeNull();
    expect(entry.enhanced).toBe('My prompt');
  });

  it('assigns a random ID when entry has no ID', () => {
    const entry = normalizeEntry({ enhanced: 'Hello world' });
    expect(entry.id).toBeTruthy();
    expect(typeof entry.id).toBe('string');
  });

  it('preserves existing ID', () => {
    const entry = normalizeEntry({ id: 'custom-id', enhanced: 'Hello' });
    expect(entry.id).toBe('custom-id');
  });

  it('normalizes tags to string array', () => {
    const entry = normalizeEntry({ enhanced: 'Hello', tags: ['Code', 42, null, '', 'Writing'] });
    expect(entry.tags).toEqual(['Code', 'Writing']);
  });

  it('normalizes collection from category fallback', () => {
    const entry = normalizeEntry({ enhanced: 'Hello', category: 'Legacy Category' });
    expect(entry.collection).toBe('Legacy Category');
  });

  it('normalizes useCount to non-negative finite number', () => {
    expect(normalizeEntry({ enhanced: 'Hello', useCount: -5 }).useCount).toBe(0);
    expect(normalizeEntry({ enhanced: 'Hello', useCount: NaN }).useCount).toBe(0);
    expect(normalizeEntry({ enhanced: 'Hello', useCount: Infinity }).useCount).toBe(0);
    expect(normalizeEntry({ enhanced: 'Hello', useCount: 3 }).useCount).toBe(3);
  });

  it('normalizes versions array, filtering out invalid entries', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      versions: [
        { enhanced: 'Version 1', savedAt: NOW },
        null,
        { enhanced: '', original: '' }, // empty → null after normalize
        { enhanced: 'Version 2', savedAt: NOW },
      ],
    });
    expect(entry.versions).toHaveLength(2);
    expect(entry.versions[0].enhanced).toBe('Version 1');
    expect(entry.versions[1].enhanced).toBe('Version 2');
  });

  it('normalizes test cases, filtering out invalid entries', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      testCases: [
        { input: 'test input', name: 'Test 1' },
        null,
        { input: '', name: 'Empty' }, // empty input → null
        { input: 'another input' },
      ],
    });
    expect(entry.testCases).toHaveLength(2);
  });

  it('normalizes golden response to null when text is empty', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      goldenResponse: { text: '  ', pinnedAt: NOW },
    });
    expect(entry.goldenResponse).toBeNull();
  });

  it('normalizes golden response when valid', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      goldenResponse: { text: 'Expected output', pinnedAt: NOW },
    });
    expect(entry.goldenResponse).not.toBeNull();
    expect(entry.goldenResponse.text).toBe('Expected output');
  });

  it('normalizes goldenThreshold to 0-1 range', () => {
    expect(normalizeEntry({ enhanced: 'Hello', goldenThreshold: 1.5 }).goldenThreshold).toBe(1);
    expect(normalizeEntry({ enhanced: 'Hello', goldenThreshold: -0.5 }).goldenThreshold).toBe(0);
    expect(normalizeEntry({ enhanced: 'Hello', goldenThreshold: 0.85 }).goldenThreshold).toBe(0.85);
    expect(normalizeEntry({ enhanced: 'Hello', goldenThreshold: 'not-a-number' }).goldenThreshold).toBe(0.7);
  });

  it('preserves updatedAt from snake_case alias', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      updated_at: '2026-01-15T00:00:00.000Z',
    });
    expect(entry.updated_at).toBe('2026-01-15T00:00:00.000Z');
  });

  it('normalizes metadata fields', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello',
      metadata: { owner: 'Dave', status: 'active', compatibility: ['claude', 42], extra: true },
    });
    expect(entry.metadata.owner).toBe('Dave');
    expect(entry.metadata.status).toBe('active');
    expect(entry.metadata.compatibility).toEqual(['claude']);
    expect(entry.metadata.extra).toBe(true);
  });

  it('normalizes prompt inputs', () => {
    const entry = normalizeEntry({
      enhanced: 'Hello {{name}}',
      inputs: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: '', label: 'No Key' }, // filtered out
        { key: 'choice', type: 'SELECT', options: ['a', 'b'] },
      ],
    });
    expect(entry.inputs).toHaveLength(2);
    expect(entry.inputs[0].key).toBe('name');
    expect(entry.inputs[1].type).toBe('select');
    expect(entry.inputs[1].options).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// createPromptEntry
// ──────────────────────────────────────────────────────────────────────────────
describe('createPromptEntry', () => {
  it('creates an entry with all required fields', () => {
    const entry = makeEntry();
    expect(entry).not.toBeNull();
    expect(entry.id).toBeTruthy();
    expect(entry.title).toBe('Test Prompt');
    expect(entry.original).toBe('Original text');
    expect(entry.enhanced).toBe('Enhanced text');
    expect(entry.tags).toEqual(['Code']);
    expect(entry.collection).toBe('TestCol');
    expect(entry.createdAt).toBe(NOW);
    expect(entry.useCount).toBe(0);
    expect(entry.versions).toEqual([]);
  });

  it('generates a unique ID when not provided', () => {
    const a = makeEntry();
    const b = makeEntry();
    expect(a.id).not.toBe(b.id);
  });

  it('uses provided ID when given', () => {
    const entry = makeEntry({ id: 'my-custom-id' });
    expect(entry.id).toBe('my-custom-id');
  });

  it('auto-generates title from enhanced text when title is empty', () => {
    const entry = createPromptEntry({ enhanced: 'Write a haiku about cats' }, { now: NOW });
    expect(entry.title).toBeTruthy();
    expect(entry.title).not.toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// updatePromptEntry
// ──────────────────────────────────────────────────────────────────────────────
describe('updatePromptEntry', () => {
  it('returns null for null entry', () => {
    expect(updatePromptEntry(null, { enhanced: 'New' })).toBeNull();
  });

  it('updates title while preserving ID and createdAt', () => {
    const entry = makeEntry();
    const updated = updatePromptEntry(entry, { title: 'New Title' }, { now: NOW });
    expect(updated.id).toBe(entry.id);
    expect(updated.title).toBe('New Title');
    expect(updated.createdAt).toBe(entry.createdAt);
  });

  it('creates version snapshot when content changes', () => {
    const entry = makeEntry();
    const updated = updatePromptEntry(entry, { enhanced: 'Completely new enhanced text' }, { now: NOW });
    expect(updated.versions.length).toBeGreaterThan(entry.versions.length);
    expect(updated.currentVersionId).not.toBe(entry.currentVersionId);
  });

  it('does NOT create version snapshot when content is unchanged', () => {
    const entry = makeEntry();
    const updated = updatePromptEntry(entry, { title: 'Just a title change' }, { now: NOW });
    expect(updated.versions.length).toBe(entry.versions.length);
  });

  it('updates tags correctly', () => {
    const entry = makeEntry({ tags: ['Code'] });
    const updated = updatePromptEntry(entry, { tags: ['Writing', 'Creative'] }, { now: NOW });
    expect(updated.tags).toEqual(['Writing', 'Creative']);
  });

  it('updates collection', () => {
    const entry = makeEntry({ collection: 'Old' });
    const updated = updatePromptEntry(entry, { collection: 'New' }, { now: NOW });
    expect(updated.collection).toBe('New');
  });

  it('keeps existing title when changes.title is empty', () => {
    const entry = makeEntry({ title: 'Keep Me' });
    const updated = updatePromptEntry(entry, { title: '' }, { now: NOW });
    expect(updated.title).toBe('Keep Me');
  });

  it('updates updatedAt timestamp', () => {
    const entry = makeEntry();
    const newTime = '2026-04-11T00:00:00.000Z';
    const updated = updatePromptEntry(entry, { enhanced: 'Changed content' }, { now: newTime });
    expect(updated.updatedAt).toBe(newTime);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// arePromptSnapshotsEqual
// ──────────────────────────────────────────────────────────────────────────────
describe('arePromptSnapshotsEqual', () => {
  it('returns true for identical content', () => {
    const a = { original: 'A', enhanced: 'B', notes: 'C', variants: [] };
    expect(arePromptSnapshotsEqual(a, a)).toBe(true);
  });

  it('returns false when enhanced differs', () => {
    const a = { original: 'A', enhanced: 'B', notes: 'C', variants: [] };
    const b = { original: 'A', enhanced: 'Different', notes: 'C', variants: [] };
    expect(arePromptSnapshotsEqual(a, b)).toBe(false);
  });

  it('returns false when variants differ', () => {
    const a = { original: 'A', enhanced: 'B', variants: [{ label: 'V1', content: 'C1' }] };
    const b = { original: 'A', enhanced: 'B', variants: [{ label: 'V1', content: 'C2' }] };
    expect(arePromptSnapshotsEqual(a, b)).toBe(false);
  });

  it('handles null/undefined inputs gracefully', () => {
    expect(arePromptSnapshotsEqual(null, null)).toBe(true);
    expect(arePromptSnapshotsEqual(null, { enhanced: 'X' })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// normalizeVersion
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeVersion', () => {
  it('returns null for null/undefined/non-object', () => {
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion(undefined)).toBeNull();
    expect(normalizeVersion('string')).toBeNull();
  });

  it('returns null when content is empty', () => {
    expect(normalizeVersion({ original: '', enhanced: '' })).toBeNull();
  });

  it('normalizes a valid version', () => {
    const version = normalizeVersion({
      enhanced: 'Version text',
      savedAt: NOW,
      changeNote: 'Initial',
    });
    expect(version).not.toBeNull();
    expect(version.enhanced).toBe('Version text');
    expect(version.changeNote).toBe('Initial');
    expect(version.id).toBeTruthy();
  });

  it('assigns a random ID when missing', () => {
    const version = normalizeVersion({ enhanced: 'Content' });
    expect(version.id).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// normalizeTestCase
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeTestCase', () => {
  it('returns null for null/undefined/non-object', () => {
    expect(normalizeTestCase(null)).toBeNull();
    expect(normalizeTestCase(undefined)).toBeNull();
  });

  it('returns null when input is empty', () => {
    expect(normalizeTestCase({ input: '', name: 'Empty' })).toBeNull();
    expect(normalizeTestCase({ input: '   ', name: 'Whitespace' })).toBeNull();
  });

  it('normalizes a valid test case', () => {
    const tc = normalizeTestCase({
      input: 'test input',
      name: 'My test',
      expectedTraits: ['trait1'],
      exclusions: ['bad'],
      notes: 'Note',
    });
    expect(tc).not.toBeNull();
    expect(tc.input).toBe('test input');
    expect(tc.name).toBe('My test');
    expect(tc.expectedTraits).toEqual(['trait1']);
    expect(tc.exclusions).toEqual(['bad']);
  });

  it('auto-generates name from input when name is empty', () => {
    const tc = normalizeTestCase({ input: 'Write a poem about summer' });
    expect(tc.name).toBeTruthy();
    expect(tc.name).not.toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// appendVersionSnapshot
// ──────────────────────────────────────────────────────────────────────────────
describe('appendVersionSnapshot', () => {
  it('returns null for null entry', () => {
    expect(appendVersionSnapshot(null)).toBeNull();
  });

  it('appends a new version snapshot', () => {
    const entry = makeEntry();
    const withVersion = appendVersionSnapshot(entry, { savedAt: NOW });
    expect(withVersion.versions.length).toBe(entry.versions.length + 1);
  });

  it('does not duplicate identical consecutive snapshots', () => {
    const entry = makeEntry();
    const first = appendVersionSnapshot(entry, { savedAt: NOW });
    const second = appendVersionSnapshot(first, { savedAt: NOW });
    // Second append should not add because content is the same
    expect(second.versions.length).toBe(first.versions.length);
  });

  it('caps versions at MAX_PROMPT_VERSIONS (25)', () => {
    let entry = makeEntry();
    for (let i = 0; i < 30; i++) {
      entry = {
        ...entry,
        enhanced: `Version ${i}`,
      };
      entry = appendVersionSnapshot(entry, { savedAt: new Date(Date.now() + i * 1000).toISOString() });
    }
    expect(entry.versions.length).toBeLessThanOrEqual(25);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// getPromptSnapshot
// ──────────────────────────────────────────────────────────────────────────────
describe('getPromptSnapshot', () => {
  it('creates a snapshot from an entry', () => {
    const entry = makeEntry();
    const snapshot = getPromptSnapshot(entry, { savedAt: NOW });
    expect(snapshot).not.toBeNull();
    expect(snapshot.enhanced).toBe(entry.enhanced);
    expect(snapshot.original).toBe(entry.original);
  });

  it('returns null for entry with empty content', () => {
    const snapshot = getPromptSnapshot({ original: '', enhanced: '' }, { savedAt: NOW });
    expect(snapshot).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// restorePromptVersion
// ──────────────────────────────────────────────────────────────────────────────
describe('restorePromptVersion', () => {
  it('restores content from a version', () => {
    const entry = makeEntry({ enhanced: 'Current text' });
    const version = normalizeVersion({ enhanced: 'Old text', original: 'Old original', savedAt: NOW });
    const restored = restorePromptVersion(entry, version);
    expect(restored.enhanced).toBe('Old text');
    expect(restored.original).toBe('Old original');
  });

  it('returns equivalent entry when version content is identical', () => {
    const entry = makeEntry();
    const version = normalizeVersion({
      original: entry.original,
      enhanced: entry.enhanced,
      notes: entry.notes,
      variants: entry.variants,
      savedAt: NOW,
    });
    const restored = restorePromptVersion(entry, version);
    // restorePromptVersion runs through normalizeEntry, so reference equality isn't guaranteed,
    // but content should be the same
    expect(restored.enhanced).toBe(entry.enhanced);
    expect(restored.original).toBe(entry.original);
    expect(restored.id).toBe(entry.id);
  });

  it('returns equivalent entry when version is null', () => {
    const entry = makeEntry();
    const restored = restorePromptVersion(entry, null);
    // normalizeEntry is called internally, so reference equality isn't guaranteed
    expect(restored.enhanced).toBe(entry.enhanced);
    expect(restored.id).toBe(entry.id);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// suggestTitleFromText
// ──────────────────────────────────────────────────────────────────────────────
describe('suggestTitleFromText', () => {
  it('returns "Untitled Prompt" for empty text', () => {
    expect(suggestTitleFromText('')).toBe('Untitled Prompt');
    expect(suggestTitleFromText('  ')).toBe('Untitled Prompt');
    expect(suggestTitleFromText(null)).toBe('Untitled Prompt');
  });

  it('uses first sentence if short enough', () => {
    const result = suggestTitleFromText('Write a haiku. Then explain it.');
    expect(result).toBe('Write a haiku.');
  });

  it('truncates long text at word boundary with ellipsis', () => {
    const long = 'This is a very long prompt that goes on and on and on and exceeds the maximum character limit for a title significantly';
    const result = suggestTitleFromText(long);
    expect(result.length).toBeLessThanOrEqual(61); // 60 + ellipsis
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles non-string input gracefully', () => {
    expect(suggestTitleFromText(42)).toBe('Untitled Prompt');
    expect(suggestTitleFromText(undefined)).toBe('Untitled Prompt');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// normalizeLibrary
// ──────────────────────────────────────────────────────────────────────────────
describe('normalizeLibrary', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeLibrary(null)).toEqual([]);
    expect(normalizeLibrary(undefined)).toEqual([]);
    expect(normalizeLibrary('string')).toEqual([]);
    expect(normalizeLibrary(42)).toEqual([]);
  });

  it('filters out invalid entries', () => {
    const result = normalizeLibrary([
      { enhanced: 'Valid prompt' },
      null,
      { enhanced: '' },
      { enhanced: 'Another valid' },
    ]);
    expect(result).toHaveLength(2);
  });

  it('deduplicates entries by ID', () => {
    const result = normalizeLibrary([
      { id: 'dup', enhanced: 'First' },
      { id: 'dup', enhanced: 'Second' },
    ]);
    expect(result).toHaveLength(2);
    // Both should exist but with different IDs
    const ids = result.map(e => e.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('preserves order', () => {
    const result = normalizeLibrary([
      { id: 'a', enhanced: 'Alpha' },
      { id: 'b', enhanced: 'Bravo' },
      { id: 'c', enhanced: 'Charlie' },
    ]);
    expect(result.map(e => e.id)).toEqual(['a', 'b', 'c']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// PROMPT_STATUS constant
// ──────────────────────────────────────────────────────────────────────────────
describe('PROMPT_STATUS', () => {
  it('contains expected statuses', () => {
    expect(PROMPT_STATUS).toEqual(['draft', 'active', 'deprecated']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PROMPT_STATUS)).toBe(true);
  });
});
