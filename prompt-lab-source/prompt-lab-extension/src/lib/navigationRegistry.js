/**
 * Navigation Registry — single source of truth for all views, subviews,
 * keyboard shortcuts, and command palette actions.
 *
 * Replaces the parallel tab arrays, switch statements, and inline shortcut
 * handlers that were previously scattered across App.jsx and useUiState.js.
 */

import { formatShortcut, matchShortcutIn, shortcutsInScope } from './shortcutMap.js';

// ── Primary views ────────────────────────────────────────────────────

export const PRIMARY_VIEWS = Object.freeze([
  { id: 'create', label: 'Create' },
  { id: 'runs', label: 'Evaluate' },
  { id: 'notebook', label: 'Scratch' },
]);

// ── Subviews per primary view ────────────────────────────────────────

export const SUBVIEWS = Object.freeze({
  create: [
    { id: 'editor', label: 'Write' },
    { id: 'library', label: 'Library' },
    { id: 'composer', label: 'Compose' },
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
 * Derive the active top-level section shown in the header.
 * Notebook keeps the Create section selected because it has its own
 * dedicated toggle outside the main section tabs.
 */
export function deriveActiveSection(primaryView, workspaceView) {
  if (primaryView === 'runs') return 'evaluate';
  if (workspaceView === 'library') return 'library';
  return 'create';
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
    case 'split':
      return { primaryView: 'create', workspaceView: 'split' };
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

/**
 * Given a high-level section id, return the state updates needed.
 * `experiments` remains as a supported alias for legacy callers.
 */
export function resolveSectionState(nextSection) {
  switch (nextSection) {
    case 'library':
      return { primaryView: 'create', workspaceView: 'library' };
    case 'evaluate':
    case 'experiments':
      return { primaryView: 'runs' };
    case 'create':
    default:
      return { primaryView: 'create', workspaceView: 'editor' };
  }
}

const ROUTE_TO_STATE = Object.freeze({
  '/': { primaryView: 'create', workspaceView: 'editor' },
  '/library': { primaryView: 'create', workspaceView: 'library' },
  '/composer': { primaryView: 'create', workspaceView: 'composer' },
  '/split': { primaryView: 'create', workspaceView: 'split' },
  '/split/library': { primaryView: 'create', workspaceView: 'split', splitPane: 'library' },
  '/split/write': { primaryView: 'create', workspaceView: 'split', splitPane: 'editor' },
  '/evaluate': { primaryView: 'runs', runsView: 'history' },
  '/compare': { primaryView: 'runs', runsView: 'compare' },
  '/scratch': { primaryView: 'notebook' },
  // Backward-compatible route for saved links from the Notebook-era UI.
  '/pad': { primaryView: 'notebook' },
  // The diff viewer is the Diff tab of Write's result (free on every plan).
  // /diff opens Write on that tab, then settles on the canonical '/' route
  // without a "Page not found" notice.
  '/diff': { primaryView: 'create', workspaceView: 'editor', resultTab: 'diff', canonical: '/' },
  // Dialog routes: open a modal over the current workspace instead of
  // swapping views, then settle back on that workspace's canonical route.
  '/settings': { modal: 'settings' },
  '/account': { modal: 'account' },
});

/**
 * Resolve a route pathname to the corresponding navigation state.
 */
export function resolveRouteState(pathname) {
  return ROUTE_TO_STATE[pathname] || null;
}

/**
 * Resolve the canonical route for the current navigation state.
 */
export function stateToRoute(primaryView, workspaceView, runsView, options = {}) {
  if (primaryView === 'notebook') return '/scratch';
  if (primaryView === 'runs') return runsView === 'compare' ? '/compare' : '/evaluate';
  if (workspaceView === 'library') return '/library';
  if (workspaceView === 'composer') return '/composer';
  if (workspaceView === 'split') {
    if (options.compact && options.splitPane) return `/split/${options.splitPane === 'library' ? 'library' : 'write'}`;
    return '/split';
  }
  return '/';
}

// ── Keyboard shortcuts ──────────────────────────────────────────────

// Shortcut descriptors now live in ./shortcutMap.js (the single shortcut
// config shared by the web app, extension and desktop app). SHORTCUTS keeps
// its old shape for callers: global-scope entries with a display hint.
const HINT_OVERRIDES = { enhance: '⌘↵', save: '⌘S', cmdPalette: '⌘K', shortcuts: '?', escape: 'Esc', toggleScratchPanel: '⌘\\' };
export const SHORTCUTS = Object.freeze(shortcutsInScope('global').map((shortcut) => Object.freeze({
  ...shortcut,
  hint: HINT_OVERRIDES[shortcut.id] || formatShortcut(shortcut, { mac: false }).join(' '),
})));

/**
 * Match a KeyboardEvent against the global shortcuts.
 * Returns the matching shortcut descriptor, or null.
 */
export function matchShortcut(event) {
  const match = matchShortcutIn('global', event);
  return match ? SHORTCUTS.find((shortcut) => shortcut.id === match.id) : null;
}

// ── Command palette actions ─────────────────────────────────────────

/**
 * Build the command palette action list.
 * Accepts a handlers object with named callbacks.
 * Returns an array of { label, hint, action } entries.
 */
export function buildCommandActions(handlers) {
  const {
    enhance, save, saveLabel, clear, newPrompt,
    goEditor, goLibrary, goBuild, goSplit, goRuns, goCompare, goNotebook,
    toggleTheme, exportLib, openSettings, openOptions, showShortcuts,
    manageAccount, signOut,
  } = handlers;

  return [
    { label: 'Enhance Prompt', hint: '⌘↵', action: enhance },
    { label: saveLabel || 'Save as new prompt', hint: '⌘S', action: save },
    { label: 'New Prompt', hint: '', action: newPrompt },
    { label: 'Clear Editor', hint: '', action: clear },
    { label: 'Go to Create', hint: '', action: goEditor },
    { label: 'Go to Library', hint: '', action: goLibrary },
    { label: 'Go to Evaluate', hint: '', action: goRuns },
    { label: 'Open Compare View', hint: '', action: goCompare },
    { label: 'Open Compose Mode', hint: '', action: goBuild },
    { label: 'Open Dual Pane', hint: '', action: goSplit },
    { label: 'Open Scratch', hint: '', action: goNotebook },
    { label: 'Toggle Light / Dark', hint: '', action: toggleTheme },
    { label: 'Export Library', hint: '', action: exportLib },
    { label: 'Open Settings', hint: '', action: openSettings },
    { label: 'Extension Options (API Key)', hint: '', action: openOptions },
    { label: 'Show Keyboard Shortcuts', hint: '?', action: showShortcuts },
    { label: 'Manage Account', hint: '', action: manageAccount },
    { label: 'Sign Out', hint: '', action: signOut },
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
