import presetPackSchema from '../../../docs/preset-pack-schema.json';
import { createPromptEntry, normalizeLibrary } from './promptSchema.js';
import { getLibraryEntrySignature } from './libraryMatching.js';
import { ensureString } from './utils.js';
import { upsertPack } from './packStore.js';

const PACK_REQUIRED_FIELDS = ['version', 'type', 'id', 'title', 'presets'];
const PRESET_REQUIRED_FIELDS = ['id', 'title', 'prompt'];
const PRESET_WARNING_FIELDS = ['summary', 'tags', 'category'];
const TITLE_SIMILARITY_THRESHOLD = 0.65;
const SOURCE_LABELS = Object.freeze({
  'preset-pack': 'Preset pack',
  'library-export': 'Library export',
  'starter-library-bundle': 'Starter library bundle',
  'starter-library': 'Starter library',
  'prompt-array': 'Prompt array',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function stringValue(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizePromptText(value) {
  return ensureString(value).replace(/\s+/g, ' ').trim();
}

function slugify(value, fallback = 'prompt-import') {
  const slug = stringValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
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

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item).trim()).filter(Boolean)
    : [];
}

function firstString(...values) {
  for (const value of values) {
    const text = stringValue(value).trim();
    if (text) return text;
  }
  return '';
}

function extractPromptBody(item) {
  return firstString(item?.prompt, item?.enhanced, item?.original, item?.content, item?.text);
}

function extractSummary(item, fallback = '') {
  return firstString(item?.summary, item?.notes, item?.description, item?.metadata?.purpose, fallback);
}

function extractCategory(item, fallback = '') {
  return firstString(item?.collection, item?.category, fallback);
}

function extractStatus(item) {
  return firstString(item?.status, item?.metadata?.status);
}

function extractPlatforms(item) {
  const fromPlatforms = normalizeStringList(item?.platforms);
  if (fromPlatforms.length) return fromPlatforms;
  return normalizeStringList(item?.metadata?.compatibility);
}

function extractMetadata(item, extras = {}) {
  const metadata = isObject(item?.metadata) ? item.metadata : {};
  return {
    ...metadata,
    ...extras,
  };
}

function makePresetId(item, index, prefix) {
  const sourceId = stringValue(item?.id).trim();
  if (sourceId) return sourceId;
  const titleSlug = slugify(item?.title || item?.name, '');
  return titleSlug ? `${prefix}-${titleSlug}` : `${prefix}-preset-${index + 1}`;
}

function coercePromptToPreset(item, index, options = {}) {
  if (!isObject(item)) return null;
  const prefix = options.prefix || 'import';
  const title = firstString(item.title, item.name, `Imported Prompt ${index + 1}`);
  const prompt = extractPromptBody(item);
  return {
    id: makePresetId(item, index, prefix),
    title,
    prompt,
    original: firstString(item.original, prompt),
    enhanced: firstString(item.enhanced, prompt),
    summary: extractSummary(item, options.summary),
    tags: normalizeStringList(item.tags),
    category: options.forceCollection ? stringValue(options.collection) : extractCategory(item, options.collection),
    status: extractStatus(item),
    platforms: extractPlatforms(item),
    inputs: Array.isArray(item.inputs) ? item.inputs : [],
    variants: Array.isArray(item.variants) ? item.variants : [],
    versions: Array.isArray(item.versions) ? item.versions : [],
    testCases: Array.isArray(item.testCases) ? item.testCases : [],
    goldenResponse: isObject(item.goldenResponse) ? item.goldenResponse : null,
    goldenThreshold: item.goldenThreshold,
    useCount: Number.isFinite(item.useCount) ? item.useCount : 0,
    lastAccessedAt: item.lastAccessedAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.updated_at,
    metadata: extractMetadata(item, options.metadata),
  };
}

function makePack({ id, title, version, description, presets }, sourceType, warnings = []) {
  return {
    sourceType,
    sourceLabel: SOURCE_LABELS[sourceType] || 'Import source',
    warnings,
    errors: presets.length
      ? []
      : [`${SOURCE_LABELS[sourceType] || 'Import source'} did not contain any importable prompts.`],
    pack: {
      version: stringValue(version).trim() || '1.0.0',
      type: presetPackSchema.type,
      id: slugify(id || title, 'prompt-import'),
      title: stringValue(title).trim() || 'Prompt Import',
      description: stringValue(description),
      presets,
    },
  };
}

function coerceLibraryExport(json) {
  const prefix = slugify(json.id || json.title || 'library-export', 'library-export');
  const title = firstString(json.title, json.name, 'Prompt Library Export');
  const presets = asArray(json.library)
    .map((entry, index) => coercePromptToPreset(entry, index, {
      prefix,
      collection: stringValue(entry?.collection),
      metadata: {
        source: 'library-export',
        exportedAt: stringValue(json.exportedAt),
      },
    }))
    .filter(Boolean);
  return makePack({
    id: firstString(json.id, 'prompt-library-export'),
    title,
    version: firstString(json.version, json.schemaVersion),
    description: firstString(json.description, `Imported from a Prompt Lab library export with ${presets.length} prompt${presets.length === 1 ? '' : 's'}.`),
    presets,
  }, 'library-export');
}

function coerceStarterLibrary(library, sourceType = 'starter-library') {
  const packId = firstString(library.id, library.name, 'starter-library');
  const packName = firstString(library.name, library.title, 'Starter Library');
  const prompts = asArray(library.prompts);
  const presets = prompts
    .map((prompt, index) => coercePromptToPreset(prompt, index, {
      prefix: slugify(packId, 'starter-library'),
      collection: packName,
      forceCollection: true,
      summary: `Starter prompt from ${packName}.`,
      metadata: {
        source: 'starter-library',
        packId,
        packName,
        seedPromptId: stringValue(prompt?.id),
        category: stringValue(prompt?.category) || null,
      },
    }))
    .filter(Boolean);
  return makePack({
    id: packId,
    title: packName,
    version: firstString(library.version, library.format_version, '1.0.0'),
    description: stringValue(library.description),
    presets,
  }, sourceType);
}

function coerceStarterBundle(json) {
  const bundleTitle = firstString(json.title, json.name, json.meta?.source, 'Starter Library Bundle');
  const bundleId = firstString(json.id, slugify(bundleTitle, 'starter-library-bundle'));
  const presets = asArray(json.libraries).flatMap((library) => {
    const prepared = coerceStarterLibrary(library, 'starter-library-bundle');
    return asArray(prepared.pack?.presets);
  });
  return makePack({
    id: bundleId,
    title: bundleTitle,
    version: firstString(json.version, json.meta?.format_version, '1.0.0'),
    description: stringValue(json.description),
    presets,
  }, 'starter-library-bundle');
}

function coercePromptArray(json) {
  const presets = asArray(json)
    .map((entry, index) => coercePromptToPreset(entry, index, { prefix: 'prompt-array' }))
    .filter(Boolean);
  return makePack({
    id: 'prompt-array-import',
    title: 'Prompt Array Import',
    version: '1.0.0',
    description: `Imported from a raw array with ${presets.length} prompt${presets.length === 1 ? '' : 's'}.`,
    presets,
  }, 'prompt-array');
}

/**
 * Normalize supported import sources into the documented preset-pack shape.
 *
 * @param {unknown} json
 * @returns {{ pack: object | null, sourceType: string, sourceLabel: string, errors: string[], warnings: string[] }}
 */
export function normalizePresetPackSource(json) {
  if (Array.isArray(json)) {
    return coercePromptArray(json);
  }

  if (!isObject(json)) {
    return {
      pack: null,
      sourceType: 'unsupported',
      sourceLabel: 'Unsupported JSON',
      errors: [`${describeSchemaTitle()} expects a top-level object or an array of prompts.`],
      warnings: [],
    };
  }

  if (Array.isArray(json.library)) {
    return coerceLibraryExport(json);
  }

  if (Array.isArray(json.libraries)) {
    return coerceStarterBundle(json);
  }

  if (Array.isArray(json.prompts)) {
    return coerceStarterLibrary(json);
  }

  return {
    pack: json,
    sourceType: 'preset-pack',
    sourceLabel: SOURCE_LABELS['preset-pack'],
    errors: [],
    warnings: [],
  };
}

/**
 * Prepare an import source for preview/import with schema validation applied.
 *
 * @param {unknown} json
 * @returns {{ pack: object | null, sourceType: string, sourceLabel: string, validation: { valid: boolean, errors: string[], warnings: string[] } }}
 */
export function preparePresetPackImport(json) {
  const source = normalizePresetPackSource(json);
  const validation = source.pack
    ? validatePresetPack(source.pack)
    : { valid: false, errors: [], warnings: [] };
  const errors = [...source.errors, ...validation.errors];
  const warnings = [...source.warnings, ...validation.warnings];
  return {
    pack: source.pack,
    sourceType: source.sourceType,
    sourceLabel: source.sourceLabel,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
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
      original: ensureString(preset.original) || promptText,
      enhanced: ensureString(preset.enhanced) || promptText,
      variants: Array.isArray(preset.variants) ? preset.variants : [],
      notes: ensureString(preset.summary),
      tags: Array.isArray(preset.tags) ? preset.tags.filter(Boolean) : [],
      collection: ensureString(preset.category),
      versions: Array.isArray(preset.versions) ? preset.versions : [],
      testCases: Array.isArray(preset.testCases) ? preset.testCases : [],
      goldenResponse: preset.goldenResponse || null,
      goldenThreshold: preset.goldenThreshold,
      useCount: Number.isFinite(preset.useCount) ? preset.useCount : 0,
      lastAccessedAt: preset.lastAccessedAt || null,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
      metadata: {
        ...(isObject(preset.metadata) ? preset.metadata : {}),
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
    const incomingPromptHash = getLibraryEntrySignature(candidate);

    asArray(existing).forEach((entry) => {
      const compareTitle = ensureString(entry?.title);
      const titleSimilarity = similarityRatio(incomingTitle, compareTitle);
      const comparePromptHash = getLibraryEntrySignature(entry);

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

  const prepared = preparePresetPackImport(pack);
  const validation = prepared.validation;
  if (!validation.valid) {
    return {
      imported: [],
      skipped: validation.errors.map((message) => ({ reason: 'invalid-pack', message })),
      conflicts: [],
    };
  }

  const normalizedPack = prepared.pack;
  const existingLibrary = normalizeLibrary(await readExistingLibrary(storageAdapter));
  const conflicts = detectDuplicates(normalizedPack.presets, existingLibrary);
  const exactMatchIds = new Set(
    conflicts
      .filter((item) => item.reason === 'prompt-exact-match')
      .map((item) => item.a.id)
  );
  const emptyIds = new Set(detectEmptyPrompts(normalizedPack.presets).map((preset) => ensureString(preset.id)));
  const usedIds = new Set(existingLibrary.map((entry) => entry.id));
  const mergedLibrary = [...existingLibrary];
  const imported = [];
  const skipped = [];

  asArray(normalizedPack.presets).forEach((preset) => {
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
      original: ensureString(preset.original) || ensureString(preset.prompt),
      enhanced: ensureString(preset.enhanced) || ensureString(preset.prompt),
      variants: Array.isArray(preset.variants) ? preset.variants : [],
      notes: ensureString(preset.summary),
      tags: Array.isArray(preset.tags) ? preset.tags : [],
      collection: ensureString(preset.category),
      inputs: normalizePresetInputs(preset.inputs),
      versions: Array.isArray(preset.versions) ? preset.versions : [],
      testCases: Array.isArray(preset.testCases) ? preset.testCases : [],
      goldenResponse: preset.goldenResponse || null,
      goldenThreshold: preset.goldenThreshold,
      useCount: Number.isFinite(preset.useCount) ? preset.useCount : 0,
      lastAccessedAt: preset.lastAccessedAt || null,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
      metadata: {
        ...(isObject(preset.metadata) ? preset.metadata : {}),
        owner: ensureString(normalizedPack.title),
        purpose: ensureString(preset.summary) || ensureString(normalizedPack.id),
        status: ensureString(preset.status),
        compatibility: Array.isArray(preset.platforms) ? preset.platforms : [],
        riskLevel: '',
        // Starter-library sources stamp their own packId upstream; keep it.
        packId: ensureString(isObject(preset.metadata) ? preset.metadata.packId : '') || ensureString(normalizedPack.id),
      },
      schema_version: ensureString(normalizedPack.version),
      version: ensureString(normalizedPack.version),
    });

    mergedLibrary.push(entry);
    imported.push({ id: entry.id, title: entry.title });
  });

  const normalizedMergedLibrary = normalizeLibrary(mergedLibrary);
  await storageAdapter.save(normalizedMergedLibrary);

  if (imported.length > 0 && ensureString(normalizedPack.id).trim()) {
    upsertPack({
      id: normalizedPack.id,
      title: normalizedPack.title,
      version: normalizedPack.version,
      source: 'imported',
    });
  }

  return {
    imported,
    skipped,
    conflicts,
    sourceType: prepared.sourceType,
    sourceLabel: prepared.sourceLabel,
  };
}
