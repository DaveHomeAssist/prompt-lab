import { describe, expect, it, vi } from 'vitest';
import { storageKeys } from '../lib/storage.js';
import { normalizeEntry } from '../lib/promptSchema.js';
import {
  EXAMPLE_PROJECT_PROFILE,
  MAX_PROFILE_INSTRUCTIONS,
  activeProfile,
  applyProfilePreamble,
  buildProfilePreamble,
  deleteProfile,
  duplicateProfile,
  estimateTokens,
  loadProjectProfiles,
  mergeProfileLists,
  migrateProjectProfiles,
  parseProfileImport,
  profileImportDocument,
  profileSaveStamp,
  reorderProfile,
  selectProfile,
  suggestProjectProfile,
  upsertProfile,
  writeProjectProfiles,
} from '../lib/projectProfiles.js';

const memory = () => {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
};

const sample = (overrides = {}) => ({
  id: 'alpha',
  name: 'Alpha',
  emoji: '🔧',
  color: 'slate',
  instructions: 'Use the existing API names. Do not invent a framework.',
  defaultTags: ['api'],
  outputFormat: 'A short paragraph, then the steps.',
  ...overrides,
});

describe('project profile store', () => {
  it('creates, edits, duplicates, reorders, and deletes without seeding the example', () => {
    const storage = memory();
    expect(loadProjectProfiles(storage)).toEqual([]);
    expect(storage.getItem(storageKeys.projectProfiles)).toBeNull();

    const created = upsertProfile([], { ...sample(), id: '' });
    expect(created).toHaveLength(1);
    expect(created[0].selected).toBe(true);
    expect(created[0].name).toBe('Alpha');
    const saved = writeProjectProfiles(created, storage);
    expect(saved.ok).toBe(true);
    expect(storage.getItem(storageKeys.projectProfilesSchemaVersion)).toBe('1');

    const edited = upsertProfile(saved.profiles, { id: saved.profiles[0].id, instructions: 'Shorter voice.' });
    expect(edited[0].instructions).toBe('Shorter voice.');
    expect(edited[0].id).toBe(saved.profiles[0].id);

    const copied = duplicateProfile(edited, edited[0].id);
    expect(copied).toHaveLength(2);
    expect(copied[1].name).toBe('Alpha copy');
    expect(copied[1].example).toBe(false);
    expect(activeProfile(copied).id).toBe(copied[1].id);

    const second = upsertProfile(copied, { name: 'Beta', instructions: 'Beta voice.' });
    const ordered = reorderProfile(second, second[0].id, 1);
    expect(ordered.map((profile) => profile.name)).toEqual([second[1].name, second[0].name, second[2].name]);
    expect(deleteProfile(ordered, ordered[1].id).some((profile) => profile.id === ordered[1].id)).toBe(false);
    expect(JSON.stringify(loadProjectProfiles(storage))).not.toContain('Example project');
  });

  it('caps instructions and estimates tokens from the live text', () => {
    const long = 'x'.repeat(MAX_PROFILE_INSTRUCTIONS + 40);
    const [profile] = upsertProfile([], { name: 'Long', instructions: long });
    expect(profile.instructions).toHaveLength(MAX_PROFILE_INSTRUCTIONS);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('rejects a color outside the palette and keeps one selection', () => {
    const [profile] = upsertProfile([], { name: 'Paint', color: '#ffffff', selected: true });
    expect(profile.color).toBe('');
    const both = selectProfile([
      { ...profile, selected: true },
      { id: 'b', name: 'Other', selected: true, updatedAt: '2026-11-01T00:00:00.000Z' },
    ], 'b');
    expect(both.filter((item) => item.selected).map((item) => item.id)).toEqual(['b']);
  });
});

describe('project profile migration', () => {
  it('migrates an unversioned object with activeProfileId once and leaves the versioned array alone', () => {
    const storage = memory();
    storage.setItem(storageKeys.projectProfiles, JSON.stringify({
      activeProfileId: 'beta',
      profiles: [sample(), sample({ id: 'beta', name: 'Beta', instructions: 'Beta voice.' })],
    }));
    const first = migrateProjectProfiles(storage);
    expect(first.migrated).toBe(true);
    expect(first.error).toBeNull();
    expect(activeProfile(first.profiles).id).toBe('beta');
    expect(storage.getItem(storageKeys.projectProfilesSchemaVersion)).toBe('1');
    const raw = storage.getItem(storageKeys.projectProfiles);
    const second = migrateProjectProfiles(storage);
    expect(second.migrated).toBe(false);
    expect(storage.getItem(storageKeys.projectProfiles)).toBe(raw);
  });

  it('migrates a bare array and does not wipe an unreadable value', () => {
    const storage = memory();
    storage.setItem(storageKeys.projectProfiles, JSON.stringify([sample({ selected: true })]));
    expect(migrateProjectProfiles(storage).profiles[0].id).toBe('alpha');
    storage.setItem(storageKeys.projectProfiles, '{');
    storage.setItem(storageKeys.projectProfilesSchemaVersion, '1');
    const broken = migrateProjectProfiles(storage);
    expect(broken.profiles).toEqual([]);
    expect(broken.error).toMatch(/could not be read/);
    expect(storage.getItem(storageKeys.projectProfiles)).toBe('{');
  });
});

describe('profile preamble injection', () => {
  const payload = {
    model: 'claude-sonnet-4-6',
    system: 'You are a prompt editor.',
    messages: [{ role: 'user', content: 'Rewrite this $$ prompt' }],
  };
  const profile = sample();

  it('prepends a compact system preamble and leaves the user text untouched', () => {
    const result = applyProfilePreamble(payload, profile);
    expect(result.applied).toBe(true);
    expect(result.payload.system.startsWith('Project profile: Alpha\n')).toBe(true);
    expect(result.payload.system).toContain(profile.instructions);
    expect(result.payload.system.endsWith('\n\nYou are a prompt editor.')).toBe(true);
    expect(result.payload.messages).toEqual(payload.messages);
    expect(result.payload.messages[0].content).toBe('Rewrite this $$ prompt');
    expect(result.payload.model).toBe(payload.model);
  });

  it('stays off when no profile is active', () => {
    const result = applyProfilePreamble(payload, null);
    expect(result).toMatchObject({ applied: false, preamble: '', payload });
    expect(buildProfilePreamble({ name: 'Empty', instructions: '  ', outputFormat: '' })).toBe('');
  });

  it('stays off when the per-run override disables the profile', () => {
    const result = applyProfilePreamble(payload, profile, { disabled: true });
    expect(result.applied).toBe(false);
    expect(result.payload).toEqual(payload);
    expect(result.payload.system).toBe('You are a prompt editor.');
  });

  it('sets system when the payload has none, without adding a user message', () => {
    const run = { messages: [{ role: 'user', content: 'Ship the notes.' }] };
    const result = applyProfilePreamble(run, profile);
    expect(result.payload.messages).toEqual(run.messages);
    expect(result.payload.system).toContain('Output format: A short paragraph');
    expect(result.payload.messages).toHaveLength(1);
  });
});

describe('profile save stamp, suggestion, and import', () => {
  it('records the profile on a saved prompt and leaves older prompts untouched', () => {
    const saved = normalizeEntry({ enhanced: 'Hello there', title: 'Hi', profileId: 'alpha', profileName: 'Alpha' });
    expect(saved.profileId).toBe('alpha');
    expect(saved.profileName).toBe('Alpha');
    expect(normalizeEntry({ enhanced: 'Hello there', title: 'Hi' })).not.toHaveProperty('profileId');
  });

  it('records the profile and adds its default tags only on a new save', () => {
    const profile = { ...sample(), selected: true };
    expect(profileSaveStamp(profile, { isNew: true, tags: ['draft'] })).toEqual({
      profileId: 'alpha', profileName: 'Alpha', tags: ['draft', 'api'],
    });
    expect(profileSaveStamp(profile, { isNew: false, tags: ['draft'] }).tags).toEqual(['draft']);
    expect(profileSaveStamp(profile, { disabled: true, isNew: true, tags: ['draft'] })).toEqual({
      profileId: '', profileName: '', tags: ['draft'],
    });
  });

  it('suggests a profile from a matching tag or folder and ignores a loose name', () => {
    const profiles = [
      sample(),
      sample({ id: 'folder', name: 'Billing', instructions: 'Use invoice terms.', defaultTags: ['accounts'], outputFormat: '' }),
    ];
    expect(suggestProjectProfile(profiles, { tags: ['api'], collection: '' }).id).toBe('alpha');
    expect(suggestProjectProfile(profiles, { tags: [], collection: 'Work/Billing' }).id).toBe('folder');
    expect(suggestProjectProfile(profiles, { tags: ['unrelated'], collection: 'Notes' })).toBeNull();
  });

  it('reads the documented import file and the labelled example', () => {
    const file = profileImportDocument([EXAMPLE_PROJECT_PROFILE]);
    expect(file.kind).toBe('prompt-lab-project-profiles');
    expect(file.profiles[0].example).toBe(true);
    expect(file.profiles[0].name).toBe('Example project');
    expect(file.profiles[0]).not.toHaveProperty('selected');
    const parsed = parseProfileImport(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    expect(parsed.profiles[0].id).toBe('example-project');
    expect(parseProfileImport('{ "kind": "other", "profiles": [] }').ok).toBe(false);
    expect(parseProfileImport({ schemaVersion: 99, profiles: [sample()] }).error).toMatch(/schema 99/);
  });

  it('merges sync copies by id and keeps a newer local edit', () => {
    const local = [sample({ instructions: 'Local voice.', updatedAt: '2026-11-02T00:00:00.000Z', selected: true })];
    const remote = [sample({ instructions: 'Remote voice.', updatedAt: '2026-11-01T00:00:00.000Z', selected: false })];
    const merged = mergeProfileLists(local, remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].instructions).toBe('Local voice.');
    expect(merged[0].selected).toBe(true);
  });
});

describe('profile export download', () => {
  it('downloads the import document', async () => {
    const { downloadProfileExport } = await import('../lib/projectProfiles.js');
    const click = vi.fn();
    const document = downloadProfileExport([sample()], {
      createUrl: () => 'blob:profiles',
      click,
      revoke: () => {},
    });
    expect(document.profiles).toHaveLength(1);
    expect(click).toHaveBeenCalledOnce();
  });
});
