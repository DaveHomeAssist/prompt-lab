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
    let presetId = slugify(entry.title, 'prompt');
    while (usedIds.has(presetId)) presetId = `${presetId}-2`;
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
