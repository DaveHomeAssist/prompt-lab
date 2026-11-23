// Project profiles: a local voice/stack/audience block sent as a system
// preamble. The user's prompt text is never rewritten to include it.
import { notifyLocalWrite, storageKeys } from './storage.js';
import { normalizeTagList } from './tagSchema.js';
import { ensureString, randomId, safeDate } from './utils.js';

export const PROJECT_PROFILES_SCHEMA_VERSION = 1;
export const PROJECT_PROFILE_IMPORT_KIND = 'prompt-lab-project-profiles';
export const MAX_PROFILE_INSTRUCTIONS = 1500;
export const MAX_PROFILE_OUTPUT_FORMAT = 400;
export const MAX_PROFILE_NAME = 80;
export const PROFILE_COLORS = Object.freeze(['orange', 'violet', 'blue', 'green', 'amber', 'rose', 'slate']);

// Rough live estimate (about 4 characters per token). Not a provider tokenizer.
export function estimateTokens(text) {
  const length = [...String(text || '')].length;
  if (!length) return 0;
  return Math.ceil(length / 4);
}

/** One generic example. It is not written into storage until someone imports it. */
export const EXAMPLE_PROJECT_PROFILE = Object.freeze({
  id: 'example-project',
  name: 'Example project',
  example: true,
  emoji: '📘',
  color: 'blue',
  instructions: 'Write for a general software project. Use plain language, name the audience when it matters, prefer terms already used in the prompt, and do not invent a stack, deadline, or product name that was not given. Keep the answer specific and ready to use.',
  defaultTags: Object.freeze(['example']),
  outputFormat: 'Short sections with the direct answer first.',
});

function storageOf(storage) {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function normalizeProfile(raw, now = new Date().toISOString()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const name = ensureString(raw.name).trim().slice(0, MAX_PROFILE_NAME);
  if (!name) return null;
  const createdAt = safeDate(raw.createdAt || now);
  const updatedAt = raw.updatedAt ? safeDate(raw.updatedAt) : createdAt;
  const emoji = [...ensureString(raw.emoji).trim()].slice(0, 4).join('');
  return {
    id: ensureString(raw.id).trim() || randomId(),
    name,
    emoji,
    color: PROFILE_COLORS.includes(raw.color) ? raw.color : '',
    instructions: ensureString(raw.instructions).slice(0, MAX_PROFILE_INSTRUCTIONS),
    defaultTags: normalizeTagList(raw.defaultTags).slice(0, 12),
    outputFormat: ensureString(raw.outputFormat).trim().slice(0, MAX_PROFILE_OUTPUT_FORMAT),
    example: raw.example === true,
    selected: raw.selected === true,
    createdAt,
    updatedAt,
  };
}

function keepOneSelection(profiles) {
  const selected = profiles.filter((profile) => profile.selected);
  if (selected.length <= 1) return profiles;
  const winner = selected.reduce((best, profile) => (profile.updatedAt > best.updatedAt ? profile : best));
  return profiles.map((profile) => ({ ...profile, selected: profile.id === winner.id }));
}

export function normalizeProfiles(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const profiles = [];
  list.forEach((raw, index) => {
    const profile = normalizeProfile(raw, new Date(Date.now() - index).toISOString());
    if (!profile) return;
    if (seen.has(profile.id)) profile.id = randomId();
    seen.add(profile.id);
    profiles.push(profile);
  });
  return keepOneSelection(profiles);
}

export function activeProfile(profiles) {
  return normalizeProfiles(profiles).find((profile) => profile.selected) || null;
}

export function selectProfile(profiles, id) {
  const nextId = ensureString(id).trim();
  return normalizeProfiles(profiles).map((profile) => ({ ...profile, selected: Boolean(nextId) && profile.id === nextId }));
}

export function upsertProfile(profiles, draft) {
  const list = normalizeProfiles(profiles);
  const now = new Date().toISOString();
  const current = draft?.id ? list.find((profile) => profile.id === draft.id) : null;
  const next = normalizeProfile({
    ...(current || {}),
    ...draft,
    id: current?.id || draft?.id || randomId(),
    createdAt: current?.createdAt || now,
    updatedAt: now,
    selected: draft?.selected != null ? draft.selected : (current ? current.selected : true),
  }, now);
  if (!next) return list;
  const without = list.filter((profile) => profile.id !== next.id);
  const inserted = current
    ? list.map((profile) => (profile.id === next.id ? next : profile))
    : [...without, next];
  return next.selected ? selectProfile(inserted, next.id) : normalizeProfiles(inserted);
}

export function duplicateProfile(profiles, id) {
  const source = normalizeProfiles(profiles).find((profile) => profile.id === id);
  if (!source) return normalizeProfiles(profiles);
  return upsertProfile(profiles, {
    name: `${source.name} copy`.slice(0, MAX_PROFILE_NAME),
    emoji: source.emoji,
    color: source.color,
    instructions: source.instructions,
    defaultTags: source.defaultTags,
    outputFormat: source.outputFormat,
    example: false,
    selected: true,
  });
}

export function deleteProfile(profiles, id) {
  return normalizeProfiles(profiles).filter((profile) => profile.id !== id);
}

export function reorderProfile(profiles, id, direction) {
  const list = normalizeProfiles(profiles);
  const index = list.findIndex((profile) => profile.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  return copy;
}

/** Union by id. A strictly newer updatedAt wins; a tie keeps the remote copy. */
export function mergeProfileLists(local = [], remote = []) {
  const locals = normalizeProfiles(local);
  const remotes = normalizeProfiles(remote);
  const byId = new Map(remotes.map((profile) => [profile.id, profile]));
  for (const profile of locals) {
    const existing = byId.get(profile.id);
    if (!existing || profile.updatedAt > existing.updatedAt) byId.set(profile.id, profile);
  }
  const order = [...remotes.map((profile) => profile.id), ...locals.map((profile) => profile.id)];
  const seen = new Set();
  const merged = [];
  for (const id of order) {
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    merged.push(byId.get(id));
  }
  const localActive = locals.find((profile) => profile.selected);
  if (localActive && merged.some((profile) => profile.id === localActive.id)) return selectProfile(merged, localActive.id);
  return normalizeProfiles(merged);
}

export function buildProfilePreamble(profile) {
  const current = profile ? normalizeProfile(profile) : null;
  if (!current) return '';
  const instructions = current.instructions.trim();
  const outputFormat = current.outputFormat.trim();
  if (!instructions && !outputFormat) return '';
  const lines = [`Project profile: ${current.name}`];
  if (instructions) lines.push(instructions);
  if (outputFormat) lines.push(`Output format: ${outputFormat}`);
  return lines.join('\n');
}

/**
 * Attach the profile as a system preamble. User and assistant messages, and
 * every other payload field, stay as they were. `disabled` is the per-run
 * override. A missing profile is the off state.
 */
export function applyProfilePreamble(payload, profile, { disabled = false } = {}) {
  const base = payload && typeof payload === 'object' ? payload : {};
  const preamble = disabled ? '' : buildProfilePreamble(profile);
  if (!preamble) return { payload: base, applied: false, preamble: '' };
  const system = ensureString(base.system).trim();
  return {
    payload: { ...base, system: system ? `${preamble}\n\n${system}` : preamble },
    applied: true,
    preamble,
  };
}

export function profileSaveStamp(profile, { disabled = false, isNew = false, tags = [] } = {}) {
  const current = !disabled && profile ? normalizeProfile(profile) : null;
  if (!current) return { profileId: '', profileName: '', tags };
  const nextTags = isNew ? normalizeTagList([...(Array.isArray(tags) ? tags : []), ...current.defaultTags]) : tags;
  return { profileId: current.id, profileName: current.name, tags: nextTags };
}

function foldToken(value, into) {
  const text = ensureString(value).trim().toLowerCase();
  if (!text) return;
  into.add(text);
  text.split(/[/>:|]+/).forEach((part) => {
    const bit = part.trim();
    if (bit) into.add(bit);
  });
}

/** Suggest a profile when its name or default tags match a prompt's tags or folder. */
export function suggestProjectProfile(profiles, { tags = [], collection = '' } = {}) {
  const tokens = new Set();
  (Array.isArray(tags) ? tags : []).forEach((tag) => foldToken(tag, tokens));
  foldToken(collection, tokens);
  let best = null;
  let bestScore = 0;
  for (const profile of normalizeProfiles(profiles)) {
    let score = 0;
    const name = profile.name.trim().toLowerCase();
    if (name && tokens.has(name)) score += 2;
    for (const tag of profile.defaultTags) {
      if (tokens.has(tag.toLowerCase())) score += 3;
    }
    if (score > bestScore) {
      best = profile;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

export function profileImportDocument(profiles) {
  return {
    schemaVersion: PROJECT_PROFILES_SCHEMA_VERSION,
    kind: PROJECT_PROFILE_IMPORT_KIND,
    profiles: normalizeProfiles(profiles).map(({ selected, ...profile }) => profile),
  };
}

export function parseProfileImport(source) {
  let parsed = source;
  if (typeof source === 'string') {
    try { parsed = JSON.parse(source); }
    catch { return { ok: false, profiles: [], error: 'That file is not valid JSON.' }; }
  }
  const body = Array.isArray(parsed) ? { profiles: parsed } : parsed;
  if (!body || typeof body !== 'object') return { ok: false, profiles: [], error: 'Expected a project profile file.' };
  if (body.schemaVersion != null && Number(body.schemaVersion) > PROJECT_PROFILES_SCHEMA_VERSION) {
    return { ok: false, profiles: [], error: `This file uses profile schema ${body.schemaVersion}, which this version of Prompt Lab cannot read.` };
  }
  if (body.kind != null && body.kind !== PROJECT_PROFILE_IMPORT_KIND) {
    return { ok: false, profiles: [], error: 'This JSON file is not a Prompt Lab project profile file.' };
  }
  if (!Array.isArray(body.profiles)) return { ok: false, profiles: [], error: 'The profile file needs a profiles array.' };
  const profiles = normalizeProfiles(body.profiles);
  if (!profiles.length) return { ok: false, profiles: [], error: 'No profiles with a name were found in that file.' };
  return { ok: true, profiles, error: '' };
}

function readRaw(storage) {
  const store = storageOf(storage);
  if (!store) return { store: null, raw: null, version: null, error: 'Storage is unavailable.' };
  return { store, raw: store.getItem(storageKeys.projectProfiles), version: store.getItem(storageKeys.projectProfilesSchemaVersion), error: null };
}

export function writeProjectProfiles(profiles, storage) {
  const { store, error } = readRaw(storage);
  const normalized = normalizeProfiles(profiles);
  if (!store) return { ok: false, profiles: normalized, error: error || 'Storage is unavailable.' };
  try {
    store.setItem(storageKeys.projectProfiles, JSON.stringify(normalized));
    store.setItem(storageKeys.projectProfilesSchemaVersion, String(PROJECT_PROFILES_SCHEMA_VERSION));
    notifyLocalWrite(storageKeys.projectProfiles);
    return { ok: true, profiles: normalized, error: '' };
  } catch {
    return { ok: false, profiles: normalized, error: 'Project profiles could not be saved. Browser storage may be full.' };
  }
}

/**
 * Read profiles, migrating an unversioned array or `{ profiles, activeProfileId }`
 * object into the versioned array. A missing key stays missing until the first save.
 */
export function migrateProjectProfiles(storage) {
  const { store, raw, version, error } = readRaw(storage);
  if (!store) return { migrated: false, profiles: [], error };
  if (raw == null) return { migrated: false, profiles: [], error: null };
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { migrated: false, profiles: [], error: 'Saved project profiles could not be read.' }; }

  let source = null;
  let activeId = '';
  if (Array.isArray(parsed)) source = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.profiles)) {
    source = parsed.profiles;
    activeId = ensureString(parsed.activeProfileId).trim();
  }
  if (!source) return { migrated: false, profiles: [], error: 'Saved project profiles were not in a recognized shape.' };

  const profiles = normalizeProfiles(source.map((profile) => (
    activeId && profile?.id === activeId ? { ...profile, selected: true } : profile
  )));
  const alreadyCurrent = version === String(PROJECT_PROFILES_SCHEMA_VERSION) && JSON.stringify(profiles) === JSON.stringify(parsed);
  if (alreadyCurrent) return { migrated: false, profiles, error: null };
  const written = writeProjectProfiles(profiles, store);
  return { migrated: true, profiles: written.profiles, error: written.ok ? null : written.error };
}

export function loadProjectProfiles(storage) {
  return migrateProjectProfiles(storage).profiles;
}

export function downloadProfileExport(profiles, { createUrl = URL.createObjectURL, click = (anchor) => anchor.click(), revoke = URL.revokeObjectURL } = {}) {
  const document = profileImportDocument(profiles);
  const url = createUrl(new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' }));
  const anchor = globalThis.document
    ? Object.assign(globalThis.document.createElement('a'), { href: url, download: 'prompt-lab-project-profiles.json' })
    : { href: url, download: 'prompt-lab-project-profiles.json' };
  click(anchor);
  setTimeout(() => revoke(url), 0);
  return document;
}
