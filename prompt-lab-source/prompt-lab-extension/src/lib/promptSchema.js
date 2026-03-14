import { ensureString, normalizeVariant, randomId, safeDate } from './utils.js';

const MAX_PROMPT_VERSIONS = 25;
export const PROMPT_STATUS = Object.freeze(['draft', 'active', 'deprecated']);

const DEFAULT_PROMPT_METADATA = Object.freeze({
  owner: '',
  purpose: '',
  status: '',
  compatibility: [],
  riskLevel: '',
});

function normalizeStringList(value) {
  return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
}

function normalizePromptMetadata(value) {
  const metadata = value && typeof value === 'object' ? value : {};
  return {
    owner: ensureString(metadata.owner),
    purpose: ensureString(metadata.purpose),
    status: ensureString(metadata.status),
    compatibility: normalizeStringList(metadata.compatibility),
    riskLevel: ensureString(metadata.riskLevel),
  };
}

function normalizeGoldenThreshold(value) {
  if (!Number.isFinite(value)) return 0.7;
  return Math.max(0, Math.min(1, value));
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
  return {
    original: ensureString(value?.original),
    enhanced: ensureString(value?.enhanced) || ensureString(value?.prompt) || ensureString(value?.original),
    variants: Array.isArray(value?.variants)
      ? value.variants.map(normalizeVariant).filter(item => item.content.trim())
      : [],
    notes: ensureString(value?.notes) || ensureString(value?.description),
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
    && variantsEqual(a.variants, b.variants);
}

export function suggestTitleFromText(value) {
  const text = ensureString(value).replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled Prompt';
  const short = text.slice(0, 72);
  return short.length < text.length ? `${short}…` : short;
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
    updatedAt: value?.updatedAt || now,
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
    metadata: Object.prototype.hasOwnProperty.call(changes, 'metadata')
      ? changes.metadata
      : current.metadata,
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
  const updatedAt = entry.updatedAt ? safeDate(entry.updatedAt) : undefined;
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
  return {
    id: ensureString(entry.id) || randomId(),
    title: ensureString(entry.title).trim() || suggestTitleFromText(content.enhanced),
    original: content.original,
    enhanced: content.enhanced,
    variants: content.variants,
    notes: content.notes,
    tags: normalizeStringList(entry.tags),
    collection: ensureString(entry.collection) || ensureString(entry.category),
    createdAt,
    updatedAt,
    useCount: Number.isFinite(entry.useCount) ? Math.max(0, entry.useCount) : 0,
    currentVersionId: ensureString(entry.currentVersionId) || randomId(),
    versions,
    testCases,
    goldenResponse: normalizeGoldenResponse(entry.goldenResponse),
    goldenThreshold: normalizeGoldenThreshold(entry.goldenThreshold),
    metadata: normalizePromptMetadata(entry.metadata),
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
