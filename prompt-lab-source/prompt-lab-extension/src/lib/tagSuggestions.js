import { CANONICAL_TAG_LABELS, normalizeTagList } from './tagSchema.js';

// Local tag ideas for the Save panel. Deterministic word rules plus tags the
// person already uses; nothing is added until a suggestion is picked.
const CANONICAL_RULES = {
  Code: /\b(?:code|coding|refactor|debug|bug|function|api|repo|script|typescript|javascript|python|sql|regex|unit tests?|pull request)\b/g,
  Writing: /\b(?:write|rewrite|blog|essay|copy|draft|email|article|newsletter|proofread|edit(?:ing)?)\b/g,
  Research: /\b(?:research|investigate|sources?|citations?|literature|find out|look up)\b/g,
  Analysis: /\b(?:analy[sz]e|analysis|compare|evaluate|assess|audit|metrics|trends?|summari[sz]e)\b/g,
  Creative: /\b(?:creative|story|poem|brainstorm|image|illustration|design|lyrics|slogan)\b/g,
  System: /\b(?:system prompt|instructions|guardrails?|policy|rules|constraints)\b/g,
  'Role-play': /\b(?:you are|act as|role[- ]?play|persona|pretend)\b/g,
};
export const MAX_TAG_LENGTH = 32;

const count = (text, pattern) => { pattern.lastIndex = 0; return (text.match(pattern) || []).length; };
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalize one typed tag; returns '' when it is empty or too long. */
export function cleanTypedTag(value) {
  const [tag] = normalizeTagList([String(value || '').trim().replace(/^#+/, '')]);
  return tag && tag.length <= MAX_TAG_LENGTH ? tag : '';
}

/**
 * Up to `limit` tags for `text`, skipping tags already selected.
 * Existing library tags that appear as whole words rank first, then the
 * built-in tags by how often their cue words occur.
 */
export function suggestTags(text, { libraryTags = [], selected = [], limit = 4 } = {}) {
  const lower = String(text || '').toLowerCase().slice(0, 6000);
  if (!lower.trim()) return [];
  const taken = new Set(normalizeTagList(selected).map((tag) => tag.toLowerCase()));
  const canonical = new Set(CANONICAL_TAG_LABELS.map((tag) => tag.toLowerCase()));
  const scored = [];
  normalizeTagList(libraryTags).forEach((tag, order) => {
    const key = tag.toLowerCase();
    if (canonical.has(key) || key.length < 3) return;
    const words = key.replace(/[-_]+/g, ' ');
    const hits = count(lower, new RegExp(`\\b${escape(words)}\\b`, 'g'));
    if (hits) scored.push({ tag, score: 1000 + hits, order }); // the person's own tags lead
  });
  Object.entries(CANONICAL_RULES).forEach(([tag, pattern], order) => {
    const hits = count(lower, pattern);
    if (hits) scored.push({ tag, score: hits, order: 100 + order });
  });
  return scored
    .filter(({ tag }) => !taken.has(tag.toLowerCase()))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ tag }) => tag)
    .filter((tag, index, list) => list.findIndex((other) => other.toLowerCase() === tag.toLowerCase()) === index)
    .slice(0, Math.max(0, limit));
}

/** Built-in tags, then the library's own tags, then any selected leftovers. */
export function tagChoices({ builtIn = [], libraryTags = [], selected = [] } = {}) {
  return normalizeTagList([...builtIn, ...libraryTags, ...selected]);
}
