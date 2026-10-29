export const DRAFT_RECOVERY_STORAGE_KEY = 'pl2-draft-reset-recovery-v1';

// Only this content key is selected. Preserve its exact string, including
// malformed JSON, and let denied reads invalidate the preservation capture.
export function readSessionRecovery() {
  return { storage: 'sessionStorage', entries: {
    [DRAFT_RECOVERY_STORAGE_KEY]: window.sessionStorage.getItem(DRAFT_RECOVERY_STORAGE_KEY),
  } };
}

export const registerSessionRecoveryCapture = buffers => buffers.register('draft-recovery-store', readSessionRecovery);

export function hasSessionRecoveryCapture(client) {
  if (!Array.isArray(client?.buffers)) return false;
  const records = client.buffers.filter(row => row?.id === 'draft-recovery-store');
  const value = records?.[0]?.value, entries = value?.entries;
  return records?.length === 1 && value?.storage === 'sessionStorage'
    && entries && Object.getPrototypeOf(entries) === Object.prototype
    && Object.keys(entries).length === 1 && Object.hasOwn(entries, DRAFT_RECOVERY_STORAGE_KEY)
    && (entries[DRAFT_RECOVERY_STORAGE_KEY] === null || typeof entries[DRAFT_RECOVERY_STORAGE_KEY] === 'string');
}
