// Library sort orders, shared by the Library hook, the Library workspace and
// the Prompts view beside Write.

function parseLibraryTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getNewestSortTimestamp(entry) {
  const candidates = [
    entry?.metadata?.packLoadedAt,
    entry?.updatedAt,
    entry?.updated_at,
    entry?.createdAt,
  ]
    .map(parseLibraryTimestamp)
    .filter((value) => value !== null);
  return candidates.length ? Math.max(...candidates) : 0;
}

export function sortLibraryEntries(entries, sortBy) {
  return [...(Array.isArray(entries) ? entries : [])].sort((left, right) => {
    if (sortBy === 'manual') return 0;
    if (sortBy === 'oldest') return new Date(left.createdAt) - new Date(right.createdAt);
    if (sortBy === 'most-used') return right.useCount - left.useCount;
    if (sortBy === 'a-z') return (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' });
    if (sortBy === 'z-a') return (right.title || '').localeCompare(left.title || '', undefined, { sensitivity: 'base' });
    if (sortBy === 'group') {
      const leftCollection = left.collection || '';
      const rightCollection = right.collection || '';
      if (leftCollection && !rightCollection) return -1;
      if (!leftCollection && rightCollection) return 1;
      const cmp = leftCollection.localeCompare(rightCollection, undefined, { sensitivity: 'base' });
      return cmp !== 0 ? cmp : (left.title || '').localeCompare(right.title || '', undefined, { sensitivity: 'base' });
    }
    const newestDelta = getNewestSortTimestamp(right) - getNewestSortTimestamp(left);
    if (newestDelta !== 0) return newestDelta;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}
