// Open/closed preference for the Create "Prompt shortcuts" section
// (docs/ENHANCE_WORKSPACE_REDESIGN_BRIEF.md, slice 2A, C6). It lives apart from
// useUiState so the Library workspace work can change that hook freely.
export const PROMPT_SHORTCUTS_KEY = 'pl2-prompt-shortcuts';
// Phones and windows up to 800px tall (most laptops, short landscape) start closed.
export const PROMPT_SHORTCUTS_COMPACT_QUERY = '(max-width: 767px), (max-height: 800px)';

// Windows this short show open shortcuts as one scrolling row so Create keeps its height.
export const PROMPT_SHORTCUTS_SHORT_QUERY = '(max-height: 800px)';

export function matchesMedia(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

function isCompactViewport() {
  return matchesMedia(PROMPT_SHORTCUTS_COMPACT_QUERY);
}

// A remembered choice wins; otherwise compact screens start closed and larger ones open.
export function readPromptShortcutsOpen() {
  try {
    const stored = globalThis.localStorage?.getItem(PROMPT_SHORTCUTS_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    // Storage can be unavailable (private mode, blocked site data); use the viewport default.
  }
  return !isCompactViewport();
}

export function writePromptShortcutsOpen(open) {
  try {
    globalThis.localStorage?.setItem(PROMPT_SHORTCUTS_KEY, open ? 'open' : 'closed');
  } catch {
    // The in-memory state still applies for this session.
  }
}
