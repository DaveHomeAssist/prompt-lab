import { describe, expect, it } from 'vitest';
import { DEFAULT_LIBRARY_SEEDS } from '../constants.js';
import { createPromptEntry } from '../lib/promptSchema.js';
import {
  getLibraryEntrySignature,
  isSeedOnlyLibrary,
  mergeCollections,
  mergeLibraryEntries,
  parseLegacyLibraryPayload,
  shouldAttemptLegacyWebMigration,
  APEX_WEB_APP_ORIGIN,
  WWW_WEB_APP_ORIGIN,
  LEGACY_LIBRARY_CHECK_KEY,
  LEGACY_LIBRARY_SOURCES,
  getLegacyLibrarySource,
  DEFAULT_LEGACY_SOURCE,
} from '../lib/legacyLibraryMigration.js';

describe('legacyLibraryMigration', () => {
  it('detects a seed-only library', () => {
    expect(isSeedOnlyLibrary(DEFAULT_LIBRARY_SEEDS)).toBe(true);
  });

  it('merges legacy libraries without duplicating shared prompts', () => {
    const duplicateSeed = createPromptEntry({
      ...DEFAULT_LIBRARY_SEEDS[0],
      title: DEFAULT_LIBRARY_SEEDS[0].title,
      original: DEFAULT_LIBRARY_SEEDS[0].original,
      enhanced: DEFAULT_LIBRARY_SEEDS[0].original,
    });
    const legacyOnly = createPromptEntry({
      title: 'Recovered Prompt',
      original: 'Recovered original',
      enhanced: 'Recovered enhanced',
      collection: 'Recovered',
    });

    const result = mergeLibraryEntries(DEFAULT_LIBRARY_SEEDS, [duplicateSeed, legacyOnly]);

    expect(result.importedCount).toBe(1);
    expect(result.library.some((entry) => entry.title === 'Recovered Prompt')).toBe(true);
  });

  it('builds stable signatures for equivalent entries', () => {
    const left = createPromptEntry({
      title: 'Prompt Alpha',
      original: 'Alpha body',
      enhanced: 'Alpha body',
    });
    const right = createPromptEntry({
      title: 'Prompt Alpha',
      original: 'Alpha body',
      enhanced: 'Alpha body',
    });

    expect(getLibraryEntrySignature(left)).toBe(getLibraryEntrySignature(right));
  });

  it('dedupes merged collections', () => {
    expect(mergeCollections(['Ops', 'Launch'], ['Launch', 'Recovered', ''])).toEqual(['Ops', 'Launch', 'Recovered']);
  });

  it('parses valid bridge payloads only', () => {
    expect(parseLegacyLibraryPayload({ type: 'wrong' })).toBeNull();
    expect(parseLegacyLibraryPayload({
      type: 'pl2:legacy-library-payload',
      library: [{ title: 'Recovered Prompt', original: 'body', enhanced: 'body' }],
      collections: ['Recovered'],
      sourceOrigin: 'https://prompt-lab-tawny.vercel.app',
    })).toEqual({
      library: [{ title: 'Recovered Prompt', original: 'body', enhanced: 'body' }],
      collections: ['Recovered'],
      sourceOrigin: 'https://prompt-lab-tawny.vercel.app',
    });
  });

  it('skips automatic legacy migration attempts on localhost preview origins', () => {
    expect(shouldAttemptLegacyWebMigration('http://localhost:4176', 'http:')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('http://127.0.0.1:4176', 'http:')).toBe(false);
    // Only the https apex reads www; preview hosts no longer ask any source.
    expect(shouldAttemptLegacyWebMigration('https://promptlab-preview.example.com', 'https:')).toBe(false);
  });
});

describe('legacy library sources (S-06 www -> apex)', () => {
  it('lists only www (the cross-site tawny source was removed, S-24) with its own checked key', () => {
    expect(LEGACY_LIBRARY_SOURCES.map((source) => source.id)).toEqual(['www']);
    expect(LEGACY_LIBRARY_SOURCES.some((source) => /tawny|vercel\.app/.test(source.origin))).toBe(false);
    expect(getLegacyLibrarySource('tawny').id).toBe('www');
    expect(getLegacyLibrarySource('www')).toMatchObject({
      origin: WWW_WEB_APP_ORIGIN, checkKey: `${LEGACY_LIBRARY_CHECK_KEY}:www`, mergeIntoExisting: true,
    });
    expect(new Set(LEGACY_LIBRARY_SOURCES.map((source) => source.checkKey)).size).toBe(LEGACY_LIBRARY_SOURCES.length);
  });

  it('requests www only from the https apex, never from www itself', () => {
    expect(shouldAttemptLegacyWebMigration(APEX_WEB_APP_ORIGIN, 'https:', 'www')).toBe(true);
    expect(shouldAttemptLegacyWebMigration(WWW_WEB_APP_ORIGIN, 'https:', 'www')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('http://promptlab.tools', 'http:', 'www')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('https://prompt-lab-git-x.vercel.app', 'https:', 'www')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('http://tauri.localhost', 'http:', 'www')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('chrome-extension://abc', 'chrome-extension:', 'www')).toBe(false);
  });

  it('the default source is www and no other origin is ever asked', () => {
    expect(DEFAULT_LEGACY_SOURCE.id).toBe('www');
    expect(shouldAttemptLegacyWebMigration(APEX_WEB_APP_ORIGIN, 'https:')).toBe(true);
    expect(shouldAttemptLegacyWebMigration(WWW_WEB_APP_ORIGIN, 'https:')).toBe(false);
    expect(shouldAttemptLegacyWebMigration('https://prompt-lab-tawny.vercel.app', 'https:')).toBe(false);
  });

  it('merges a www library into a non-empty apex library without duplicates', () => {
    const shared = createPromptEntry({ title: 'Shared', original: 'Shared body', enhanced: 'Shared body' });
    const apexOnly = createPromptEntry({ title: 'Apex only', original: 'Apex body', enhanced: 'Apex body' });
    const wwwOnly = createPromptEntry({ title: 'Www only', original: 'Www body', enhanced: 'Www body' });
    const first = mergeLibraryEntries([shared, apexOnly], [{ ...shared, id: 'www-copy' }, wwwOnly]);
    expect(first.importedCount).toBe(1);
    expect(first.library.map((entry) => entry.title).sort()).toEqual(['Apex only', 'Shared', 'Www only']);
    const second = mergeLibraryEntries(first.library, [{ ...shared, id: 'www-copy' }, wwwOnly]);
    expect(second.importedCount).toBe(0);
    expect(second.library).toHaveLength(3);
  });
});
