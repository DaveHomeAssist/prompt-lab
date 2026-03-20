/**
 * Navigation Registry — single source of truth for all views, subviews,
 * keyboard shortcuts, and command palette actions.
 *
 * Replaces the parallel tab arrays, switch statements, and inline shortcut
 * handlers that were previously scattered across App.jsx and useUiState.js.
 */

// ── Primary views ────────────────────────────────────────────────────

export const PRIMARY_VIEWS = Object.freeze([
  { id: 'create', label: 'Create' },
  { id: 'runs', label: 'Runs' },
  { id: 'notebook', label: 'Notebook' },
]);

// ── Subviews per primary view ────────────────────────────────────────

export const SUBVIEWS = Object.freeze({
  create: [
    { id: 'editor', label: 'Create' },
    { id: 'library', label: 'Library' },
    { id: 'composer', label: 'Build' },
    { id: 'split', label: 'Dual Pane', hideCompact: true },
  ],
  runs: [
    { id: 'history', label: 'History' },
    { id: 'compare', label: 'Compare' },
  ],
  notebook: [],
});

// ── Tab ↔ state mapping ─────────────────────────────────────────────

/**
 * Derive the canonical tab name from raw view state.
 * Mirrors the original computed `tab` in useUiState.
 */
export function deriveTab(primaryView, workspaceView, runsView) {
  if (primaryView === 'notebook') return 'pad';
  if (primaryView === 'runs') return runsView === 'compare' ? 'abtest' : 'history';
  if (workspaceView === 'composer') return 'composer';
  return 'editor';
}

/**
 * Given a target tab name, return the state updates needed.
 * Returns { primaryView, workspaceView?, runsView? }.
 */
export function resolveTabState(nextTab) {
  switch (nextTab) {
    case 'editor':
      return { primaryView: 'create', workspaceView: 'editor' };
    case 'composer':
      return { primaryView: 'create', workspaceView: 'composer' };
    case 'abtest':
      return { primaryView: 'runs', runsView: 'compare' };
    case 'history':
      return { primaryView: 'runs', runsView: 'history' };
    case 'pad':
      return { primaryView: 'notebook' };
    default:
      return { primaryView: 'create', workspaceView: 'editor' };
  }
}

// ── Keyboard shortcuts ──────────────────────────────────────────────

/**
 * Shortcut descriptors.
 * `mod` = true means Cmd (Mac) / Ctrl (other).
 * `key` is the KeyboardEvent.key value.
 * `id` is used to look up the handler at runtime.
 * `excludeInputs` prevents firing when focus is in an input/textarea.
 */
export const SHORTCUTS = Object.freeze([
  { id: 'enhance', key: 'Enter', mod: true, label: 'Enhance', hint: '⌘↵' },
  { id: 'save', key: 's', mod: true, label: 'Save', hint: '⌘S' },
  { id: 'cmdPalette', key: 'k', mod: true, label: 'Command Palette', hint: '⌘K' },
  { id: 'shortcuts', key: '?', mod: false, excludeInputs: true, label: 'Shortcuts', hint: '?' },
  { id: 'escape', key: 'Escape', mod: false, label: 'Close Panel', hint: 'Esc' },
]);

/**
 * Match a KeyboardEvent against the shortcut registry.
 * Returns the matching shortcut descriptor, or null.
 */
export function matchShortcut(event) {
  const mod = event.metaKey || event.ctrlKey;
  for (const shortcut of SHORTCUTS) {
    if (shortcut.key !== event.key) continue;
    if (shortcut.mod && !mod) continue;
    if (!shortcut.mod && shortcut.key !== 'Escape' && mod) continue;
    if (shortcut.excludeInputs && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) continue;
    return shortcut;
  }
  return null;
}

// ── Command palette actions ─────────────────────────────────────────

/**
 * Build the command palette action list.
 * Accepts a handlers object with named callbacks.
 * Returns an array of { label, hint, action } entries.
 */
export function buildCommandActions(handlers) {
  const {
    enhance, save, clear,
    goEditor, goLibrary, goBuild, goRuns, goCompare, goNotebook,
    toggleTheme, exportLib, openSettings, openOptions, showShortcuts,
  } = handlers;

  return [
    { label: 'Enhance Prompt', hint: '⌘↵', action: enhance },
    { label: 'Save Prompt', hint: '⌘S', action: save },
    { label: 'Clear Editor', hint: '', action: clear },
    { label: 'Go to Create', hint: '', action: goEditor },
    { label: 'Go to Library', hint: '', action: goLibrary },
    { label: 'Go to Experiments', hint: '', action: goRuns },
    { label: 'Go to Experiment History', hint: '', action: goCompare },
    { label: 'Open Build Utility', hint: '', action: goBuild },
    { label: 'Open Notebook', hint: '', action: goNotebook },
    { label: 'Toggle Light / Dark', hint: '', action: toggleTheme },
    { label: 'Export Library', hint: '', action: exportLib },
    { label: 'Open Settings', hint: '', action: openSettings },
    { label: 'Extension Options (API Key)', hint: '', action: openOptions },
    { label: 'Show Keyboard Shortcuts', hint: '?', action: showShortcuts },
  ].filter((entry) => typeof entry.action === 'function');
}

/**
 * Filter command actions by a query string.
 */
export function filterCommands(actions, query) {
  if (!query) return actions;
  const lower = query.toLowerCase();
  return actions.filter((a) => a.label.toLowerCase().includes(lower));
}
