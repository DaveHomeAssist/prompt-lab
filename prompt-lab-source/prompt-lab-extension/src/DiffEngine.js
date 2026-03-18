import DiffMatchPatch from 'diff-match-patch';

const EQUAL = 'EQUAL';
const INSERT = 'INSERT';
const DELETE = 'DELETE';

const TYPE_MAP = {
  [DiffMatchPatch.DIFF_EQUAL]: EQUAL,
  [DiffMatchPatch.DIFF_INSERT]: INSERT,
  [DiffMatchPatch.DIFF_DELETE]: DELETE,
};

/**
 * Computes a structured delta array between two strings.
 * Uses diff-match-patch for character-level diffing with
 * semantic cleanup for human-readable results.
 *
 * @param {string} stringA - The "before" text (Variant A).
 * @param {string} stringB - The "after" text (Variant B).
 * @returns {{ type: 'EQUAL'|'INSERT'|'DELETE', text: string }[]}
 */
export function computeDiff(stringA, stringB) {
  const a = typeof stringA === 'string' ? stringA : '';
  const b = typeof stringB === 'string' ? stringB : '';

  const dmp = new DiffMatchPatch();
  const rawDiffs = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(rawDiffs);

  return rawDiffs.map(([op, text]) => ({
    type: TYPE_MAP[op],
    text,
  }));
}

/**
 * Returns true when both strings are identical (no diff tokens).
 */
export function isIdentical(stringA, stringB) {
  const delta = computeDiff(stringA, stringB);
  return delta.every((d) => d.type === EQUAL);
}

/**
 * Converts a delta array to a Markdown string.
 * DELETE → ~~text~~, INSERT → **text**, EQUAL → plain text.
 */
export function deltaToMarkdown(delta) {
  return delta
    .map((d) => {
      if (d.type === DELETE) return `~~${d.text}~~`;
      if (d.type === INSERT) return `**${d.text}**`;
      return d.text;
    })
    .join('');
}

export { EQUAL, INSERT, DELETE };
