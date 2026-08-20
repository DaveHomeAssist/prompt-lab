import { useCallback, useRef } from 'react';
import Ic from '../icons';
import { isGhostVar } from '../promptUtils';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function TemplateVariablesModal({ m, varVals, setVarVals, pendingTemplate, pendingTemplateInputMap, applyTemplate, skipTemplate, onClose }) {
  const firstInputRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closeDialog = useCallback(() => closeRef.current?.(), []);
  const dialogRef = useDialogA11y({
    open: Boolean(pendingTemplate),
    onClose: closeDialog,
    initialFocusRef: firstInputRef,
  });

  if (!pendingTemplate) return null;
  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`}>
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-vars"
        aria-describedby="modal-vars-description"
        tabIndex={-1}
      >
        <div className="flex justify-between items-center">
          <h2 id="modal-vars" className={`font-bold text-sm ${m.text}`}>Fill Template Variables</h2>
          <button type="button" onClick={closeDialog} aria-label="Close template variables" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:text-white`}><Ic n="X" size={15} /></button>
        </div>
        <p id="modal-vars-description" className={`text-xs ${m.textAlt}`}>"{pendingTemplate.title}" contains template variables:</p>
        <div className="flex flex-col gap-2">
          {Object.keys(varVals).map((k, index) => {
            const inputDef = pendingTemplateInputMap[k];
            const isSelect = inputDef?.type === 'select' && Array.isArray(inputDef.options) && inputDef.options.length > 0;
            const fieldId = `template-variable-${index}`;
            return (
            <div key={k}>
              <label htmlFor={fieldId} className="text-xs font-mono font-semibold text-orange-400 block mb-1">
                {inputDef?.label || `{{${k}}}`}
                {isGhostVar(k) && (
                  <span className="ml-2 inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-emerald-300">
                    auto
                  </span>
                )}
              </label>
              {isSelect ? (
                <select
                  id={fieldId}
                  ref={index === 0 ? firstInputRef : undefined}
                  className={`min-h-11 w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500 ${m.text}`}
                  value={varVals[k]}
                  onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))}
                >
                  <option value="">{inputDef.placeholder || `Select ${inputDef.label || k}…`}</option>
                  {inputDef.options.map((opt) => (
                    <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
                      {typeof opt === 'string' ? opt : (opt.label || opt.value)}
                    </option>
                  ))}
                </select>
              ) : (
                <input id={fieldId} ref={index === 0 ? firstInputRef : undefined} className={`min-h-11 w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500 ${m.text}`}
                  placeholder={inputDef?.placeholder || (isGhostVar(k) ? 'Auto-filled · editable' : `Value for ${k}…`)}
                  value={varVals[k]} onChange={e => setVarVals(p => ({ ...p, [k]: e.target.value }))} />
              )}
            </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={applyTemplate} className="min-h-11 flex-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Apply Template</button>
          <button type="button" onClick={skipTemplate} className={`min-h-11 px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Skip</button>
        </div>
      </div>
    </div>
  );
}
