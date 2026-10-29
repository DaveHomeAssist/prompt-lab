// Versioned from the shipped stores, before any UI normalizer or retention cap.
export const V1_LOCAL_CONTENT_KEYS = Object.freeze([
  'pl2-library', 'pl2-library-trash', 'pl2-collections', 'pl2-collection-folders',
  'pl2-packs', 'pl2-loaded-packs', 'pl2-library-journal-revision',
  'pl2-pads', 'pl2-pads-schema-version', 'pl2-pad', 'pl2-pad_meta', 'pl-pad', 'pl-pad_meta',
  'pl2-experiment-history', 'pl2-experiment-fallback', 'pl2-eval-run-fallback',
  'pl2-test-case-fallback', 'pl2-run-fallback', 'pl2-draft-reset-recovery-v1',
  // These are editor drafts, not authentication sessions or provider settings.
  'pl2-session-pl2-session', 'pl2-session-pl2-dual-draft',
]);
export const V2_LOCAL_CONTENT_KEYS = Object.freeze([...V1_LOCAL_CONTENT_KEYS, 'pl2-scratch-journal-revision']);
export const LOCAL_CONTENT_KEYS = Object.freeze([...V2_LOCAL_CONTENT_KEYS, 'pl2-recent-artwork']);
export const SOURCE_INVENTORY_VERSION = 3;
export const DELETION_PREFIXES = Object.freeze([
  'pl2-library-deleted:', 'pl2-library-deleted-batch:', 'pl2-library-clear:',
]);
export const EXTENSION_DRAFT_KEYS = Object.freeze(['pl2-session', 'pl2-dual-draft']);

export function isLocalContentKey(key) {
  return typeof key === 'string' && (LOCAL_CONTENT_KEYS.includes(key) || DELETION_PREFIXES.some(prefix => key.startsWith(prefix)));
}
