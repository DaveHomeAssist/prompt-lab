import { useRef } from 'react';
import Ic from './icons';
import GenerationControls from './GenerationControls.jsx';

export default function EditorActions({
  m,
  enhMode,
  onEnhanceModeChange,
  onEnhance,
  onRunCases,
  onSave,
  saveLabel = 'Save as new prompt',
  onClear,
  loading,
  hasInput,
  runningCases,
  batchProgress,
  testCaseCount,
  hasSavablePrompt,
  onCancelEnhance,
  onCaptureContext,
  enhanceShortcutLabel = 'Ctrl+Enter',
  runCasesLocked = false,
  // Two-pane Create workspace (docs/ENHANCE_WORKSPACE_REDESIGN_BRIEF.md, slice 1):
  // secondary actions move into a "More" menu, Save is hidden while the result
  // pane owns the single primary Save, and Refine reads "Refine again".
  groupSecondary = false,
  showSave = true,
  hasResult = false,
}) {
  const moreMenuRef = useRef(null);
  const batchLabel = batchProgress?.active
    ? `Test Enhancer ${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}`
    : 'Test Enhancer';
  const refineButtonClass = 'pl-primary-button ui-control min-w-[10rem] flex-[999_1_15rem] px-3 py-2 text-sm';
  const refineLabel = groupSecondary && hasResult ? 'Refine again' : 'Refine Prompt';
  const runCasesButtonClass = runCasesLocked
    ? 'border border-orange-400/35 bg-orange-500/12 text-orange-100 hover:bg-orange-500/18'
    : 'border border-amber-400/35 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 disabled:opacity-40';
  // Menu items close the menu before running, so focus and state settle in the editor.
  const fromMenu = (action) => (event) => {
    if (groupSecondary && moreMenuRef.current) moreMenuRef.current.open = false;
    action?.(event);
  };
  const closeMenuOnEscape = (event) => {
    if (event.key !== 'Escape' || !moreMenuRef.current?.open) return;
    moreMenuRef.current.open = false;
    moreMenuRef.current.querySelector('summary')?.focus();
  };

  const runCasesButton = (
    <button
      type="button"
      data-testid={runCasesLocked ? 'pro-gated-action' : undefined}
      onClick={fromMenu(onRunCases)}
      disabled={loading || runningCases || testCaseCount === 0}
      aria-busy={runningCases}
      aria-label={runCasesLocked ? `${batchLabel} Pro` : batchLabel}
      title={runCasesLocked ? 'Batch runs are part of Prompt Lab Pro.' : 'Test how the enhancer rewrites case inputs, not the downstream answers.'}
      className={`ui-control min-w-[8rem] flex-[0_1_9rem] flex items-center justify-center gap-1 px-3 rounded-lg py-2 text-xs font-semibold transition-colors ${runCasesButtonClass}`}
    >
      {runningCases
        ? <span className={`w-3.5 h-3.5 border-2 ${runCasesLocked ? 'border-orange-100' : 'border-amber-100'} border-t-transparent rounded-full animate-spin`} />
        : <Ic n="FlaskConical" size={12} />}
      <span className="truncate">{batchLabel}</span>
      {runCasesLocked && <span className="rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-50">Pro</span>}
    </button>
  );
  const saveButton = (
    <button
      type="button"
      onClick={onSave}
      disabled={!hasSavablePrompt}
      className="pl-primary-button ui-control min-w-[9rem] flex-[0_1_10rem] px-2.5 py-2 text-xs"
    >
      {saveLabel}
    </button>
  );
  const captureButton = typeof onCaptureContext === 'function' && (
    <button
      type="button"
      onClick={fromMenu(onCaptureContext)}
      disabled={loading}
      title="Capture the active tab's selection into the prompt (PII-scanned first)"
      className={`ui-control min-w-[8rem] flex-[0_0_auto] inline-flex items-center justify-center gap-1.5 px-2.5 ${m.btn} ${m.textAlt} disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors py-2`}
    >
      <Ic n="Download" size={11} />
      Capture Page
    </button>
  );
  const resetButton = (
    <button
      type="button"
      onClick={fromMenu(onClear)}
      disabled={loading}
      className={`ui-control min-w-[7rem] flex-[0_0_auto] ${groupSecondary ? '' : 'ml-auto '}inline-flex items-center justify-center gap-1.5 px-2.5 ${m.dangerGhost} disabled:opacity-40 rounded-lg text-xs font-semibold transition-colors py-2`}
    >
      <Ic n="RotateCcw" size={11} />
      Reset Draft
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <GenerationControls m={m} mode={enhMode} onModeChange={onEnhanceModeChange}
        disabled={loading} onTransform={modeId => onEnhance(undefined, { modeId })} />
      <button
        type="button"
        data-testid="refine-action"
        onClick={onEnhance}
        disabled={loading || !hasInput}
        aria-busy={loading}
        className={refineButtonClass}
      >
        {loading
          ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Refining...
              </>
            )
          : (
              <>
                <Ic n="Wand2" size={13} />
                {refineLabel} {enhanceShortcutLabel}
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
      {groupSecondary ? (
        <>
          {showSave && saveButton}
          <details ref={moreMenuRef} className="pl-more-menu" data-testid="editor-more-actions" onKeyDown={closeMenuOnEscape}>
            <summary className={`ui-control inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold ${m.btn} ${m.textAlt}`}>
              <Ic n="MoreHorizontal" size={13} />
              More
              <span className="sr-only"> actions</span>
            </summary>
            <div className={`pl-more-menu-panel ${m.surface} border ${m.border}`}>
              {runCasesButton}
              {captureButton}
              {resetButton}
            </div>
          </details>
        </>
      ) : (
        <>
          {runCasesButton}
          {saveButton}
          {captureButton}
          {resetButton}
        </>
      )}
    </div>
  );
}
