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
  runningCases,
  batchProgress,
  testCaseCount,
  hasSavablePrompt,
  onCancelEnhance,
  enhanceShortcutLabel = 'Ctrl+Enter',
}) {
  const batchLabel = batchProgress?.active
    ? `Run Cases ${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}`
    : 'Run Cases';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <select
          value={enhMode}
          onChange={(e) => onEnhanceModeChange(e.target.value)}
          className={`ui-control ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none min-w-[8.25rem] flex-[1_1_8.25rem] ${compact ? 'w-full' : 'max-w-40'}`}
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
            className="ui-control min-w-[7.5rem] flex-[1_1_7.5rem] flex items-center justify-center gap-1 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg py-2 text-xs font-semibold transition-colors"
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
          className="ui-control min-w-[8rem] flex-[1_1_9rem] flex items-center justify-center gap-1 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg py-2 text-xs font-semibold transition-colors"
        >
          {runningCases
            ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            : <Ic n="FlaskConical" size={12} />}
          <span className="truncate">{batchLabel}</span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={!hasSavablePrompt}
          className="ui-control min-w-[6.5rem] flex-[1_1_6.5rem] px-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors py-2"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={loading}
          className="ui-control min-w-[6.5rem] flex-[1_1_6.5rem] px-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors py-2"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
