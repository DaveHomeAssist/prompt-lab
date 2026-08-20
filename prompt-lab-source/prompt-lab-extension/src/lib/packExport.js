/**
 * Pack authoring — turn selected library entries into a schema-valid preset pack
 * (docs/preset-pack-schema.json shape) that round-trips through the existing
 * preset import pipeline.
 */
import { ensureString } from './utils.js';

function slugify(value, fallback = 'pack') {
  const slug = ensureString(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || fallback;
}

export function exportPackFromEntries(entries, { id, title, version = '1.0.0', description = '' } = {}) {
  const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
  const packTitle = ensureString(title).trim() || 'Untitled Pack';
  const packId = slugify(id || packTitle);
  const stamp = new Date().toISOString().slice(0, 10);
  const usedIds = new Set();

  const presets = list.map((entry) => {
    const baseId = slugify(entry.title, 'prompt');
    let presetId = baseId;
    let suffix = 2;
    while (usedIds.has(presetId)) {
      presetId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(presetId);
    const promptText = ensureString(entry.enhanced).trim() || ensureString(entry.original);
    return {
      id: presetId,
      title: ensureString(entry.title).trim() || 'Untitled',
      category: ensureString(entry.collection),
      status: 'ready',
      tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
      summary: ensureString(entry.notes).slice(0, 280),
      prompt: promptText,
      original: ensureString(entry.original),
      enhanced: ensureString(entry.enhanced),
      variants: Array.isArray(entry.variants) ? entry.variants : [],
      notes: ensureString(entry.notes),
      resultMeta: entry.resultMeta || null,
      inputs: Array.isArray(entry.inputs) ? entry.inputs : [],
      versions: Array.isArray(entry.versions) ? entry.versions : [],
      testCases: Array.isArray(entry.testCases) ? entry.testCases : [],
      goldenResponse: entry.goldenResponse || null,
      goldenThreshold: entry.goldenThreshold,
      favorite: entry.favorite === true,
      completeness: entry.completeness || null,
      kind: entry.kind || 'prompt',
      sourceNoteId: ensureString(entry.sourceNoteId),
      deletedAt: entry.deletedAt || null,
      tombstoneVersion: entry.tombstoneVersion || 0,
      useCount: Number.isFinite(entry.useCount) ? entry.useCount : 0,
      lastAccessedAt: entry.lastAccessedAt || null,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt || entry.updated_at,
      metadata: entry.metadata || {},
    };
  });

  return {
    version: ensureString(version).trim() || '1.0.0',
    type: 'prompt-pack',
    id: packId,
    title: packTitle,
    description: ensureString(description),
    createdAt: stamp,
    updatedAt: stamp,
    presets,
  };
}

export function encodePackShare(pack) {
  const json = JSON.stringify(pack);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function decodePackShare(value) {
  try {
    const normalized = ensureString(value).replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export function buildPackShareUrl(pack, locationLike = window.location) {
  const origin = ensureString(locationLike?.origin);
  const pathname = ensureString(locationLike?.pathname) || '/';
  return `${origin}${pathname}#pack=${encodePackShare(pack)}`;
}
