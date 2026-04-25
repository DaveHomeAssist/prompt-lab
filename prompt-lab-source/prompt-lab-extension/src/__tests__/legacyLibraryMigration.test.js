import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { createPromptEntry } from '../lib/promptSchema.js';
import {
  isSeedOnlyLibrary,
  mergeCollections,
  parseLegacyLibraryPayload,
  shouldAttemptLegacyWebMigration,
  LEGACY_WEB_APP_ORIGIN,
  LEGACY_LIBRARY_BRIDGE_PATH,
  LEGACY_LIBRARY_CHECK_KEY,
} from '../lib/legacyLibraryMigration.js';

const NOW = '2026-04-10T12:00:00.000Z';

// ──────────────────────────────────────────────────────────────────────────────
// mergeCollections
// ──────────────────────────────────────────────────────────────────────────────
describe('mergeCollections', () => {
  it('merges and deduplicates collections', () => {
    expect(mergeCollections(['A', 'B'], ['B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('filters empty strings', () => {
    expect(mergeCollections(['A', ''], ['', 'B'])).toEqual(['A', 'B']);
  });

  it('trims whitespace', () => {
    expect(mergeCollections([' A ', 'B'], ['A', ' C '])).toEqual(['A', 'B', 'C']);
  });

  it('handles null/undefined inputs', () => {
    expect(mergeCollections(null, ['A'])).toEqual(['A']);
    expect(mergeCollections(['A'], null)).toEqual(['A']);
    expect(mergeCollections(null, null)).toEqual([]);
  });

  it('handles non-string elements', () => {
    expect(mergeCollections([42, null, 'Valid'], ['Another'])).toEqual(['Valid', 'Another']);
  });

  it('preserves order — existing first, then incoming', () => {
    expect(mergeCollections(['Z', 'A'], ['M', 'B'])).toEqual(['Z', 'A', 'M', 'B']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// isSeedOnlyLibrary
// ──────────────────────────────────────────────────────────────────────────────
describe('isSeedOnlyLibrary', () => {
  it('returns true for exact seed library', () => {
    expect(isSeedOnlyLibrary(DEFAULT_LIBRARY_SEEDS)).toBe(true);
  });

  it('returns false when extra entries exist', () => {
    const extra = [
      ...DEFAULT_LIBRARY_SEEDS,
      { title: 'Custom', original: 'My prompt', enhanced: 'My prompt' },
    ];
    expect(isSeedOnlyLibrary(extra)).toBe(false);
  });

  it('returns false for empty library', () => {
    expect(isSeedOnlyLibrary([])).toBe(false);
  });

  it('returns false when seeds are partially present', () => {
    expect(isSeedOnlyLibrary(DEFAULT_LIBRARY_SEEDS.slice(0, 2))).toBe(false);
  });

  it('handles null/undefined', () => {
    expect(isSeedOnlyLibrary(null)).toBe(false);
    expect(isSeedOnlyLibrary(undefined)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// shouldAttemptLegacyWebMigration
// ──────────────────────────────────────────────────────────────────────────────
describe('shouldAttemptLegacyWebMigration', () => {
  it('returns true for https origin different from legacy', () => {
    expect(shouldAttemptLegacyWebMigration('https://my-app.vercel.app', 'https:')).toBe(true);
  });

  it('returns true for http protocol', () => {
    expect(shouldAttemptLegacyWebMigration('http://localhost:5173', 'http:')).toBe(true);
  });

  it('returns false for legacy origin itself', () => {
    expect(shouldAttemptLegacyWebMigration(LEGACY_WEB_APP_ORIGIN, 'https:')).toBe(false);
  });

  it('returns false for non-http protocols', () => {
    expect(shouldAttemptLegacyWebMigration('chrome-extension://abc', 'chrome-extension:')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('file:///path', 'file:')).toBe(false);
  });

  it('returns falsy for empty origin', () => {
    expect(shouldAttemptLegacyWebMigration('', 'https:')).toBeFalsy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// parseLegacyLibraryPayload
// ──────────────────────────────────────────────────────────────────────────────
describe('parseLegacyLibraryPayload', () => {
  it('returns null for null/undefined', () => {
    expect(parseLegacyLibraryPayload(null)).toBeNull();
    expect(parseLegacyLibraryPayload(undefined)).toBeNull();
  });

  it('returns null for wrong type', () => {
    expect(parseLegacyLibraryPayload({ type: 'wrong-type' })).toBeNull();
    expect(parseLegacyLibraryPayload({ type: '' })).toBeNull();
  });

  it('parses valid payload', () => {
    const payload = {
      type: 'pl2:legacy-library-payload',
      library: [{ title: 'Test', original: 'body', enhanced: 'body' }],
      collections: ['Col1'],
      sourceOrigin: 'https://example.com',
    };
    const result = parseLegacyLibraryPayload(payload);
    expect(result).not.toBeNull();
    expect(result.library).toHaveLength(1);
    expect(result.collections).toEqual(['Col1']);
    expect(result.sourceOrigin).toBe('https://example.com');
  });

  it('defaults library and collections to empty arrays when missing', () => {
    const result = parseLegacyLibraryPayload({
      type: 'pl2:legacy-library-payload',
    });
    expect(result.library).toEqual([]);
    expect(result.collections).toEqual([]);
    expect(result.sourceOrigin).toBe('');
  });

  it('handles non-array library/collections values', () => {
    const result = parseLegacyLibraryPayload({
      type: 'pl2:legacy-library-payload',
      library: 'not-an-array',
      collections: 42,
    });
    expect(result.library).toEqual([]);
    expect(result.collections).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────
describe('legacy migration constants', () => {
  it('has expected legacy origin', () => {
    expect(LEGACY_WEB_APP_ORIGIN).toBe('https://prompt-lab-tawny.vercel.app');
  });

  it('has expected bridge path', () => {
    expect(LEGACY_LIBRARY_BRIDGE_PATH).toBe('/legacy-library-bridge.html');
  });

  it('has expected check key', () => {
    expect(LEGACY_LIBRARY_CHECK_KEY).toBe('pl2-legacy-web-library-checked');
  });
});
