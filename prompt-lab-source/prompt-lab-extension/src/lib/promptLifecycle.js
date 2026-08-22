export const SAVE_LABELS = Object.freeze({
  newPrompt: 'Save as new prompt',
  newVersion: 'Save new version',
  saveCopy: 'Save as new prompt',
});

export function getPrimarySaveLabel(editingId) {
  return editingId ? SAVE_LABELS.newVersion : SAVE_LABELS.newPrompt;
}

export function createSaveReceipt(saved, { action, sourceNoteId = '' } = {}) {
  if (!saved?.id) return null;
  return {
    entryId: saved.id,
    title: saved.title || 'Untitled prompt',
    versionId: saved.versionId || null,
    versionNumber: Number.isFinite(saved.versionNumber) ? saved.versionNumber : 1,
    action: action || (saved.savedAsNew ? 'new' : 'version'),
    sourceNoteId,
    savedAt: new Date().toISOString(),
  };
}
