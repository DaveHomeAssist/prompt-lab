import { ensureString, normalizeVariant, randomId, safeDate } from './utils.js';
import { normalizeTagList } from './tagSchema.js';
import { normalizeResultMeta } from './enhancementResult.js';
import { DEFAULT_GOLDEN_THRESHOLD } from '../constants.js';

const MAX_PROMPT_VERSIONS = 25;
export const PROMPT_STATUS = Object.freeze(['draft', 'active', 'deprecated']);

const DEFAULT_PROMPT_METADATA = Object.freeze({
  owner: '',
  purpose: '',
  status: '',
  compatibility: [],
  riskLevel: '',
});
const PROMPT_INPUT_TYPES = new Set(['text', 'textarea', 'select']);

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
}

function normalizePromptMetadata(value) {
  const metadata = value && typeof value === 'object' ? value : {};
  return {
    ...metadata,
    owner: ensureString(metadata.owner),
    purpose: ensureString(metadata.purpose),
    status: ensureString(metadata.status),
    compatibility: normalizeStringList(metadata.compatibility),
    riskLevel: ensureString(metadata.riskLevel),
  };
}

function normalizeCompleteness(value, entry) {
  const explicit = value && typeof value === 'object' ? value : {};
  const missing = [];
  if (!ensureString(entry?.title).trim()) missing.push('title');
  if (!ensureString(entry?.enhanced || entry?.original).trim()) missing.push('content');
  if (!normalizeTagList(entry?.tags).length) missing.push('tags');
  if (!ensureString(entry?.metadata?.purpose).trim()) missing.push('purpose');
  if (!ensureString(entry?.metadata?.status).trim()) missing.push('status');
  return {
    complete: missing.length === 0,
    missing,
    updatedAt: safeDate(explicit.updatedAt || entry?.updatedAt || entry?.createdAt || new Date().toISOString()),
  };
}

function normalizeGoldenThreshold(value) {
  if (!Number.isFinite(value)) return DEFAULT_GOLDEN_THRESHOLD;
  return Math.max(0, Math.min(1, value));
}

function normalizeOptionalSchemaField(value) {
  if (Number.isFinite(value)) return value;
  const text = ensureString(value).trim();
  return text || null;
}

function normalizePromptInputOptions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((option) => {
      if (typeof option === 'string') {
        const text = option.trim();
        return text ? { label: text, value: text } : null;
      }
      if (!option || typeof option !== 'object') return null;
      const rawValue = ensureString(option.value).trim() || ensureString(option.label).trim();
      if (!rawValue) return null;
      return {
        label: ensureString(option.label).trim() || rawValue,
        value: rawValue,
      };
    })
    .filter(Boolean);
}

function normalizePromptInput(input) {
  if (!input || typeof input !== 'object') return null;
  const key = ensureString(input.key).trim();
  if (!key) return null;
  const type = ensureString(input.type).trim().toLowerCase();
  const normalizedType = PROMPT_INPUT_TYPES.has(type) ? type : 'text';
  return {
    key,
    label: ensureString(input.label).trim() || key,
    type: normalizedType,
    required: Boolean(input.required),
    placeholder: ensureString(input.placeholder),
    options: normalizedType === 'select' ? normalizePromptInputOptions(input.options) : [],
  };
}

function normalizePromptInputs(value) {
  return Array.isArray(value)
    ? value.map(normalizePromptInput).filter(Boolean)
    : [];
}

function normalizeGoldenResponse(value) {
  if (!value || typeof value !== 'object') return null;
  const text = ensureString(value.text);
  if (!text.trim()) return null;
  return {
    text: text.slice(0, 20000),
    pinnedAt: safeDate(value.pinnedAt || new Date().toISOString()),
    pinnedFromRunId: ensureString(value.pinnedFromRunId),
    provider: ensureString(value.provider),
    model: ensureString(value.model),
  };
}

function normalizeContentShape(value) {
  const content = {
    original: ensureString(value?.original),
    enhanced: ensureString(value?.enhanced) || ensureString(value?.prompt) || ensureString(value?.original),
    variants: Array.isArray(value?.variants)
      ? value.variants.map(normalizeVariant).filter(item => item.content.trim())
      : [],
    notes: ensureString(value?.notes) || ensureString(value?.description),
  };
  return {
    ...content,
    resultMeta: normalizeResultMeta(value?.resultMeta || value?.enhancementResult, content),
  };
}

function variantsEqual(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item.label === right[index]?.label && item.content === right[index]?.content);
}

export function arePromptSnapshotsEqual(left, right) {
  const a = normalizeContentShape(left);
  const b = normalizeContentShape(right);
  return a.original === b.original
    && a.enhanced === b.enhanced
    && a.notes === b.notes
    && JSON.stringify(a.resultMeta) === JSON.stringify(b.resultMeta)
    && variantsEqual(a.variants, b.variants);
}

export function suggestTitleFromText(value) {
  const rawText = ensureString(value).trim();
  if (!rawText) return 'Untitled Prompt';

  // Use the first non-empty line before collapsing whitespace, so markdown
  // prompts keep their line structure for title extraction.
  const firstLine = rawText.split(/\n/).map((line) => line.trim()).find(Boolean) || '';

  // A markdown heading on the first line is an author-supplied title.
  const headingMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
  let candidate = headingMatch ? headingMatch[1] : firstLine;

  // Drop wrapping markup (fences, blockquotes, emphasis) and collapse spaces.
  candidate = candidate
    .replace(/^```[\w-]*/, '')
    .replace(/^[>\-*\s]+/, '')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate) candidate = rawText.replace(/\s+/g, ' ').trim();

  // Strip conversational filler so titles start with the actual task.
  candidate = candidate.replace(/^(?:please|kindly)[,\s]+/i, '');

  // Reduce role preambles to the role itself: "You are a helpful pirate…" → "Helpful pirate…".
  const roleMatch = candidate.match(/^(?:you are|you're|act as|acting as|imagine you(?:'re| are))\s+(?:an?\s+|the\s+)?(.+)$/i);
  if (roleMatch) candidate = roleMatch[1];

  // Prefer the first sentence when it is reasonably short.
  const sentenceMatch = candidate.match(/^(.+?[.!?])(?:\s|$)/);
  let phrase = sentenceMatch && sentenceMatch[1].length <= 80
    ? sentenceMatch[1]
    : candidate;

  // Titles don't need terminal periods; keep expressive ? and !.
  phrase = phrase.replace(/\.+$/, '').trim();
  if (!phrase) return 'Untitled Prompt';
  phrase = phrase[0].toUpperCase() + phrase.slice(1);

  // Trim to a reasonable length, breaking at word boundary
  const MAX = 60;
  if (phrase.length <= MAX) return phrase;
  const truncated = phrase.slice(0, MAX);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > MAX * 0.4 ? truncated.slice(0, lastSpace) : truncated) + '…';
}

export function normalizeVersion(version, fallbackTs = new Date().toISOString()) {
  if (!version || typeof version !== 'object') return null;
  const content = normalizeContentShape(version);
  if (!content.enhanced.trim() && !content.original.trim()) return null;
  return {
    id: ensureString(version.id) || randomId(),
    original: content.original,
    enhanced: content.enhanced,
    variants: content.variants,
    notes: content.notes,
    resultMeta: content.resultMeta,
    savedAt: safeDate(version.savedAt || fallbackTs),
    changeNote: ensureString(version.changeNote),
    source: ensureString(version.source) || 'manual_save',
  };
}

export function normalizeTestCase(testCase, fallbackTs = new Date().toISOString()) {
  if (!testCase || typeof testCase !== 'object') return null;
  const input = ensureString(testCase.input);
  if (!input.trim()) return null;
  const createdAt = safeDate(testCase.createdAt || fallbackTs);
  const updatedAt = testCase.updatedAt ? safeDate(testCase.updatedAt) : createdAt;
  return {
    id: ensureString(testCase.id) || randomId(),
    name: ensureString(testCase.name).trim() || suggestTitleFromText(input),
    input,
    expectedTraits: normalizeStringList(testCase.expectedTraits),
    exclusions: normalizeStringList(testCase.exclusions),
    notes: ensureString(testCase.notes),
    createdAt,
    updatedAt,
  };
}

export function getPromptSnapshot(entry, options = {}) {
  return normalizeVersion({
    id: options.id || entry?.currentVersionId || randomId(),
    original: entry?.original,
    enhanced: entry?.enhanced,
    variants: entry?.variants,
    notes: entry?.notes,
    resultMeta: entry?.resultMeta,
    savedAt: options.savedAt || entry?.updatedAt || entry?.createdAt || new Date().toISOString(),
    changeNote: options.changeNote || '',
    source: options.source || 'manual_save',
  });
}

export function appendVersionSnapshot(entry, options = {}) {
  const normalized = normalizeEntry(entry);
  if (!normalized) return null;
  const snapshot = getPromptSnapshot(normalized, options);
  if (!snapshot) return normalized;
  const versions = [...normalized.versions];
  const last = versions[versions.length - 1];
  if (last && arePromptSnapshotsEqual(last, snapshot)) {
    return normalized;
  }
  versions.push(snapshot);
  return {
    ...normalized,
    versions: versions.slice(-MAX_PROMPT_VERSIONS),
  };
}

export function createPromptEntry(value, options = {}) {
  const now = safeDate(options.now || new Date().toISOString());
  return normalizeEntry({
    ...value,
    id: ensureString(value?.id) || randomId(),
    createdAt: value?.createdAt || now,
    updatedAt: value?.updatedAt || value?.updated_at || now,
    currentVersionId: ensureString(value?.currentVersionId) || randomId(),
    versions: Array.isArray(value?.versions) ? value.versions : [],
    testCases: Array.isArray(value?.testCases) ? value.testCases : [],
    goldenResponse: value?.goldenResponse || null,
    goldenThreshold: value?.goldenThreshold,
    metadata: value?.metadata || DEFAULT_PROMPT_METADATA,
  }, now);
}

export function updatePromptEntry(entry, changes = {}, options = {}) {
  const current = normalizeEntry(entry);
  if (!current) return null;
  const now = safeDate(options.now || new Date().toISOString());
  const nextContent = normalizeContentShape({
    original: Object.prototype.hasOwnProperty.call(changes, 'original') ? changes.original : current.original,
    enhanced: Object.prototype.hasOwnProperty.call(changes, 'enhanced') ? changes.enhanced : current.enhanced,
    variants: Object.prototype.hasOwnProperty.call(changes, 'variants') ? changes.variants : current.variants,
    notes: Object.prototype.hasOwnProperty.call(changes, 'notes') ? changes.notes : current.notes,
    resultMeta: Object.prototype.hasOwnProperty.call(changes, 'resultMeta') ? changes.resultMeta : current.resultMeta,
  });
  const contentChanged = !arePromptSnapshotsEqual(current, nextContent);
  const withHistory = contentChanged
    ? appendVersionSnapshot(current, {
      savedAt: current.updatedAt || current.createdAt,
      source: options.source || 'manual_save',
      changeNote: options.changeNote || '',
    })
    : current;
  return normalizeEntry({
    ...withHistory,
    ...changes,
    id: current.id,
    title: Object.prototype.hasOwnProperty.call(changes, 'title')
      ? ensureString(changes.title).trim() || current.title
      : current.title,
    original: nextContent.original,
    enhanced: nextContent.enhanced,
    variants: nextContent.variants,
    notes: nextContent.notes,
    resultMeta: nextContent.resultMeta,
    tags: Object.prototype.hasOwnProperty.call(changes, 'tags')
      ? normalizeStringList(changes.tags)
      : current.tags,
    collection: Object.prototype.hasOwnProperty.call(changes, 'collection')
      ? ensureString(changes.collection)
      : current.collection,
    createdAt: current.createdAt,
    updatedAt: now,
    currentVersionId: contentChanged ? randomId() : current.currentVersionId,
    versions: withHistory.versions,
    testCases: Object.prototype.hasOwnProperty.call(changes, 'testCases')
      ? Array.isArray(changes.testCases) ? changes.testCases : []
      : current.testCases,
    goldenResponse: Object.prototype.hasOwnProperty.call(changes, 'goldenResponse')
      ? changes.goldenResponse
      : current.goldenResponse,
    goldenThreshold: Object.prototype.hasOwnProperty.call(changes, 'goldenThreshold')
      ? normalizeGoldenThreshold(changes.goldenThreshold)
      : current.goldenThreshold,
    inputs: Object.prototype.hasOwnProperty.call(changes, 'inputs')
      ? normalizePromptInputs(changes.inputs)
      : current.inputs,
    metadata: Object.prototype.hasOwnProperty.call(changes, 'metadata')
      ? changes.metadata
      : current.metadata,
    favorite: Object.prototype.hasOwnProperty.call(changes, 'favorite')
      ? changes.favorite === true
      : current.favorite,
    kind: Object.prototype.hasOwnProperty.call(changes, 'kind')
      ? changes.kind
      : current.kind,
    sourceNoteId: Object.prototype.hasOwnProperty.call(changes, 'sourceNoteId')
      ? changes.sourceNoteId
      : current.sourceNoteId,
    deletedAt: Object.prototype.hasOwnProperty.call(changes, 'deletedAt')
      ? changes.deletedAt
      : current.deletedAt,
    tombstoneVersion: Object.prototype.hasOwnProperty.call(changes, 'tombstoneVersion')
      ? changes.tombstoneVersion
      : current.tombstoneVersion,
  }, current.createdAt);
}

export function restorePromptVersion(entry, version, options = {}) {
  const current = normalizeEntry(entry);
  const target = normalizeVersion(version, current?.updatedAt || current?.createdAt || new Date().toISOString());
  if (!current || !target) return current;
  if (arePromptSnapshotsEqual(current, target)) return current;
  return updatePromptEntry(current, {
    original: target.original,
    enhanced: target.enhanced,
    variants: target.variants,
    notes: target.notes,
    resultMeta: target.resultMeta,
  }, {
    now: options.now,
    source: 'restore',
    changeNote: options.changeNote || target.changeNote || 'Restored a prior version',
  });
}

export function normalizeEntry(entry, fallbackTs = new Date().toISOString()) {
  if (!entry || typeof entry !== 'object') return null;
  const content = normalizeContentShape(entry);
  if (!content.enhanced.trim()) return null;
  const createdAt = safeDate(entry.createdAt || fallbackTs);
  // Preserve snake_case aliases for imported/shared records so external schema fields round-trip cleanly.
  const updatedAt = entry.updatedAt
    ? safeDate(entry.updatedAt)
    : entry.updated_at
      ? safeDate(entry.updated_at)
      : undefined;
  const version = normalizeOptionalSchemaField(entry.version);
  const schemaVersion = normalizeOptionalSchemaField(entry.schema_version ?? entry.schemaVersion);
  const versions = Array.isArray(entry.versions)
    ? entry.versions
      .map(version => normalizeVersion(version, createdAt))
      .filter(Boolean)
    : [];
  const testCases = Array.isArray(entry.testCases)
    ? entry.testCases
      .map(testCase => normalizeTestCase(testCase, createdAt))
      .filter(Boolean)
    : [];
  const normalizedMetadata = normalizePromptMetadata(entry.metadata);
  const normalizedTags = normalizeTagList(entry.tags);
  const normalized = {
    id: ensureString(entry.id) || randomId(),
    title: ensureString(entry.title).trim() || suggestTitleFromText(content.enhanced),
    original: content.original,
    enhanced: content.enhanced,
    variants: content.variants,
    notes: content.notes,
    resultMeta: content.resultMeta,
    tags: normalizedTags,
    collection: ensureString(entry.collection) || ensureString(entry.category),
    createdAt,
    updatedAt,
    updated_at: updatedAt || createdAt,
    useCount: Number.isFinite(entry.useCount) ? Math.max(0, entry.useCount) : 0,
    lastAccessedAt: entry.lastAccessedAt ? safeDate(entry.lastAccessedAt) : null,
    favorite: entry.favorite === true,
    kind: ensureString(entry.kind || entry.type).toLowerCase() === 'template' || normalizedTags.includes('template')
      ? 'template'
      : 'prompt',
    sourceNoteId: ensureString(entry.sourceNoteId || entry.metadata?.sourceNoteId),
    deletedAt: entry.deletedAt ? safeDate(entry.deletedAt) : null,
    tombstoneVersion: Number.isFinite(entry.tombstoneVersion) ? Math.max(0, Math.round(entry.tombstoneVersion)) : 0,
    currentVersionId: ensureString(entry.currentVersionId) || randomId(),
    version,
    schema_version: schemaVersion,
    versions,
    testCases,
    goldenResponse: normalizeGoldenResponse(entry.goldenResponse),
    goldenThreshold: normalizeGoldenThreshold(entry.goldenThreshold),
    inputs: normalizePromptInputs(entry.inputs),
    metadata: normalizedMetadata,
  };
  return {
    ...normalized,
    completeness: normalizeCompleteness(entry.completeness, normalized),
  };
}

export { normalizeEntry as normalizePromptRecord };

export function normalizeLibrary(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list
    .map((entry, index) => normalizeEntry(entry, new Date(Date.now() - index).toISOString()))
    .filter(Boolean)
    .map(entry => {
      const id = seen.has(entry.id) ? randomId() : entry.id;
      seen.add(id);
      return { ...entry, id };
    });
}
