import { getLibraryEntryCanonicalBody, normalizePromptText } from './libraryMatching.js';
import { ensureString } from './utils.js';

function similarityRatio(left, right) {
  const a = normalizePromptText(left).toLowerCase(), b = normalizePromptText(right).toLowerCase();
  const length = Math.max(a.length, b.length);
  if (!length) return 1;
  const rows = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const previous = rows[j];
      rows[j] = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? diagonal + 1 : Math.max(rows[j], rows[j - 1]);
      diagonal = previous;
    }
  }
  return rows[b.length] / length;
}

/** Shared pack matching. Confirm complete bodies, never only a short hash. */
export function detectDuplicates(incoming, existing) {
  const conflicts = [], seen = new Set();
  const summarize = item => ({ id: ensureString(item?.id), title: ensureString(item?.title).trim() || 'Untitled' });
  for (const candidate of Array.isArray(incoming) ? incoming : []) {
    const body = getLibraryEntryCanonicalBody(candidate);
    for (const entry of Array.isArray(existing) ? existing : []) {
      const similarity = similarityRatio(candidate?.title, entry?.title), reasons = [];
      if (similarity > 0.65) reasons.push({ similarity: Number(similarity.toFixed(4)), reason: 'title-similar' });
      if (body && body === getLibraryEntryCanonicalBody(entry)) reasons.push({ similarity: 1, reason: 'prompt-exact-match' });
      for (const reason of reasons) {
        const key = JSON.stringify([candidate?.id, entry?.id, reason.reason]);
        if (seen.has(key)) continue;
        seen.add(key); conflicts.push({ a: summarize(candidate), b: summarize(entry), ...reason });
      }
    }
  }
  return conflicts;
}
