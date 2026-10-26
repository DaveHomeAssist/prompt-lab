// Smart-view rules shared by the Library and the Prompts view beside Write, so
// both list the same prompts in the same order for All, Recent and Favorites.
import { sortLibraryEntries } from './librarySort.js';

export function entryTimestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isIncomplete(entry) {
  return !entry?.title?.trim()
    || !(entry?.tags || []).length
    || !entry?.metadata?.purpose?.trim()
    || !entry?.metadata?.status?.trim();
}

export function isTemplate(entry) {
  return (entry?.inputs || []).length > 0
    || (entry?.tags || []).some((tag) => tag.toLowerCase() === 'template')
    || entry?.metadata?.type === 'template';
}

// Filters a smart view. Views without a filter (All, Recent, Frequently used)
// keep every entry.
export function filterSmartView(entries, view) {
  if (view === 'favorites') return entries.filter((entry) => entry.favorite);
  if (view === 'templates') return entries.filter(isTemplate);
  if (view === 'incomplete') return entries.filter(isIncomplete);
  return entries;
}

// Orders a smart view. Recent and Frequently used reorder the library; the
// other views follow the Library's chosen sort.
export function orderSmartView(entries, view, sortBy) {
  if (view === 'recent') {
    return [...entries].sort((left, right) => entryTimestamp(right.lastAccessedAt || right.updatedAt) - entryTimestamp(left.lastAccessedAt || left.updatedAt));
  }
  if (view === 'frequent') return [...entries].sort((left, right) => (right.useCount || 0) - (left.useCount || 0));
  return sortLibraryEntries(entries, sortBy);
}

export function smartViewEntries(entries, view, sortBy) {
  return orderSmartView(filterSmartView(Array.isArray(entries) ? entries : [], view), view, sortBy);
}
