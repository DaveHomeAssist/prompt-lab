import Ic from './icons';
import { MODES } from './constants';

export default function EditorActions({
  m,
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
  runCasesLocked = false,
}) {
  const batchLabel = batchProgress?.active
    ? `Run Cases ${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}`
    : 'Run Cases';
  const enhanceTitle = loading
    ? 'Enhancement in progress'
    : !hasInput
      ? 'Type a prompt to enable'
      : undefined;
  const runCasesTitle = runCasesLocked
    ? 'Batch runs are part of Prompt Lab Pro.'
    : loading || runningCases
      ? 'A run is already in progress'
      : testCaseCount === 0
        ? 'Add a test case to enable'
        : undefined;
  const saveTitle = !hasSavablePrompt ? 'Enhance or load a prompt to enable saving' : undefined;
  const resetTitle = loading ? 'Cancel the active run before resetting' : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={enhMode}
        onChange={(e) => onEnhanceModeChange(e.target.value)}
        className={`ui-control ${m.input} border rounded-lg px-2 py-1.5 text-xs ${m.text} focus:outline-none min-w-[8.25rem] max-w-[10rem] flex-[0_1_9rem]`}
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
        title={enhanceTitle}
        className="ui-control min-w-[10rem] flex-[999_1_15rem] flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
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
          className="ui-control min-w-[7.5rem] flex-[0_1_7.5rem] flex items-center justify-center gap-1 px-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg py-2 text-xs font-semibold transition-colors"
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
        title={runCasesTitle}
        className={`ui-control min-w-[8rem] flex-[0_1_9rem] flex items-center justify-center gap-1 px-3 rounded-lg py-2 text-xs font-semibold transition-colors ${
          runCasesLocked
            ? 'border border-violet-500/40 bg-violet-500/12 text-violet-100 hover:bg-violet-500/18'
            : 'bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white'
        }`}
      >
        {runningCases
          ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          : <Ic n="FlaskConical" size={12} />}
        <span className="truncate">{batchLabel}</span>
        {runCasesLocked && <span className="rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Pro</span>}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!hasSavablePrompt}
        title={saveTitle}
        className="ui-control min-w-[8.75rem] flex-[0_1_9rem] px-2.5 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold transition-colors py-2"
      >
        Save to Library
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={loading}
        title={resetTitle}
        className={`ui-control min-w-[7rem] flex-[0_0_auto] ml-auto inline-flex items-center justify-center gap-1.5 px-2.5 ${m.dangerGhost} disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors py-2`}
      >
        <Ic n="RotateCcw" size={11} />
        Reset Draft
      </button>
    </div>
  );
}
