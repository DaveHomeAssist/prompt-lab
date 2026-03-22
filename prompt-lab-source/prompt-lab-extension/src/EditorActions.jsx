import { useState, useRef, useEffect } from 'react';
import Ic from './icons';
import { MODES } from './constants';

export default function EditorActions({
  m,
  compact,
  enhMode,
  onEnhanceModeChange,
  onEnhance,
  onRunCases,
  onSave,
  onClear,
  loading,
  hasInput,
  hasClearableContent = hasInput,
  runningCases,
  batchProgress,
  testCaseCount,
  hasSavablePrompt,
  onCancelEnhance,
  enhanceShortcutLabel = 'Ctrl+Enter',
}) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const overflowRef = useRef(null);
  const confirmTimerRef = useRef(null);

  // Close overflow on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const onClick = (e) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showOverflow]);

  // Auto-reset confirm state
  useEffect(() => {
    if (!confirmClear) return;
    confirmTimerRef.current = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(confirmTimerRef.current);
  }, [confirmClear]);

  const handleClear = () => {
    if (!hasClearableContent) { onClear(); setShowOverflow(false); return; }
    if (confirmClear) { onClear(); setConfirmClear(false); setShowOverflow(false); return; }
    setConfirmClear(true);
  };

  const batchLabel = batchProgress?.active
    ? `Run Cases ${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}`
    : 'Run Cases';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={enhMode}
          onChange={(e) => onEnhanceModeChange(e.target.value)}
          className={`ui-control ${m.input} border rounded-lg px-2 py-1.5 text-sm ${m.text} focus:outline-none min-w-[8.25rem] flex-[1_1_8.25rem] ${compact ? 'w-full' : 'max-w-40'}`}
        >
          {MODES.map((mode) => (
            <option key={mode.id} value={mode.id}>
              {mode.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onEnhance}
          disabled={loading || !hasInput}
          aria-busy={loading}
          className="ui-control min-w-[9.5rem] flex-[999_1_11rem] flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
        >
          {loading
            ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Enhancing...
                </>
              )
            : (
                <>
                  <Ic n="Wand2" size={13} />
                  Enhance {enhanceShortcutLabel}
                </>
              )}
        </button>
        {loading && (
          <button
            type="button"
            onClick={onCancelEnhance}
            className="ui-control min-w-[7.5rem] flex-[1_1_7.5rem] flex items-center justify-center gap-1 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
          >
            <Ic n="Square" size={10} />
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={onRunCases}
          disabled={loading || runningCases || testCaseCount === 0}
          aria-busy={runningCases}
          className="ui-control min-w-[8rem] flex-[1_1_9rem] flex items-center justify-center gap-1 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-semibold transition-colors"
        >
          {runningCases
            ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Ic n="FlaskConical" size={12} />}
          <span className="truncate">{batchLabel}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!hasSavablePrompt}
          className="ui-control min-w-[6.5rem] flex-[1_1_6.5rem] px-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold transition-colors py-2"
        >
          Save
        </button>
        {/* Overflow menu — destructive actions separated from primary cluster */}
        <div className="relative ml-auto" ref={overflowRef}>
          <button
            type="button"
            onClick={() => setShowOverflow((p) => !p)}
            className={`ui-control p-2 rounded-lg transition-colors ${m.btn} ${m.textAlt} hover:text-violet-400`}
            aria-label="More actions"
            title="More actions"
          >
            <Ic n="MoreHorizontal" size={14} />
          </button>
          {showOverflow && (
            <div className={`absolute right-0 top-full mt-1 z-50 min-w-[10rem] rounded-lg border ${m.border} ${m.modal} shadow-xl py-1`}>
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                  confirmClear
                    ? 'text-red-400 bg-red-950/30 font-semibold'
                    : `${m.textAlt} hover:bg-red-950/20 hover:text-red-400`
                } disabled:opacity-40`}
              >
                <Ic n="Trash2" size={11} />
                {confirmClear ? 'Confirm Clear?' : 'Clear Editor'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
