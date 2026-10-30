import { suggestTitleFromText } from './promptSchema.js';

// Local naming alternatives for the Save panel. Deterministic text rules only:
// no model calls, nothing is applied until the person picks a chip, and saved
// titles are never rewritten.
const UNTITLED = 'Untitled Prompt';
const FILLER = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'following', 'given', 'some', 'any', 'please', 'for', 'of', 'to', 'into', 'and', 'with', 'from', 'about', 'in', 'on', 'it']);
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with']);
const ROLE = /^\s*(?:[#>*\-\s]*)(?:you are|you're|act as|acting as|imagine you(?:'re| are))\s+(?:an?\s+|the\s+)?([^.!?\n]{2,60})/im;

const clean = (value) => value.replace(/…$/, '').replace(/[.:;,!?]+$/, '').replace(/\s+/g, ' ').trim();
const titleCase = (words) => words.map((word, index) => {
  if (/[A-Z].*[A-Z]|\d/.test(word)) return word; // keep acronyms, versions and mixed case
  const lower = word.toLowerCase();
  return index > 0 && SMALL.has(lower) ? lower : lower[0].toUpperCase() + lower.slice(1);
}).join(' ');

// "Summarize the following meeting notes into action items" -> "Summarize Meeting Notes Action Items"
export function compactTitle(title, maxWords = 5) {
  const words = clean(title).split(' ').filter(Boolean);
  if (words.length <= 3) return '';
  const kept = words.filter((word, index) => index === 0 || !FILLER.has(word.toLowerCase().replace(/[^a-z']/g, '')));
  const short = kept.slice(0, maxWords).map((word) => word.replace(/[,;:]+$/, ''));
  return short.length >= 2 ? titleCase(short) : '';
}

function roleOf(text) {
  const match = String(text || '').match(ROLE);
  if (!match) return '';
  const role = clean(match[1].split(/\s+(?:who|that|with|and)\s+/i)[0]);
  const words = role.split(' ');
  return words.length && words.length <= 4 ? titleCase(words) : '';
}

/**
 * Up to `limit` distinct title ideas for `text`, excluding `current`.
 * The first idea is the existing automatic suggestion.
 */
export function suggestTitleAlternatives(text, { current = '', limit = 3 } = {}) {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return [];
  const primary = suggestTitleFromText(source);
  if (!primary || primary === UNTITLED) return [];
  const compact = compactTitle(primary);
  const role = roleOf(source);
  const task = compact || clean(primary);
  const candidates = [primary, compact, role && task && !task.toLowerCase().startsWith(role.toLowerCase()) ? `${role}: ${task}` : ''];
  const seen = new Set([clean(current).toLowerCase(), UNTITLED.toLowerCase()]);
  const ideas = [];
  for (const idea of candidates) {
    const key = clean(idea || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key); ideas.push(idea.length > 70 ? `${idea.slice(0, 69).trimEnd()}…` : idea);
  }
  return ideas.slice(0, Math.max(0, limit));
}
