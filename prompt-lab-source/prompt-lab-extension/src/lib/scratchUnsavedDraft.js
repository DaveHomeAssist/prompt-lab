// Scratch text that could not be saved when the side panel closed, for example
// because storage is full. It lives outside the panel so that every way of
// closing it (its own buttons, the context bar, a shortcut, leaving Write)
// keeps the text, and reopening the panel shows it again. It lasts for this
// page session only.
let kept = null;

// `pad` is the note as last stored; `text` is the unsaved editor text.
// Returns true when this changes what is kept.
export function keepUnsavedScratchDraft(pad, text) {
  const changed = kept?.pad.id !== pad.id || kept?.text !== text;
  kept = { pad, text };
  return changed;
}

export function readUnsavedScratchDraft() {
  return kept;
}

// Clears the kept text for one note, or everything when no ID is given.
export function clearUnsavedScratchDraft(padId) {
  if (!padId || kept?.pad.id === padId) kept = null;
}
