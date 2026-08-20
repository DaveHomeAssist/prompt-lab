import { beforeEach, describe, expect, it } from 'vitest';
import { loadPackRegistry, reconcilePacks, removePack, stampPackMembership, upsertPack } from '../lib/packStore.js';
import { buildPackShareUrl, decodePackShare, exportPackFromEntries } from '../lib/packExport.js';
import { importPresetPack, validatePresetPack } from '../lib/presetImport.js';
import { createPromptEntry } from '../lib/promptSchema.js';

function makeEntry(overrides = {}) {
  return createPromptEntry({
    title: 'Sample Prompt',
    original: 'raw text',
    enhanced: 'enhanced text',
    tags: ['tag-a'],
    collection: 'Bench',
    notes: 'a note',
    ...overrides,
  });
}

describe('packStore', () => {
  beforeEach(() => localStorage.clear());

  it('upserts, lists, and removes pack records', () => {
    upsertPack({ id: 'my-pack', title: 'My Pack', version: '1.2.0', source: 'authored' });
    expect(loadPackRegistry()['my-pack'].title).toBe('My Pack');
    upsertPack({ id: 'my-pack', title: 'My Pack v2' });
    expect(loadPackRegistry()['my-pack'].title).toBe('My Pack v2');
    expect(loadPackRegistry()['my-pack'].createdAt).toBeTruthy();
    expect(removePack('my-pack')).toBe(true);
    expect(loadPackRegistry()['my-pack']).toBeUndefined();
    expect(removePack('my-pack')).toBe(false);
  });

  it('reconciles registry rows with entry membership, including unknown starter packs', () => {
    upsertPack({ id: 'authored-pack', title: 'Authored', source: 'authored' });
    const entries = [
      makeEntry({ metadata: { packId: 'authored-pack' } }),
      makeEntry({ metadata: { packId: 'authored-pack' } }),
      makeEntry({ metadata: { packId: 'lib_unknown_starter' } }),
      makeEntry(),
    ];
    const rows = reconcilePacks(entries);
    const authored = rows.find((row) => row.id === 'authored-pack');
    const starter = rows.find((row) => row.id === 'lib_unknown_starter');
    expect(authored.entryCount).toBe(2);
    expect(authored.source).toBe('authored');
    expect(starter.entryCount).toBe(1);
    expect(starter.source).toBe('starter');
  });

  it('keeps orphaned registry rows visible with a zero count', () => {
    upsertPack({ id: 'ghost-pack', title: 'Ghost' });
    const rows = reconcilePacks([]);
    expect(rows.find((row) => row.id === 'ghost-pack').entryCount).toBe(0);
  });

  it('stamps only selected authored entries so uninstall targets exact membership', () => {
    const first = makeEntry({ id: 'first' });
    const second = makeEntry({ id: 'second' });
    const result = stampPackMembership([first, second], ['second'], { id: 'my-pack', title: 'My Pack' });
    expect(result[0].metadata.packId).toBeUndefined();
    expect(result[1].metadata).toMatchObject({ packId: 'my-pack', packName: 'My Pack', packSource: 'authored' });
  });
});

describe('exportPackFromEntries', () => {
  beforeEach(() => localStorage.clear());

  it('produces a pack that passes validatePresetPack', () => {
    const pack = exportPackFromEntries([makeEntry(), makeEntry({ title: 'Second' })], { title: 'Dave Pack' });
    const validation = validatePresetPack(pack);
    expect(validation.valid).toBe(true);
    expect(pack.type).toBe('prompt-pack');
    expect(pack.id).toBe('dave-pack');
    expect(pack.presets).toHaveLength(2);
    expect(pack.presets[0].prompt).toBe('enhanced text');
  });

  it('round-trips a Unicode pack through a portable share URL payload', () => {
    const pack = exportPackFromEntries([makeEntry({ title: 'Résumé', enhanced: 'Use café context.' })], { title: 'Café Pack' });
    const url = buildPackShareUrl(pack, { origin: 'https://promptlab.tools', pathname: '/app/' });
    expect(url).toMatch(/^https:\/\/promptlab\.tools\/app\/#pack=/);
    expect(decodePackShare(url.split('#pack=')[1])).toEqual(pack);
  });

  it('round-trips through importPresetPack and stamps packId membership', async () => {
    const entry = makeEntry({
      title: 'Round Trip',
      favorite: true,
      kind: 'template',
      sourceNoteId: 'scratch-note-7',
      tombstoneVersion: 3,
      resultMeta: {
        changeSummary: 'Ready to use',
        candidates: [{ id: 'improved', label: 'Improved', content: 'enhanced text' }],
        selectedCandidateId: 'improved',
      },
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
      metadata: {
        owner: 'Dave',
        purpose: 'Prove a lossless pack round trip.',
        status: 'active',
        compatibility: ['Claude'],
        riskLevel: 'low',
        custom: 'retained',
      },
    });
    const pack = exportPackFromEntries([entry], { title: 'RT Pack' });
    let saved = null;
    const adapter = {
      load: async () => [],
      save: async (library) => { saved = library; },
    };
    const result = await importPresetPack(pack, adapter);
    expect(result.imported).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].metadata.packId).toBe('rt-pack');
    expect(saved[0].title).toBe('Round Trip');
    expect(saved[0]).toMatchObject({
      favorite: true,
      kind: 'template',
      sourceNoteId: 'scratch-note-7',
      tombstoneVersion: 3,
      notes: 'a note',
      inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
      metadata: {
        owner: 'Dave',
        purpose: 'Prove a lossless pack round trip.',
        status: 'active',
        compatibility: ['Claude'],
        riskLevel: 'low',
        custom: 'retained',
      },
    });
    expect(saved[0].resultMeta).toMatchObject({
      changeSummary: 'Ready to use',
      selectedCandidateId: 'improved',
    });
    expect(saved[0].completeness.complete).toBe(true);
    // The import also registered the pack.
    expect(loadPackRegistry()['rt-pack'].source).toBe('imported');
  });

  it('applies per-preset keep, replace, and skip conflict resolutions', async () => {
    const existing = [
      makeEntry({ id: 'replace-me', title: 'Replace Me', enhanced: 'old replace' }),
      makeEntry({ id: 'keep-me', title: 'Keep Me', enhanced: 'same keep' }),
      makeEntry({ id: 'skip-me', title: 'Skip Me', enhanced: 'same skip' }),
    ];
    const pack = exportPackFromEntries([
      makeEntry({ title: 'Replace Me', enhanced: 'new replace' }),
      makeEntry({ title: 'Keep Me', enhanced: 'same keep' }),
      makeEntry({ title: 'Skip Me', enhanced: 'same skip' }),
    ], { title: 'Conflict Pack' });
    let saved = null;
    const result = await importPresetPack(pack, {
      load: async () => existing,
      save: async (library) => { saved = library; },
    }, {
      resolutions: {
        'replace-me': { action: 'replace', existingId: 'replace-me' },
        'keep-me': { action: 'keep', existingId: 'keep-me' },
        'skip-me': { action: 'skip', existingId: 'skip-me' },
      },
    });
    expect(saved.find((entry) => entry.id === 'replace-me').enhanced).toBe('new replace');
    expect(saved.filter((entry) => entry.title === 'Keep Me')).toHaveLength(2);
    expect(saved.filter((entry) => entry.title === 'Skip Me')).toHaveLength(1);
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'skip-me' })]));
  });

  it('deduplicates three or more preset ids from same-titled entries with monotonic suffixes', () => {
    const pack = exportPackFromEntries([
      makeEntry({ title: 'Twin' }),
      makeEntry({ title: 'Twin' }),
      makeEntry({ title: 'Twin' }),
    ], { title: 'Twins' });
    const ids = pack.presets.map((preset) => preset.id);
    expect(ids).toEqual(['twin', 'twin-2', 'twin-3']);
  });
});
