export const HIGHLIGHT_DRAFT_KEY = 'pl2-highlight-draft';

/** Load a context-menu selection into Write. Returns false when there is no text. */
export function applyHighlightDraft(draft, actions) {
  if (!draft || typeof draft.text !== 'string' || !draft.text.trim()) return false;
  actions.openWrite?.();
  actions.clearEditor?.();
  actions.setRaw(draft.text);
  actions.notify?.(typeof draft.notice === 'string' && draft.notice.trim() ? draft.notice : 'Selection loaded in Write');
  return true;
}
