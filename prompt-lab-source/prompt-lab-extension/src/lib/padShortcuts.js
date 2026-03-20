export const PAD_SHORTCUTS = Object.freeze([
  { id: 'export', key: 'e', mod: true, shift: false, alt: false },
  { id: 'insertDate', key: 'd', mod: true, shift: true, alt: false },
  { id: 'copyAll', key: 'c', mod: true, shift: true, alt: false },
  { id: 'clear', key: 'x', mod: true, shift: true, alt: false },
]);

export function matchPadShortcut(event) {
  const mod = event.metaKey || event.ctrlKey;
  const key = String(event.key || '').toLowerCase();

  for (const shortcut of PAD_SHORTCUTS) {
    if (key !== shortcut.key) continue;
    if (shortcut.mod !== mod) continue;
    if (Boolean(event.shiftKey) !== shortcut.shift) continue;
    if (Boolean(event.altKey) !== shortcut.alt) continue;
    return shortcut;
  }

  return null;
}
