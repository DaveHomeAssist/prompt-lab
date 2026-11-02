import { useCallback, useRef } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';
import { KNOWN_OVERRIDES, SHORTCUT_GROUPS, SHORTCUT_MAP, ariaKeyShortcuts, comboOf, formatShortcut } from '../lib/shortcutMap.js';

// The "?" help overlay. Every row comes from lib/shortcutMap.js, so the list
// cannot drift from what the key handlers actually do.
export default function ShortcutsModal({ m, primaryModKey, saveLabel = 'Save as new prompt', onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({ onClose: closeDialog });
  const mac = primaryModKey === '⌘' || primaryModKey === 'Cmd';
  const labelFor = (shortcut) => (shortcut.id === 'save' ? saveLabel : shortcut.label);

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`} onClick={closeDialog}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-shortcuts"
        aria-describedby="modal-shortcuts-description"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        data-testid="shortcuts-overlay"
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id="modal-shortcuts" className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
          <button type="button" onClick={closeDialog} aria-label="Close keyboard shortcuts" aria-keyshortcuts="Escape" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:bg-white/10 transition-colors`}><Ic n="X" size={14} /></button>
        </div>
        <p id="modal-shortcuts-description" className={`text-xs ${m.textSub} mb-4`}>
          {mac ? '⌘ is Command, ⌥ is Option, ⇧ is Shift.' : 'Ctrl, Alt and Shift as labelled.'} Press Esc to close.
        </p>
        <div className="flex flex-col gap-4">
          {SHORTCUT_GROUPS.map((group) => {
            const rows = SHORTCUT_MAP.filter((shortcut) => shortcut.group === group);
            if (!rows.length) return null;
            const headingId = `shortcuts-group-${group.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <section key={group} aria-labelledby={headingId}>
                <h3 id={headingId} className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>{group === 'Browser' ? 'Browser and app window' : group}</h3>
                <dl className="flex flex-col gap-2.5">
                  {rows.map((shortcut) => {
                    const caps = formatShortcut(shortcut, { mac });
                    const note = KNOWN_OVERRIDES[comboOf(shortcut)];
                    return (
                      <div key={shortcut.id} className="flex items-center justify-between gap-3" data-shortcut-id={shortcut.id}>
                        <dt className={`text-sm ${m.textBody}`}>
                          {labelFor(shortcut)}
                          {note ? <span className="sr-only">{` (replaces the browser shortcut: ${note})`}</span> : null}
                        </dt>
                        <dd className="flex shrink-0 gap-1">
                          <span className="sr-only">{ariaKeyShortcuts(shortcut, { mac }).replace(/\+/g, ' plus ')}</span>
                          {caps.map((cap, index) => (
                            <kbd key={`${cap}-${index}`} aria-hidden="true" className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{cap}</kbd>
                          ))}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
