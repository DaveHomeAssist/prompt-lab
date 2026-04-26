// Prompt Packs v1 — store helpers backing the `pl2-packs-v1` localStorage key.
//
// Storage shape (matches spec §5.1, but renamed to avoid colliding with
// the legacy `pl2-loaded-packs` key which already holds a flat string[]
// of starter-pack ids in lib/seedTransform.js):
//
//   type LoadedPacksState = {
//     schema: 1;
//     packs: { [packId]: PackEntry };
//     order: string[];                  // packId display order
//   };
//
//   type PackEntry = {
//     manifest:       PackJSON;          // the validated, imported document
//     enabled:        boolean;           // user toggle (false = soft mute)
//     installedAt:    string;            // ISO 8601
//     updatedAt:      string;            // ISO 8601
//     source:         'file' | 'url' | 'share';
//     sourceRef?:     string;            // origin URL when source !== 'file'
//     pinnedVersion?: string;            // pinned semver; skip auto-update
//     lastCheckedAt?: string;            // ISO 8601, last update poll
//     lastError?:     string;            // last import/update error
//   };
//
// Pack prompts are merged into the Library view via `mergedPackPrompts()`.
// The merger flags each prompt with `__pack: { packId, packName, readOnly }`
// so the LibraryPanel can render the read-only badge / "from <pack>" hint.
// User prompts in `pl2-library` are never written to by this module.

import { loadJson, saveJson, storageKeys } from '../storage.js';

const SCHEMA = 1;

function emptyState() {
  return { schema: SCHEMA, packs: {}, order: [] };
}

function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

function normalize(raw) {
  // Tolerant hydrate — silently coerce malformed shapes back to empty so a
  // bad write or schema bump doesn't brick the Library.
  if (!isPlainObject(raw)) return emptyState();
  if (raw.schema !== SCHEMA) return emptyState();
  if (!isPlainObject(raw.packs)) return emptyState();
  if (!Array.isArray(raw.order)) {
    return { ...raw, order: Object.keys(raw.packs) };
  }
  return { schema: SCHEMA, packs: raw.packs, order: raw.order };
}

export function loadPacksState() {
  return normalize(loadJson(storageKeys.packsV1, emptyState()));
}

export function savePacksState(state) {
  saveJson(storageKeys.packsV1, normalize(state));
  return state;
}

// ── Mutators (pure: take state in, return state out) ────────────────────

// Install or reinstall (idempotent overwrite). Caller is responsible for
// running the validator first; this trusts `manifest`.
export function installPack(state, manifest, source = 'file', sourceRef) {
  const now = new Date().toISOString();
  const existing = state.packs[manifest.id];
  const nextPacks = {
    ...state.packs,
    [manifest.id]: {
      manifest,
      enabled: existing ? existing.enabled : true,
      installedAt: existing ? existing.installedAt : now,
      updatedAt: now,
      source,
      sourceRef,
      pinnedVersion: existing?.pinnedVersion,
      lastCheckedAt: existing?.lastCheckedAt,
      lastError: undefined,
    },
  };
  const nextOrder = state.order.includes(manifest.id)
    ? state.order
    : [...state.order, manifest.id];
  return { ...state, packs: nextPacks, order: nextOrder };
}

export function setPackEnabled(state, packId, enabled) {
  const entry = state.packs[packId];
  if (!entry) return state;
  return {
    ...state,
    packs: { ...state.packs, [packId]: { ...entry, enabled: Boolean(enabled) } },
  };
}

export function setPackPinned(state, packId, pinnedVersion) {
  const entry = state.packs[packId];
  if (!entry) return state;
  return {
    ...state,
    packs: {
      ...state.packs,
      [packId]: { ...entry, pinnedVersion: pinnedVersion || undefined },
    },
  };
}

export function setPackLastChecked(state, packId, lastCheckedAt = new Date().toISOString()) {
  const entry = state.packs[packId];
  if (!entry) return state;
  return {
    ...state,
    packs: { ...state.packs, [packId]: { ...entry, lastCheckedAt } },
  };
}

export function setPackLastError(state, packId, lastError) {
  const entry = state.packs[packId];
  if (!entry) return state;
  return {
    ...state,
    packs: { ...state.packs, [packId]: { ...entry, lastError } },
  };
}

export function uninstallPack(state, packId) {
  if (!state.packs[packId]) return state;
  const { [packId]: _omit, ...rest } = state.packs;
  return {
    schema: SCHEMA,
    packs: rest,
    order: state.order.filter((id) => id !== packId),
  };
}

export function reorderPacks(state, nextOrder) {
  const safe = nextOrder.filter((id) => state.packs[id]);
  // Append any pack ids missing from caller-supplied order so we never
  // accidentally hide a pack via a partial reorder.
  for (const id of Object.keys(state.packs)) {
    if (!safe.includes(id)) safe.push(id);
  }
  return { ...state, order: safe };
}

// ── Derivations ─────────────────────────────────────────────────────────

// Flatten enabled packs' prompts into a Library-ready array. Each row is
// stamped with __pack metadata so the LibraryPanel can render the read-only
// badge and the "from <pack>" hint. Prompt id is fully-qualified
// `<packId>/<promptId>` so user prompts never collide.
export function mergedPackPrompts(state) {
  const out = [];
  for (const packId of state.order) {
    const entry = state.packs[packId];
    if (!entry || !entry.enabled) continue;
    const { manifest } = entry;
    if (!Array.isArray(manifest?.prompts)) continue;
    for (const p of manifest.prompts) {
      out.push({
        id: `${packId}/${p.id}`,
        title: p.name,
        original: '',
        enhanced: p.body || '',
        notes: '',
        tags: Array.isArray(p.tags) ? p.tags : [],
        collection: '',
        createdAt: entry.installedAt,
        updatedAt: entry.updatedAt,
        useCount: 0,
        versions: [],
        variants: [],
        metadata: {
          packLoadedAt: entry.installedAt,
          // Feature-detect at render time:
          //   if (entry.metadata?.__pack) { renderReadOnlyBadge(...) }
          __pack: {
            packId,
            packName: manifest.name,
            packVersion: manifest.version,
            readOnly: true,
            category: p.category,
          },
        },
      });
    }
  }
  return out;
}
