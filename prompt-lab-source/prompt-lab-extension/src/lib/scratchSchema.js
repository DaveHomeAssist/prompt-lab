import { logWarn } from './logger.js';
import { storageKeys } from './storage.js';

export const LEGACY_SCRATCH_KEY = storageKeys.pad;
export const LEGACY_SCRATCH_META_KEY = `${storageKeys.pad}_meta`;
export const SCRATCH_KEY = 'pl2-pads';
export const SCRATCH_SCHEMA_VERSION_KEY = 'pl2-pads-schema-version';
export const SCRATCH_SCHEMA_VERSION = '4';

export const DEFAULT_SCRATCH_ID = 'default';
export const DEFAULT_SCRATCH_NAME = 'Scratchpad';

const VALID_STATUSES = new Set(['idea', 'working', 'ready', 'archived']);
const VALID_COLORS = new Set(['orange', 'violet', 'blue', 'green', 'amber', 'rose', 'slate']);

function finiteTimestamp(value, fallback) {
  if (Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value) {
    const parsed = new Date(value).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function normalizePromptLinks(links, legacyId = '', legacyTitle = '') {
  const normalized = Array.isArray(links)
    ? links.flatMap((link) => {
      if (!link || typeof link !== 'object' || typeof link.id !== 'string' || !link.id.trim()) return [];
      return [{
        ...link,
        id: link.id.trim(),
        title: typeof link.title === 'string' ? link.title : '',
        linkedAt: finiteTimestamp(link.linkedAt, 0),
        selectionOnly: Boolean(link.selectionOnly),
        kind: link.kind === 'template' ? 'template' : 'working-prompt',
      }];
    })
    : [];

  if (legacyId && !normalized.some((link) => link.id === legacyId)) {
    normalized.push({
      id: legacyId,
      title: legacyTitle || '',
      linkedAt: 0,
      selectionOnly: false,
      kind: 'working-prompt',
    });
  }

  return normalized;
}

export function normalizeScratchPad(pad, index = 0, now = Date.now()) {
  const source = pad && typeof pad === 'object' ? pad : {};
  const updatedAt = finiteTimestamp(source.updatedAt, finiteTimestamp(source.timestamp, now));
  const createdAt = finiteTimestamp(source.createdAt, updatedAt);
  const linkedPromptId = typeof source.linkedPromptId === 'string' ? source.linkedPromptId : '';
  const linkedPromptTitle = typeof source.linkedPromptTitle === 'string' ? source.linkedPromptTitle : '';

  return {
    ...source,
    id: typeof source.id === 'string' && source.id ? source.id : `pad-${index + 1}`,
    name: typeof source.name === 'string' && source.name.trim()
      ? source.name.trim()
      : index === 0 ? DEFAULT_SCRATCH_NAME : `Note ${index + 1}`,
    content: typeof source.content === 'string' ? source.content : '',
    createdAt,
    updatedAt,
    // Keep timestamp as a v1-v3 compatibility alias for existing readers.
    timestamp: updatedAt,
    pinned: Boolean(source.pinned),
    status: VALID_STATUSES.has(source.status) ? source.status : 'idea',
    color: VALID_COLORS.has(source.color) ? source.color : 'orange',
    tags: normalizeTags(source.tags),
    linkedPromptId,
    linkedPromptTitle,
    linkedPrompts: normalizePromptLinks(source.linkedPrompts, linkedPromptId, linkedPromptTitle),
  };
}

export function buildDefaultScratchPayload(content = '', timestamp = Date.now()) {
  const updatedAt = finiteTimestamp(timestamp, Date.now());
  return {
    pads: [normalizeScratchPad({
      id: DEFAULT_SCRATCH_ID,
      name: DEFAULT_SCRATCH_NAME,
      content,
      createdAt: updatedAt,
      updatedAt,
    }, 0, updatedAt)],
    activePadId: DEFAULT_SCRATCH_ID,
    revision: 0,
    tombstones: {},
  };
}

export function normalizeScratchPayload(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.pads) || value.pads.length === 0) {
    return null;
  }

  const tombstones = value.tombstones && typeof value.tombstones === 'object'
    ? Object.fromEntries(Object.entries(value.tombstones)
      .filter(([id, timestamp]) => id && Number.isFinite(timestamp)))
    : {};
  const pads = value.pads
    .map((pad, index) => normalizeScratchPad(pad, index, now))
    .filter((pad) => !tombstones[pad.id] || pad.updatedAt > tombstones[pad.id]);
  if (pads.length === 0) return null;

  const requestedActiveId = typeof value.activePadId === 'string' ? value.activePadId : '';
  return {
    ...value,
    pads,
    activePadId: pads.some((pad) => pad.id === requestedActiveId) ? requestedActiveId : pads[0].id,
    revision: Number.isFinite(value.revision) ? value.revision : 0,
    tombstones,
  };
}

export function readScratchPayload(storage = localStorage) {
  try {
    const raw = storage.getItem(SCRATCH_KEY);
    if (!raw) return null;
    return normalizeScratchPayload(JSON.parse(raw));
  } catch (error) {
    logWarn('read scratch payload', error);
    return null;
  }
}

function parseSavedTimestamp(raw, now = Date.now()) {
  return finiteTimestamp(raw, now);
}

export function migrateScratchStorage(storage = localStorage, now = Date.now()) {
  let payload = null;
  let legacyContent = '';
  let legacyMeta = '';
  let errorStage = 'read';
  try {
    const raw = storage.getItem(SCRATCH_KEY);
    if (raw) {
      payload = normalizeScratchPayload(JSON.parse(raw), now);
      if (!payload) throw new Error('Stored Scratch notes have an invalid format.');
    }
    const previousVersion = storage.getItem(SCRATCH_SCHEMA_VERSION_KEY);
    if (payload) {
      if (previousVersion !== SCRATCH_SCHEMA_VERSION) {
        errorStage = 'write';
        storage.setItem(SCRATCH_KEY, JSON.stringify(payload));
        storage.setItem(SCRATCH_SCHEMA_VERSION_KEY, SCRATCH_SCHEMA_VERSION);
      }
      return {
        migrated: previousVersion !== SCRATCH_SCHEMA_VERSION,
        payload,
        error: null,
      };
    }

    legacyContent = storage.getItem(LEGACY_SCRATCH_KEY) || '';
    legacyMeta = storage.getItem(LEGACY_SCRATCH_META_KEY) || '';
    if (!legacyContent) {
      legacyContent = storage.getItem('pl-pad') || '';
      legacyMeta = storage.getItem('pl-pad_meta') || '';
    }

    payload = buildDefaultScratchPayload(legacyContent, parseSavedTimestamp(legacyMeta, now));
    errorStage = 'write';
    storage.setItem(SCRATCH_KEY, JSON.stringify(payload));
    storage.setItem(SCRATCH_SCHEMA_VERSION_KEY, SCRATCH_SCHEMA_VERSION);

    // Destructive cleanup occurs only after both v4 writes succeed.
    storage.removeItem(LEGACY_SCRATCH_KEY);
    storage.removeItem(LEGACY_SCRATCH_META_KEY);
    storage.removeItem('pl-pad');
    storage.removeItem('pl-pad_meta');

    return { migrated: true, payload, error: null };
  } catch (error) {
    logWarn('scratch schema migration', error);
    // A write failure must not replace already-readable notes, and a read
    // failure must not trigger another storage read from the recovery path.
    return {
      migrated: false,
      payload: payload || buildDefaultScratchPayload(legacyContent, parseSavedTimestamp(legacyMeta, now)),
      error,
      errorStage,
    };
  }
}

export function mergeScratchPayloads(local, stored, { preferLocalIds = [], removedIds = [] } = {}) {
  const preferred = new Set(preferLocalIds);
  const removed = new Set(removedIds);
  const tombstones = { ...(stored.tombstones || {}), ...(local.tombstones || {}) };
  removed.forEach((id) => {
    tombstones[id] = Math.max(tombstones[id] || 0, Date.now());
  });

  const byId = new Map();
  stored.pads.forEach((pad) => byId.set(pad.id, pad));
  local.pads.forEach((pad) => {
    const external = byId.get(pad.id);
    if (!external || preferred.has(pad.id) || pad.updatedAt >= external.updatedAt) {
      byId.set(pad.id, pad);
    }
  });

  const pads = [...byId.values()]
    .filter((pad) => !removed.has(pad.id))
    .filter((pad) => !tombstones[pad.id] || pad.updatedAt > tombstones[pad.id])
    .map((pad, index) => normalizeScratchPad(pad, index));

  const activePadId = pads.some((pad) => pad.id === local.activePadId)
    ? local.activePadId
    : pads.some((pad) => pad.id === stored.activePadId)
      ? stored.activePadId
      : pads[0]?.id || '';

  return { ...local, pads, activePadId, tombstones };
}

export function persistScratchState(nextState, {
  storage = localStorage,
  lastKnownRevision = 0,
  preferLocalIds = [],
  removedIds = [],
} = {}) {
  try {
    const normalized = normalizeScratchPayload(nextState);
    if (!normalized) throw new Error('Scratch state must contain at least one note');
    const stored = readScratchPayload(storage);
    const candidate = stored && stored.revision !== lastKnownRevision
      ? mergeScratchPayloads(normalized, stored, { preferLocalIds, removedIds })
      : mergeScratchPayloads(normalized, normalized, { preferLocalIds, removedIds });
    const payload = {
      ...candidate,
      revision: Math.max(stored?.revision || 0, lastKnownRevision) + 1,
    };
    storage.setItem(SCRATCH_KEY, JSON.stringify(payload));
    storage.setItem(SCRATCH_SCHEMA_VERSION_KEY, SCRATCH_SCHEMA_VERSION);
    return { ok: true, state: payload };
  } catch (error) {
    logWarn('persist scratch state (quota exceeded?)', error);
    return { ok: false, state: nextState, error };
  }
}
