import { beforeEach, describe, expect, it } from 'vitest';
import { loadPackRegistry, reconcilePacks, removePack, upsertPack } from '../lib/packStore.js';
import { exportPackFromEntries } from '../lib/packExport.js';
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

  it('round-trips through importPresetPack and stamps packId membership', async () => {
    const pack = exportPackFromEntries([makeEntry({ title: 'Round Trip' })], { title: 'RT Pack' });
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
    // The import also registered the pack.
    expect(loadPackRegistry()['rt-pack'].source).toBe('imported');
  });

  it('deduplicates preset ids from same-titled entries', () => {
    const pack = exportPackFromEntries([makeEntry({ title: 'Twin' }), makeEntry({ title: 'Twin' })], { title: 'Twins' });
    const ids = pack.presets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(2);
  });
});
