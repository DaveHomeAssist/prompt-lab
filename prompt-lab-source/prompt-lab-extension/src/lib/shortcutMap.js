// The one place Prompt Lab's keyboard shortcuts are declared (web app,
// Chrome extension and desktop app share this file through
// prompt-lab-desktop/src -> ../prompt-lab-extension/src).
//
// Each entry:
//   id         handler id looked up at runtime
//   group      heading in the "?" help overlay
//   key        KeyboardEvent.key (letters lower-case)
//   code       optional KeyboardEvent.code fallback. Alt/Option+digit on a
//              Mac produces '¡', '™', ... in event.key, so digits match on
//              code ('Digit1') as well.
//   mod        Cmd on Mac, Ctrl elsewhere
//   shift/alt  required modifiers (exact match where `exact` is true)
//   scope      'global' (window listener in App.jsx), 'scratch' (window
//              listener while Scratch is open), 'editor' (Scratch editor
//              textarea only), 'browser' (handled by the browser/OS, listed
//              for reference only)
//   excludeInputs  do not fire while typing in a field
//
// tests/shortcutMap.test.js checks there are no duplicate combinations in
// a scope and that nothing here collides with a browser- or OS-reserved
// combination that a page cannot override (see RESERVED_COMBOS).

export const SHORTCUT_GROUPS = Object.freeze(['Global', 'Navigation', 'Scratch', 'Scratch editor', 'Browser']);

export const SHORTCUT_MAP = Object.freeze([
  { id: 'enhance', group: 'Global', scope: 'global', key: 'Enter', mod: true, label: 'Enhance prompt' },
  { id: 'save', group: 'Global', scope: 'global', key: 's', mod: true, label: 'Save prompt' },
  { id: 'cmdPalette', group: 'Global', scope: 'global', key: 'k', mod: true, label: 'Command palette' },
  { id: 'toggleScratchPanel', group: 'Global', scope: 'global', key: '\\', mod: true, label: 'Toggle the panel beside Write' },
  { id: 'shortcuts', group: 'Global', scope: 'global', key: '?', excludeInputs: true, label: 'Show keyboard shortcuts' },
  { id: 'escape', group: 'Global', scope: 'global', key: 'Escape', label: 'Close dialog or panel' },
  { id: 'navWrite', group: 'Navigation', scope: 'global', key: '1', code: 'Digit1', alt: true, label: 'Open Write' },
  { id: 'navLibrary', group: 'Navigation', scope: 'global', key: '2', code: 'Digit2', alt: true, label: 'Open Library' },
  { id: 'navCompose', group: 'Navigation', scope: 'global', key: '3', code: 'Digit3', alt: true, label: 'Open Compose' },
  { id: 'navSplit', group: 'Navigation', scope: 'global', key: '4', code: 'Digit4', alt: true, label: 'Open Dual Pane' },
  { id: 'navEvaluate', group: 'Navigation', scope: 'global', key: '5', code: 'Digit5', alt: true, label: 'Open Evaluate' },
  { id: 'navScratch', group: 'Navigation', scope: 'global', key: '6', code: 'Digit6', alt: true, label: 'Open Scratch' },
  { id: 'export', group: 'Scratch', scope: 'scratch', key: 'e', mod: true, shift: false, alt: false, exact: true, label: 'Export / download note' },
  { id: 'insertDate', group: 'Scratch', scope: 'scratch', key: 'd', mod: true, shift: true, alt: false, exact: true, label: 'Insert date separator' },
  { id: 'copyAll', group: 'Scratch', scope: 'scratch', key: 'c', mod: true, shift: true, alt: false, exact: true, label: 'Copy all content' },
  { id: 'clear', group: 'Scratch', scope: 'scratch', key: 'x', mod: true, shift: true, alt: false, exact: true, label: 'Clear note' },
  { id: 'bold', group: 'Scratch editor', scope: 'editor', key: 'b', mod: true, label: 'Bold' },
  { id: 'italic', group: 'Scratch editor', scope: 'editor', key: 'i', mod: true, label: 'Italic' },
  { id: 'link', group: 'Scratch editor', scope: 'editor', key: 'k', mod: true, label: 'Insert link (instead of the command palette)' },
  { id: 'indent', group: 'Scratch editor', scope: 'editor', key: 'Tab', label: 'Indent two spaces' },
  { id: 'zoomIn', group: 'Browser', scope: 'browser', key: '+', mod: true, label: 'Zoom in' },
  { id: 'zoomOut', group: 'Browser', scope: 'browser', key: '-', mod: true, label: 'Zoom out' },
  { id: 'zoomReset', group: 'Browser', scope: 'browser', key: '0', mod: true, label: 'Reset zoom' },
]);

// Combinations Chrome, Vivaldi, macOS or Windows keep for themselves (a page
// cannot reliably preventDefault them) or that would surprise people.
// Written as "mod+shift+alt+key" with the same normalisation as comboOf().
export const RESERVED_COMBOS = Object.freeze([
  'mod+n', 'mod+shift+n', 'mod+t', 'mod+shift+t', 'mod+w', 'mod+shift+w', 'mod+q', 'mod+tab',
  'mod+l', 'mod+r', 'mod+shift+r', 'mod+f', 'mod+g', 'mod+p', 'mod+h', 'mod+m', 'mod+o', 'mod+j',
  'mod+shift+i', 'mod+shift+j', 'mod+alt+i', 'mod+alt+j', 'mod+u', 'mod+shift+delete',
  'mod+1', 'mod+2', 'mod+3', 'mod+4', 'mod+5', 'mod+6', 'mod+7', 'mod+8', 'mod+9',
  'mod+space', 'mod+shift+3', 'mod+shift+4', 'mod+shift+5', 'mod+,', 'alt+f4', 'alt+space',
  'mod+c', 'mod+v', 'mod+x', 'mod+z', 'mod+shift+z', 'mod+a', 'mod+y',
]);

// Pre-existing combinations that do collide with a browser default which a
// page *can* override inside Prompt Lab. Kept for muscle memory; listed in
// docs and in the overlay footnote. Anything new must not join this list.
export const KNOWN_OVERRIDES = Object.freeze({
  'mod+s': 'Browser "Save page as"; Prompt Lab saves the prompt instead.',
  'mod+k': 'Chrome/Vivaldi (Windows) search in the address bar while the page has focus.',
  'mod+e': 'Chrome (Windows) address-bar search; macOS "use selection for Find".',
  'mod+shift+c': 'Chrome/Vivaldi DevTools inspect element. A page can usually intercept it; DevTools wins if it is already open.',
  'mod+shift+d': 'Chrome/Vivaldi (Mac) bookmark all tabs.',
  'mod+b': 'Vivaldi/Firefox bookmarks panel; only while typing in the Scratch editor.',
  'mod+i': 'Firefox page info; only while typing in the Scratch editor.',
});

export function comboOf(shortcut) {
  const parts = [];
  if (shortcut.mod) parts.push('mod');
  if (shortcut.shift) parts.push('shift');
  if (shortcut.alt) parts.push('alt');
  parts.push(String(shortcut.key).toLowerCase());
  return parts.join('+');
}

export function shortcutsInScope(scope) {
  return SHORTCUT_MAP.filter((shortcut) => shortcut.scope === scope);
}

function isTypingTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(target.tagName || '').toUpperCase());
}

function keyMatches(shortcut, event) {
  const key = String(event.key || '');
  // Scratch shortcuts (exact) ignore case because Shift changes event.key;
  // global ones compare exactly, so Cmd+Shift+S is not Save.
  const caseless = shortcut.key.length === 1 && (shortcut.exact || shortcut.scope === 'editor');
  if (caseless ? key.toLowerCase() === shortcut.key : key === shortcut.key) return true;
  return Boolean(shortcut.code) && event.code === shortcut.code;
}

/** Match a KeyboardEvent against one scope of the map. Returns the entry or null. */
export function matchShortcutIn(scope, event) {
  if (!event) return null;
  const mod = Boolean(event.metaKey || event.ctrlKey);
  for (const shortcut of shortcutsInScope(scope)) {
    if (!keyMatches(shortcut, event)) continue;
    if (Boolean(shortcut.alt) !== Boolean(event.altKey)) continue;
    if (shortcut.mod && !mod) continue;
    if (!shortcut.mod && shortcut.key !== 'Escape' && mod) continue;
    if (shortcut.exact && Boolean(event.shiftKey) !== Boolean(shortcut.shift)) continue;
    if (shortcut.excludeInputs && isTypingTarget(event.target)) continue;
    return shortcut;
  }
  return null;
}

export function isMacPlatform(nav = typeof navigator !== 'undefined' ? navigator : null) {
  if (!nav) return false;
  return /Mac|iPhone|iPad/.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '');
}

const KEY_LABELS = { Enter: '↵', Escape: 'Esc', Tab: 'Tab', '\\': '\\', '+': '+', '-': '−' };

/** Key caps for display, e.g. ['⌘', '⇧', 'D'] on Mac or ['Ctrl', 'Shift', 'D']. */
export function formatShortcut(shortcut, { mac = isMacPlatform() } = {}) {
  const caps = [];
  if (shortcut.mod) caps.push(mac ? '⌘' : 'Ctrl');
  if (shortcut.shift) caps.push(mac ? '⇧' : 'Shift');
  if (shortcut.alt) caps.push(mac ? '⌥' : 'Alt');
  const key = KEY_LABELS[shortcut.key] || (shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  caps.push(key);
  return caps;
}

/** aria-keyshortcuts value, e.g. "Meta+K" / "Control+K". */
export function ariaKeyShortcuts(shortcut, { mac = isMacPlatform() } = {}) {
  const parts = [];
  if (shortcut.mod) parts.push(mac ? 'Meta' : 'Control');
  if (shortcut.shift) parts.push('Shift');
  if (shortcut.alt) parts.push('Alt');
  parts.push(shortcut.key === ' ' ? 'Space' : shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join('+');
}
