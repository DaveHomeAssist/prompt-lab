import { useCallback, useRef } from 'react';
import Ic from '../icons';
import useDialogA11y from '../hooks/useDialogA11y.js';

export default function PromptVariableDialog({
  m,
  request,
  onChange,
  onSubmit,
  onSkip,
  onCancel,
}) {
  const firstInputRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const closeDialog = useCallback(() => cancelRef.current?.(), []);
  const dialogRef = useDialogA11y({
    open: Boolean(request),
    onClose: closeDialog,
    initialFocusRef: firstInputRef,
  });

  if (!request) return null;
  const variables = request.manual || [];
  const values = request.values || {};
  const recent = request.recent || {};

  return (
    <div className={`fixed inset-0 ${m.modalBg} flex items-center justify-center z-[90] p-4`} data-dialog-scrim="true">
      <div
        ref={dialogRef}
        className={`pl-modal-panel ${m.modal} border rounded-xl p-5 w-full max-w-md max-h-[90vh] overflow-y-auto flex flex-col gap-4`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-variable-title"
        aria-describedby="prompt-variable-description"
        tabIndex={-1}
        data-testid="prompt-variable-dialog"
      >
        <div className="flex justify-between items-center">
          <h2 id="prompt-variable-title" className={`font-bold text-sm ${m.text}`}>Fill in prompt variables</h2>
          <button type="button" onClick={closeDialog} aria-label="Cancel variable fill-in" className={`${m.textSub} min-h-11 min-w-11 rounded-lg p-2 hover:text-white`}><Ic n="X" size={15} /></button>
        </div>
        <p id="prompt-variable-description" className={`text-xs ${m.textAlt}`}>
          These values are used for this run or copy. The prompt in the editor stays as written. Recent values are remembered for this prompt.
        </p>
        <div className="flex flex-col gap-3">
          {variables.map((variable, index) => {
            const fieldId = `prompt-variable-${index}`;
            const listId = `${fieldId}-recent`;
            const saved = recent[variable.name];
            const options = Array.isArray(saved?.recent) ? saved.recent.filter(Boolean) : [];
            const showingDefault = variable.defaultValue != null && values[variable.name] === variable.defaultValue;
            return (
              <div key={variable.name}>
                <label htmlFor={fieldId} className="text-xs font-mono font-semibold text-orange-400 block mb-1">{`{{${variable.name}}}`}</label>
                <input
                  id={fieldId}
                  ref={index === 0 ? firstInputRef : undefined}
                  className={`min-h-11 w-full ${m.input} border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500 ${m.text}`}
                  value={values[variable.name] ?? ''}
                  list={options.length ? listId : undefined}
                  placeholder={variable.defaultValue != null ? `Default: ${variable.defaultValue}` : `Value for ${variable.name}`}
                  onChange={(event) => onChange?.((current) => ({ ...current, [variable.name]: event.target.value }))}
                />
                {options.length > 0 && (
                  <datalist id={listId}>
                    {options.map((option) => <option key={option} value={option} />)}
                  </datalist>
                )}
                <p className={`mt-1 text-[11px] ${m.textMuted}`}>
                  {showingDefault ? `Using the default “${variable.defaultValue}”. ` : ''}
                  {options.length > 0 ? 'Recent values for this prompt are suggested.' : 'Leave blank to use the default when one is written as {{name|default}}.'}
                </p>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => onSubmit?.(values)} className="min-h-11 flex-1 bg-orange-600 hover:bg-orange-500 text-white rounded-lg py-2 text-sm font-semibold transition-colors">Use these values</button>
          <button type="button" onClick={onSkip} className={`min-h-11 px-4 ${m.btn} rounded-lg text-sm ${m.textBody} transition-colors`}>Keep placeholders</button>
        </div>
      </div>
    </div>
  );
}
