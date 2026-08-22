import { useCallback, useRef } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function CommandPaletteModal({ m, cmdQuery, setCmdQuery, filteredCmds, onClose }) {
  const inputRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({ onClose: closeDialog, initialFocusRef: inputRef });

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-start justify-center z-[90] pt-20 p-4`} onClick={closeDialog}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl w-full max-w-md overflow-hidden shadow-2xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        aria-describedby="command-palette-description"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <h2 id="command-palette-title" className="sr-only">Command palette</h2>
        <p id="command-palette-description" className="sr-only">
          Search available Prompt Lab commands. Press Escape to close.
        </p>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${m.border}`}>
          <Ic n="Search" size={13} className={m.textSub} />
          <input ref={inputRef} className={`flex-1 bg-transparent text-sm ${m.text} focus:outline-none placeholder-gray-500`}
            aria-label="Search commands"
            placeholder="Search commands…" value={cmdQuery} onChange={e => setCmdQuery(e.target.value)} />
          <span aria-hidden="true" className={`text-xs ${m.textSub} font-mono`}>ESC</span>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {filteredCmds.length} command{filteredCmds.length === 1 ? '' : 's'} available.
        </p>
        <div className="max-h-72 overflow-y-auto" aria-label="Command results">
          {filteredCmds.map((a, i) => (
            <button key={i} onClick={a.action}
              type="button"
              className={`w-full min-h-11 flex items-center justify-between px-4 py-2.5 text-sm ${m.textBody} hover:bg-orange-600 hover:text-white transition-colors text-left`}>
              <span>{a.label}</span>
              {a.hint && <kbd className={`text-xs font-mono px-1.5 py-0.5 ${m.pill} rounded`}>{a.hint}</kbd>}
            </button>
          ))}
          {filteredCmds.length === 0 && <div className={`ui-empty-state text-xs ${m.textMuted}`}>No commands found</div>}
        </div>
      </div>
    </div>
  );
}
