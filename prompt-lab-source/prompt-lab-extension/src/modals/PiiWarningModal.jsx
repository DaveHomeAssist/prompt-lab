import { useCallback, useRef } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function PiiWarningModal({ m, piiWarning, piiRedactAndSend, piiSendAnyway, piiCancel }) {
  const primaryActionRef = useRef(null);
  const cancelRef = useRef(piiCancel);
  cancelRef.current = piiCancel;
  const closeDialog = useCallback(() => cancelRef.current?.(), []);
  const dialogRef = useDialogA11y({
    open: Boolean(piiWarning),
    onClose: closeDialog,
    initialFocusRef: primaryActionRef,
  });

  if (!piiWarning) return null;
  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-pii"
        aria-describedby="modal-pii-description"
        tabIndex={-1}
      >
        <div className="flex justify-between items-center">
          <h2 id="modal-pii" className={`font-bold text-sm ${m.text}`}>Sensitive Data Detected</h2>
          <button type="button" onClick={closeDialog} aria-label="Close sensitive data warning" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:text-white`}><Ic n="X" size={15} /></button>
        </div>
        <p id="modal-pii-description" className={`text-xs ${m.textAlt}`}>The following potentially sensitive items were found in your prompt. Choose whether to redact them, send unchanged, or cancel.</p>
        {piiWarning.label && <p className={`text-xs font-semibold ${m.text}`}>{piiWarning.label}</p>}
        <ul className="flex flex-col gap-1 max-h-40 overflow-y-auto" aria-label="Detected sensitive items">
          {piiWarning.matches.map(match => (
            <li key={match.id} className={`text-xs ${m.textBody} flex items-center gap-2`}>
              <span className="text-yellow-400 font-semibold uppercase text-[10px]">{match.type}</span>
              <span className="font-mono truncate">{match.snippet.length > 32
                ? `${match.snippet.slice(0, 8)}...${match.snippet.slice(-6)}`
                : match.snippet}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button ref={primaryActionRef} type="button" onClick={piiRedactAndSend}
            className="min-h-11 flex-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg py-2 text-xs font-semibold transition-colors">
            Redact & Send
          </button>
          <button type="button" onClick={piiSendAnyway}
            className="min-h-11 flex-1 bg-amber-500 hover:bg-amber-400 text-gray-950 rounded-lg py-2 text-xs font-semibold transition-colors">
            Send Anyway
          </button>
          <button type="button" onClick={closeDialog}
            className={`min-h-11 px-3 ${m.btn} ${m.textBody} rounded-lg py-2 text-xs font-semibold transition-colors`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
