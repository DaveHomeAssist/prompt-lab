import { useCallback, useRef } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function ShortcutsModal({ m, primaryModKey, saveLabel = 'Save as new prompt', onClose }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({ onClose: closeDialog });

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`} onClick={closeDialog}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-sm max-h-[90vh] overflow-y-auto`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-shortcuts"
        aria-describedby="modal-shortcuts-description"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 id="modal-shortcuts" className={`font-bold text-sm ${m.text}`}>Keyboard Shortcuts</h2>
          <button type="button" onClick={closeDialog} aria-label="Close keyboard shortcuts" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:bg-white/10 transition-colors`}><Ic n="X" size={14} /></button>
        </div>
        <p id="modal-shortcuts-description" className="sr-only">Keyboard commands available throughout Prompt Lab.</p>
        <div className="flex flex-col gap-4">
          <div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Global</p>
            <div className="flex flex-col gap-2.5">
              {[[`${primaryModKey} ↵`, 'Enhance prompt'], [`${primaryModKey} S`, saveLabel], [`${primaryModKey} K`, 'Command palette'], ['?', 'Show shortcuts'], ['Esc', 'Close modals']].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-sm ${m.textBody}`}>{label}</span>
                  <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Navigation</p>
            <div className="flex flex-col gap-2.5 mb-4">
              {[
                ['Alt 1', 'Open Write'],
                ['Alt 2', 'Open Library'],
                ['Alt 3', 'Open Compose'],
                ['Alt 4', 'Open Dual Pane'],
                ['Alt 5', 'Open Evaluate'],
                ['Alt 6', 'Open Scratch'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-sm ${m.textBody}`}>{label}</span>
                  <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                </div>
              ))}
            </div>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider mb-2`}>Scratch</p>
            <div className="flex flex-col gap-2.5">
              {[
                [`${primaryModKey} E`, 'Export / download note'],
                [`${primaryModKey} ⇧ D`, 'Insert date separator'],
                [`${primaryModKey} ⇧ C`, 'Copy all content'],
                [`${primaryModKey} ⇧ X`, 'Clear note'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className={`text-sm ${m.textBody}`}>{label}</span>
                  <kbd className={`text-xs font-mono px-2 py-1 ${m.pill} rounded-md`}>{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
