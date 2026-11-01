import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  KNOWN_OVERRIDES, RESERVED_COMBOS, SHORTCUT_GROUPS, SHORTCUT_MAP,
  ariaKeyShortcuts, comboOf, formatShortcut, matchShortcutIn,
} from '../lib/shortcutMap.js';
import { SHORTCUTS, matchShortcut } from '../lib/navigationRegistry.js';
import { PAD_SHORTCUTS, matchPadShortcut } from '../lib/padShortcuts.js';
import ShortcutsModal from '../modals/ShortcutsModal.jsx';

const theme = { modalBg: 'bg', modal: 'modal', text: 't', textSub: 's', textBody: 'b', pill: 'pill' };

function key(k, { meta = false, ctrl = false, alt = false, shift = false, code = '', tagName = 'DIV', editable = false } = {}) {
  return { key: k, code, metaKey: meta, ctrlKey: ctrl, altKey: alt, shiftKey: shift, target: { tagName, isContentEditable: editable } };
}

describe('shortcut map (single config)', () => {
  it('has unique ids and no duplicate combination inside a scope', () => {
    expect(new Set(SHORTCUT_MAP.map((s) => s.id)).size).toBe(SHORTCUT_MAP.length);
    for (const scope of ['global', 'scratch', 'editor', 'browser']) {
      const combos = SHORTCUT_MAP.filter((s) => s.scope === scope).map(comboOf);
      expect(new Set(combos).size, scope).toBe(combos.length);
    }
  });

  it('global and Scratch shortcuts never share a combination (both listen on window)', () => {
    const global = new Set(SHORTCUT_MAP.filter((s) => s.scope === 'global').map(comboOf));
    for (const s of SHORTCUT_MAP.filter((x) => x.scope === 'scratch')) expect(global.has(comboOf(s)), s.id).toBe(false);
  });

  it('claims no browser/OS-reserved combination, and every browser collision is a documented legacy override', () => {
    const reserved = new Set(RESERVED_COMBOS);
    for (const s of SHORTCUT_MAP.filter((x) => x.scope !== 'browser')) {
      expect(reserved.has(comboOf(s)), `${s.id} uses reserved ${comboOf(s)}`).toBe(false);
    }
    const used = new Set(SHORTCUT_MAP.map(comboOf));
    for (const combo of Object.keys(KNOWN_OVERRIDES)) expect(used.has(combo), combo).toBe(true);
  });

  it('every entry belongs to a known group with a label', () => {
    for (const s of SHORTCUT_MAP) {
      expect(SHORTCUT_GROUPS).toContain(s.group);
      expect(s.label).toBeTruthy();
    }
  });

  it('the registry and pad lists are derived from the map', () => {
    expect(SHORTCUTS.map((s) => s.id)).toEqual(SHORTCUT_MAP.filter((s) => s.scope === 'global').map((s) => s.id));
    expect(PAD_SHORTCUTS.map((s) => s.id)).toEqual(['export', 'insertDate', 'copyAll', 'clear']);
  });
});

describe('matching', () => {
  it('Option/Alt+digit navigates on a Mac, where event.key is a symbol', () => {
    expect(matchShortcut(key('¡', { alt: true, code: 'Digit1' }))?.id).toBe('navWrite');
    expect(matchShortcut(key('™', { alt: true, code: 'Digit2' }))?.id).toBe('navLibrary');
    expect(matchShortcut(key('2', { alt: true, code: 'Digit2' }))?.id).toBe('navLibrary');
    expect(matchShortcut(key('2', { code: 'Digit2' }))).toBe(null);
    expect(matchShortcut(key('2', { ctrl: true, alt: true, code: 'Digit2' }))).toBe(null);
  });

  it('"?" opens help but not while typing, including contenteditable and selects', () => {
    expect(matchShortcut(key('?', { shift: true }))?.id).toBe('shortcuts');
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(matchShortcut(key('?', { tagName }))).toBe(null);
    expect(matchShortcut(key('?', { editable: true }))).toBe(null);
  });

  it('global keys stay case-exact, so Cmd+Shift+S is not Save', () => {
    expect(matchShortcut(key('s', { meta: true }))?.id).toBe('save');
    expect(matchShortcut(key('S', { meta: true, shift: true }))).toBe(null);
  });

  it('Scratch pad shortcuts need the exact modifiers', () => {
    expect(matchPadShortcut(key('D', { meta: true, shift: true }))?.id).toBe('insertDate');
    expect(matchPadShortcut(key('d', { ctrl: true }))).toBe(null);
    expect(matchPadShortcut(key('e', { ctrl: true }))?.id).toBe('export');
    expect(matchPadShortcut(key('e', { ctrl: true, shift: true }))).toBe(null);
  });

  it('editor shortcuts include the Cmd/Ctrl+K link', () => {
    expect(matchShortcutIn('editor', key('k', { meta: true }))?.id).toBe('link');
    expect(matchShortcutIn('editor', key('B', { ctrl: true }))?.id).toBe('bold');
    expect(matchShortcutIn('editor', key('Tab'))?.id).toBe('indent');
  });

  it('formats key caps per platform', () => {
    const insertDate = SHORTCUT_MAP.find((s) => s.id === 'insertDate');
    expect(formatShortcut(insertDate, { mac: true })).toEqual(['⌘', '⇧', 'D']);
    expect(formatShortcut(insertDate, { mac: false })).toEqual(['Ctrl', 'Shift', 'D']);
    expect(ariaKeyShortcuts(insertDate, { mac: false })).toBe('Control+Shift+D');
  });
});

describe('"?" help overlay', () => {
  it('lists every shortcut in the map, grouped, as an accessible dialog', () => {
    render(<ShortcutsModal m={theme} primaryModKey="Cmd" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/Esc to close/);
    for (const s of SHORTCUT_MAP) {
      expect(dialog.querySelector(`[data-shortcut-id="${s.id}"]`), s.id).not.toBeNull();
    }
    expect(within(dialog).getByRole('heading', { name: 'Navigation' })).toBeInTheDocument();
    expect(dialog.querySelector('[data-shortcut-id="navWrite"]').textContent).toContain('⌥');
  });

  it('closes with Esc and with the close button', () => {
    const onClose = vi.fn();
    render(<ShortcutsModal m={theme} primaryModKey="Ctrl" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
