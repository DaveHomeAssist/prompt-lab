import presetPackSchema from '../../../docs/preset-pack-schema.json';
import { createPromptEntry, normalizeLibrary } from './promptSchema.js';
import { ensureString } from './utils.js';

const PACK_REQUIRED_FIELDS = ['version', 'type', 'id', 'title', 'presets'];
const PRESET_REQUIRED_FIELDS = ['id', 'title', 'prompt'];
const PRESET_WARNING_FIELDS = ['summary', 'tags', 'category'];
const TEXT_HASH_SLICE = 200;
const TITLE_SIMILARITY_THRESHOLD = 0.65;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizePromptText(value) {
  return ensureString(value).replace(/\s+/g, ' ').trim();
}

function summarizeItem(item) {
  return {
    id: ensureString(item?.id),
    title: ensureString(item?.title).trim() || 'Untitled',
  };
}

function normalizePresetInputs(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((input) => {
      if (!input || typeof input !== 'object') return null;
      const key = ensureString(input.key).trim();
      if (!key) return null;
      const type = ensureString(input.type).trim().toLowerCase() || 'text';
      const options = Array.isArray(input.options)
        ? input.options
            .map((option) => {
              if (typeof option === 'string') {
                const text = option.trim();
                return text ? { label: text, value: text } : null;
              }
              if (!option || typeof option !== 'object') return null;
              const valueText = ensureString(option.value).trim() || ensureString(option.label).trim();
              if (!valueText) return null;
              return {
                label: ensureString(option.label).trim() || valueText,
                value: valueText,
              };
            })
            .filter(Boolean)
        : [];

      return {
        key,
        label: ensureString(input.label).trim() || key,
        type,
        required: Boolean(input.required),
        placeholder: ensureString(input.placeholder),
        options,
      };
    })
    .filter(Boolean);
}

function stablePromptHash(value) {
  const text = normalizePromptText(value).slice(0, TEXT_HASH_SLICE);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(index);
    hash >>>= 0;
  }
  return hash.toString(16);
}

function longestCommonSubsequenceLength(left, right) {
  const a = ensureString(left);
  const b = ensureString(right);
  if (!a || !b) return 0;
  const rows = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const cached = rows[j];
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {
        rows[j] = diagonal + 1;
      } else {
        rows[j] = Math.max(rows[j], rows[j - 1]);
      }
      diagonal = cached;
    }
  }
  return rows[b.length];
}

function similarityRatio(left, right) {
  const a = normalizePromptText(left).toLowerCase();
  const b = normalizePromptText(right).toLowerCase();
  const maxLength = Math.max(a.length, b.length);
  if (!maxLength) return 1;
  return longestCommonSubsequenceLength(a, b) / maxLength;
}

function describeSchemaTitle() {
  return ensureString(presetPackSchema?.title || presetPackSchema?.name || 'preset pack schema');
}

async function readExistingLibrary(storageAdapter) {
  if (storageAdapter && typeof storageAdapter.load === 'function') {
    return await storageAdapter.load();
  }
  if (storageAdapter && typeof storageAdapter.get === 'function') {
    return await storageAdapter.get();
  }
  if (storageAdapter && typeof storageAdapter.read === 'function') {
    return await storageAdapter.read();
  }
  if (Array.isArray(storageAdapter?.library)) {
    return storageAdapter.library;
  }
  return [];
}

function makeImportedId(baseId, usedIds) {
  const cleanBase = ensureString(baseId).trim() || 'preset-import';
  if (!usedIds.has(cleanBase)) {
    usedIds.add(cleanBase);
    return cleanBase;
  }
  let nextId = `${cleanBase}-imported`;
  let suffix = 2;
  while (usedIds.has(nextId)) {
    nextId = `${cleanBase}-imported-${suffix}`;
    suffix += 1;
  }
  usedIds.add(nextId);
  return nextId;
}

/**
 * Compute area and format breakdown stats for a preset array.
 * @param {Array<object>} presets
 * @returns {{ byArea: object, byFormat: object }}
 */
export function computePackStats(presets) {
  const byArea = {};
  const byFormat = {};
  for (const p of asArray(presets)) {
    const area = ensureString(p.category) || 'Uncategorized';
    const fmt = ensureString(p.format) || 'Single Prompt';
    byArea[area] = (byArea[area] || 0) + 1;
    byFormat[fmt] = (byFormat[fmt] || 0) + 1;
  }
  return { byArea, byFormat };
}

/**
 * Build library entries from a preset pack with skip/replace resolution.
 * Does NOT persist — caller is responsible for saving.
 * @param {object} pack - Validated preset pack
 * @param {Set} skipIds - Preset IDs to skip
 * @param {Map} replaceMap - Map of preset ID → existing entry ID to replace
 * @returns {{ entries: Array, imported: number, skipped: number, drafts: number }}
 */
export function buildImportEntries(pack, skipIds = new Set(), replaceMap = new Map()) {
  const entries = [];
  let skipped = 0;
  let drafts = 0;

  for (const preset of asArray(pack?.presets)) {
    const presetId = ensureString(preset.id);
    if (skipIds.has(presetId)) { skipped++; continue; }

    const promptText = ensureString(preset.prompt);
    const isDraft = !promptText.trim();
    const now = new Date().toISOString();
    const entry = createPromptEntry({
      id: replaceMap.has(presetId) ? replaceMap.get(presetId) : undefined,
      title: ensureString(preset.title).trim() || 'Untitled',
      original: promptText,
      enhanced: promptText,
      notes: ensureString(preset.summary),
      tags: Array.isArray(preset.tags) ? preset.tags.filter(Boolean) : [],
      collection: ensureString(preset.category),
      metadata: {
        owner: ensureString(pack?.title),
        purpose: ensureString(preset.summary),
        status: isDraft ? 'draft' : ensureString(preset.status) || 'active',
        compatibility: Array.isArray(preset.platforms) ? preset.platforms : [],
        riskLevel: '',
      },
    });

    if (isDraft) drafts++;
    entries.push(entry);
  }

  return { entries, imported: entries.length, skipped, drafts };
}

/**
 * Validate a preset pack against the documented pack structure.
 *
 * @param {unknown} json
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validatePresetPack(json) {
  const errors = [];
  const warnings = [];

  if (!isObject(json)) {
    return {
      valid: false,
      errors: [`${describeSchemaTitle()} expects a top-level object.`],
      warnings,
    };
  }

  PACK_REQUIRED_FIELDS.forEach((field) => {
    if (!hasOwn(json, field)) {
      errors.push(`Missing required pack field: ${field}`);
    }
  });

  if (hasOwn(json, 'type') && ensureString(json.type) !== ensureString(presetPackSchema.type)) {
    errors.push(`Pack type must be "${presetPackSchema.type}".`);
  }

  if (hasOwn(json, 'version') && typeof json.version !== 'string') {
    errors.push('Pack version must be a string.');
  }

  if (hasOwn(json, 'id') && typeof json.id !== 'string') {
    errors.push('Pack id must be a string.');
  }

  if (hasOwn(json, 'title') && typeof json.title !== 'string') {
    errors.push('Pack title must be a string.');
  }

  if (!Array.isArray(json.presets)) {
    errors.push('Pack presets must be an array.');
  }

  asArray(json.presets).forEach((preset, index) => {
    if (!isObject(preset)) {
      errors.push(`Preset ${index + 1} must be an object.`);
      return;
    }

    PRESET_REQUIRED_FIELDS.forEach((field) => {
      if (!hasOwn(preset, field)) {
        errors.push(`Preset ${index + 1} is missing required field: ${field}`);
      } else if (typeof preset[field] !== 'string') {
        errors.push(`Preset ${index + 1} field "${field}" must be a string.`);
      }
    });

    PRESET_WARNING_FIELDS.forEach((field) => {
      if (!hasOwn(preset, field)) {
        warnings.push(`Preset ${index + 1} (${ensureString(preset.title) || ensureString(preset.id) || 'untitled'}) is missing optional field: ${field}`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Detect likely duplicate presets against an existing library using title similarity
 * and exact prompt-text hashing.
 *
 * @param {Array<object>} incoming
 * @param {Array<object>} existing
 * @returns {Array<{ a: { id: string, title: string }, b: { id: string, title: string }, similarity: number, reason: string }>}
 */
export function detectDuplicates(incoming, existing) {
  const conflicts = [];
  const seen = new Set();

  asArray(incoming).forEach((candidate) => {
    const incomingTitle = ensureString(candidate?.title);
    const incomingPromptHash = stablePromptHash(candidate?.prompt ?? candidate?.enhanced ?? candidate?.original);

    asArray(existing).forEach((entry) => {
      const compareTitle = ensureString(entry?.title);
      const titleSimilarity = similarityRatio(incomingTitle, compareTitle);
      const comparePromptHash = stablePromptHash(entry?.prompt ?? entry?.enhanced ?? entry?.original);

      const reasons = [];
      if (titleSimilarity > TITLE_SIMILARITY_THRESHOLD) {
        reasons.push({ similarity: Number(titleSimilarity.toFixed(4)), reason: 'title-similar' });
      }
      if (incomingPromptHash && comparePromptHash && incomingPromptHash === comparePromptHash) {
        reasons.push({ similarity: 1, reason: 'prompt-exact-match' });
      }

      reasons.forEach((item) => {
        const key = [candidate?.id, entry?.id, item.reason].join('::');
        if (seen.has(key)) return;
        seen.add(key);
        conflicts.push({
          a: summarizeItem(candidate),
          b: summarizeItem(entry),
          similarity: item.similarity,
          reason: item.reason,
        });
      });
    });
  });

  return conflicts;
}

/**
 * Return presets whose prompt body is empty or whitespace-only.
 *
 * @param {Array<object>} presets
 * @returns {Array<object>}
 */
export function detectEmptyPrompts(presets) {
  return asArray(presets).filter((preset) => !normalizePromptText(preset?.prompt));
}

/**
 * Merge a preset pack into the current library and persist it through the provided adapter.
 *
 * @param {{ presets?: Array<object>, id?: string, title?: string }} pack
 * @param {{ save: (library: Array<object>) => unknown, load?: () => unknown, get?: () => unknown, read?: () => unknown, library?: Array<object> }} storageAdapter
 * @returns {Promise<{ imported: Array<object>, skipped: Array<object>, conflicts: Array<object> }>}
 */
export async function importPresetPack(pack, storageAdapter) {
  if (!storageAdapter || typeof storageAdapter.save !== 'function') {
    throw new Error('storageAdapter.save is required.');
  }

  const validation = validatePresetPack(pack);
  if (!validation.valid) {
    return {
      imported: [],
      skipped: validation.errors.map((message) => ({ reason: 'invalid-pack', message })),
      conflicts: [],
    };
  }

  const existingLibrary = normalizeLibrary(await readExistingLibrary(storageAdapter));
  const conflicts = detectDuplicates(pack.presets, existingLibrary);
  const exactMatchIds = new Set(
    conflicts
      .filter((item) => item.reason === 'prompt-exact-match')
      .map((item) => item.a.id)
  );
  const emptyIds = new Set(detectEmptyPrompts(pack.presets).map((preset) => ensureString(preset.id)));
  const usedIds = new Set(existingLibrary.map((entry) => entry.id));
  const mergedLibrary = [...existingLibrary];
  const imported = [];
  const skipped = [];

  asArray(pack.presets).forEach((preset) => {
    const presetId = ensureString(preset.id);
    if (emptyIds.has(presetId)) {
      skipped.push({ id: presetId, title: ensureString(preset.title), reason: 'empty-prompt' });
      return;
    }
    if (exactMatchIds.has(presetId)) {
      skipped.push({ id: presetId, title: ensureString(preset.title), reason: 'prompt-exact-match' });
      return;
    }

    const resolvedId = makeImportedId(presetId, usedIds);
    if (resolvedId !== presetId) {
      conflicts.push({
        a: summarizeItem(preset),
        b: { id: presetId, title: ensureString(preset.title) },
        similarity: 1,
        reason: 'id-collision',
      });
    }

    const entry = createPromptEntry({
      id: resolvedId,
      title: ensureString(preset.title).trim(),
      original: ensureString(preset.prompt),
      enhanced: ensureString(preset.prompt),
      notes: ensureString(preset.summary),
      tags: Array.isArray(preset.tags) ? preset.tags : [],
      collection: ensureString(preset.category),
      inputs: normalizePresetInputs(preset.inputs),
      metadata: {
        owner: ensureString(pack.title),
        purpose: ensureString(pack.id),
        status: ensureString(preset.status),
        compatibility: [],
        riskLevel: '',
      },
      schema_version: ensureString(pack.version),
      version: ensureString(pack.version),
    });

    mergedLibrary.push(entry);
    imported.push({ id: entry.id, title: entry.title });
  });

  const normalizedMergedLibrary = normalizeLibrary(mergedLibrary);
  await storageAdapter.save(normalizedMergedLibrary);

  return {
    imported,
    skipped,
    conflicts,
  };
}
