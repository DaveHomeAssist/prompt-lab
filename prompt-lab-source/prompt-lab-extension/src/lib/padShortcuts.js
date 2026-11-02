import { matchShortcutIn, shortcutsInScope } from './shortcutMap.js';

// Scratch pad shortcuts; declared in ./shortcutMap.js (scope 'scratch').
export const PAD_SHORTCUTS = Object.freeze(shortcutsInScope('scratch').map(({ id, key, mod, shift, alt }) => Object.freeze({ id, key, mod, shift, alt })));

export function matchPadShortcut(event) {
  const match = matchShortcutIn('scratch', event);
  return match ? PAD_SHORTCUTS.find((shortcut) => shortcut.id === match.id) : null;
}
