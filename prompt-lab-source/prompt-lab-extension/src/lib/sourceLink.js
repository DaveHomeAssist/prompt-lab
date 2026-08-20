import { ensureString } from './utils.js';

const PADS_KEY = 'pl2-pads';

export function linkScratchNoteToPrompt(noteId, promptId) {
  const sourceId = ensureString(noteId).trim();
  const targetId = ensureString(promptId).trim();
  if (!sourceId || !targetId) return false;
  try {
    const parsed = JSON.parse(localStorage.getItem(PADS_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.pads)) return false;
    let found = false;
    const now = Date.now();
    const pads = parsed.pads.map((pad) => {
      if (pad?.id !== sourceId) return pad;
      found = true;
      return {
        ...pad,
        linkedPromptId: targetId,
        updatedAt: now,
        timestamp: now,
      };
    });
    if (!found) return false;
    localStorage.setItem(PADS_KEY, JSON.stringify({
      ...parsed,
      pads,
      revision: (Number.isFinite(parsed.revision) ? parsed.revision : 0) + 1,
    }));
    return true;
  } catch {
    return false;
  }
}
