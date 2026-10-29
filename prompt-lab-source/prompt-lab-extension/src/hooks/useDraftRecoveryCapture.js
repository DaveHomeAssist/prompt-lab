import { useLibraryEditBuffer } from './useLibraryEditBuffer.js';
export { DRAFT_RECOVERY_STORAGE_KEY } from '../lib/draftRecoveryCapture.js';

export function useDraftRecoveryCapture(recovery) {
  // A failed storage write can leave a newer in-memory recovery copy. A stored
  // value can also contain fields the current UI cannot read. Retain both.
  useLibraryEditBuffer('draft-recovery', recovery);
}
