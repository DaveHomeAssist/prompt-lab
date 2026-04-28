import { useRef, useState } from 'react';
import Ic from './icons';
import { wordDiff } from './promptUtils';
import MarkdownPreview from './MarkdownPreview';
import EditorActions from './EditorActions';
import { getLintQuickFixMeta } from './promptLint';

/**
 * CreateEditorPane – compressed Create workflow.
 *
 * Collapses the old vertical stack (Quick Inject → Context → Input → Scoring →
 * Lint → Label → Actions → Status → Test Cases → Error → Results → History →
 * Golden) into a denser layout:
 *
 *   ┌─ Context breadcrumb (1-line when collapsed) ──────────────────┐
 *   │  Input textarea                                               │
 *   │  Scoring strip + Lint badge (single row)                      │
 *   │  EditorActions + status/test indicators (merged row)          │
 *   │  ──── scrollable ────                                         │
 *   │  Error (if any)                                               │
 *   │  Results / Diff / Variants / Notes                            │
 *   │  Inline save bar                                              │
 *   │  Run history (collapsible)                                    │
 *   │  Golden benchmark (collapsible)                               │
 *   └──────────────────────────────────────────────────────────────┘
 */
export default function CreateEditorPane({
  m,
  compact,
  pageScroll = false,
  colorMode,
  // Quick inject
  quickInject,
  recentPrompts,
  loadEntry,
  copy,
  bumpUse,
  // Context
  showCreateContext,
  currentEntry,
  suggestedSaveTitle,
  canSavePanel,
  openSavePanel,
  openSection,
  // Input
  raw,
  setRaw,
  updateCursor,
  mdPreview,
  setMdPreview,
  wc,
  score,
  inp,
  // Lint
  lintIssues,
  lintOpen,
  setLintOpen,
  handleLintFix,
  // Editor actions
  enhMode,
  setEnhMode,
  enhance,
  runAllCases,
  clearEditor,
  cancelEnhance,
  loading,
  runningCases,
  batchProgress,
  currentTestCases,
  hasSavablePrompt,
  primaryModKey,
  // Status
  streaming,
  optimisticSaveVisible,
  showSave,
  // Error
  error,
  openOptions,
  // Results
  enhanced,
  setEnhanced,
  enhMdPreview,
  setEnhMdPreview,
  resultTab,
  setResultTab,
  resultTabs,
  activeResultTab,
  copyBtn,
  // Inline save
  showInlineSaveBar,
  saveTitle,
  setSaveTitle,
  quickSave,
  // Golden
  editingId,
  goldenResponse,
  goldenSimilarity,
  goldenThreshold,
  goldenVerdict,
  comparisonText,
  comparisonSourceLabel,
  lib,
  // Diff + misc
  variants,
  showNotes,
  notes,
  // Run history
  evalRuns,
  libraryCount = 0,
  evalRunCount = 0,
  onLoadQuickStartPrompt,
  onOpenEvaluate,
  showEvalHistory,
  setShowEvalHistory,
  // Stream
  streamPreview,
  showDiffUpgradeHint = false,
  onUnlockDiff,
  runCasesLocked = false,
}) {
  // ── Scoring strip (inline) ──
  const rawInputRef = useRef(null);
  const scoreChecks = score
    ? [['Role', score.role], ['Task', score.task], ['Format', score.format], ['Constraints', score.constraints], ['Context', score.context]]
    : [];
  const scoreCnt = score?.points ?? scoreChecks.filter(c => c[1]).length;
  const qualityHint = 'Heuristic quality score: five equal-weight checks for role, task, format, constraints, and context.';
  const shellClass = pageScroll
    ? 'pl-tab-panel min-h-0 flex flex-col'
    : 'pl-tab-panel h-full min-h-0 flex flex-col overflow-hidden';
  const contentClass = pageScroll
    ? 'p-4 flex flex-col gap-2'
    : 'p-4 flex flex-col gap-2 h-full min-h-0 overflow-hidden';
  const resultsClass = pageScroll
    ? 'space-y-3'
    : 'min-h-0 flex-1 overflow-y-auto pr-1 space-y-3';
  const accentTextClass = 'text-orange-400';
  const accentHoverTextClass = 'hover:text-orange-300';
  const accentSolidClass = 'bg-orange-500/90 text-white hover:bg-orange-400';
  const accentTabClass = 'bg-orange-500/90 text-white';
  const accentFieldClass = 'border-orange-400/35';
  const accentBadgeClass = 'bg-amber-500/15 text-amber-100';
  const hasDraftInput = Boolean(raw.trim());
  const hasActivationDraft = hasDraftInput || Boolean(currentEntry);
  const showWorkbenchEmptyState = !loading && !enhanced && !error;
  const activationMilestones = [
    {
      label: 'Draft ready',
      description: hasActivationDraft
        ? 'A prompt is already in play in the workbench.'
        : 'Load a starter or paste a draft to begin.',
      complete: hasActivationDraft,
    },
    {
      label: 'Saved prompt',
      description: libraryCount > 0
        ? 'Library has at least one reusable prompt.'
        : 'Save a strong prompt so it becomes reusable.',
      complete: libraryCount > 0,
    },
    {
      label: 'Run reviewed',
      description: evalRunCount > 0
        ? 'Evaluate already has proof to inspect.'
        : 'Open Evaluate after the first saved run lands.',
      complete: evalRunCount > 0,
    },
  ];
  const completedActivationMilestones = activationMilestones.filter((step) => step.complete).length;
  const activationPrimaryAction = !hasActivationDraft
    ? {
        label: 'Load Starter Draft',
        onClick: onLoadQuickStartPrompt,
        helper: 'Load a starter prompt and move straight into the refine loop.',
      }
    : libraryCount === 0
      ? {
          label: 'Save First Prompt',
          onClick: openSavePanel,
          helper: 'Turn this draft into a reusable library entry before you evaluate it.',
        }
      : evalRunCount === 0
        ? {
            label: 'Open Evaluate',
            onClick: onOpenEvaluate,
            helper: 'Review your first run and keep the strongest version.',
          }
        : null;
  const syncRawCursor = (target) => {
    if (!target || typeof updateCursor !== 'function') return;
    updateCursor(target.selectionStart ?? 0, target.selectionEnd ?? target.selectionStart ?? 0);
  };
  const handleRawChange = (event) => {
    setRaw(event.target.value);
    syncRawCursor(event.target);
  };
  const handleLintQuickFix = (ruleId) => {
    setMdPreview(false);
    const result = handleLintFix(ruleId);
    if (!result) return;
    requestAnimationFrame(() => {
      const input = rawInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };

  return (
    <div className={shellClass}>
      <div className={contentClass}>
        {/* ── Context breadcrumb ── */}
        {showCreateContext && (
          <div className={`flex items-center gap-2 flex-wrap ${m.surface} border ${m.border} rounded-lg px-3 py-2`}>
            <span className={`text-[10px] uppercase tracking-widest font-bold ${accentTextClass}`}>
              {currentEntry ? 'Editing' : 'Draft'}
            </span>
            {currentEntry?.collection && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${m.codeBlock} ${m.textSub}`}>
                {currentEntry.collection}
              </span>
            )}
            <span className={`text-xs font-semibold ${m.text} truncate min-w-0 flex-1`}>
              {currentEntry?.title || suggestedSaveTitle}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              {currentEntry && (
                <button
                  type="button"
                  onClick={() => openSection('library')}
                  className={`text-[10px] font-semibold transition-colors ${m.textAlt} ${accentHoverTextClass}`}
                >
                  View in Library
                </button>
              )}
              {canSavePanel && (
                <button
                  type="button"
                  onClick={() => openSavePanel()}
                  className={`text-[10px] font-semibold transition-colors ${accentTextClass} ${accentHoverTextClass}`}
                >
                  Library Details
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Recent strip ── */}
        {recentPrompts?.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] ${m.textMuted} uppercase tracking-wider font-semibold shrink-0 flex items-center gap-1`}>
              <Ic n="Clock" size={9} className="text-blue-400" />
              Recent
            </span>
            {recentPrompts.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => loadEntry(entry)}
                className={`inline-flex items-center ${m.codeBlock} border ${m.border} rounded-md px-2 py-1 cursor-pointer transition-colors hover:border-orange-400/60`}
                title={entry.title}
              >
                <span className={`text-[11px] ${m.textBody} truncate max-w-[10rem]`}>
                  {entry.title.length > 20 ? entry.title.slice(0, 20) + '\u2026' : entry.title}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ── Quick inject (inline chips) ── */}
        {quickInject.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] ${m.textMuted} uppercase tracking-wider font-semibold shrink-0 flex items-center gap-1`}>
              <Ic n="Zap" size={9} className="text-yellow-500" />
              Quick
            </span>
            {quickInject.map((entry) => (
              <div key={entry.id} className={`inline-flex items-center gap-1.5 ${m.codeBlock} border ${m.border} rounded-md px-2 py-1`}>
                <span className={`text-[11px] ${m.textBody} truncate max-w-[10rem]`}>{entry.title}</span>
                <button
                  type="button"
                  onClick={() => { copy(entry.enhanced, `Copied: ${entry.title}`); bumpUse(entry.id); }}
                  className={`text-[10px] font-semibold transition-colors ${m.textAlt} ${accentHoverTextClass}`}
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => loadEntry(entry)}
                  className={`text-[10px] font-semibold transition-colors ${accentTextClass} ${accentHoverTextClass}`}
                >
                  Load
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Input ── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <div className="flex items-center gap-2">
              <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Input</span>
              <div className="flex rounded-md overflow-visible border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                <button type="button" onClick={() => setMdPreview(false)} aria-pressed={!mdPreview}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${!mdPreview ? accentSolidClass : `${m.btn} ${m.textAlt}`}`}>Write</button>
                <button type="button" onClick={() => setMdPreview(true)} aria-pressed={mdPreview}
                  className={`text-[10px] px-2 py-0.5 transition-colors ${mdPreview ? accentSolidClass : `${m.btn} ${m.textAlt}`}`}>Preview</button>
              </div>
            </div>
            <span className={`text-xs ${m.textMuted}`}>{wc}w · {raw.length}c{score ? ` · ~${score.tokens} tok` : ''}</span>
          </div>
            {mdPreview ? (
            <div className={`${inp} overflow-y-auto`} style={{ minHeight: '12rem', maxHeight: '24rem' }}>
              {raw.trim() ? <MarkdownPreview text={raw} /> : <span className={`text-sm ${m.textSub}`}>Nothing to preview</span>}
            </div>
          ) : (
            <textarea
              data-testid="prompt-input"
              ref={rawInputRef}
              rows={8}
              className={inp}
              placeholder="Paste or write your prompt here…"
              value={raw}
              onChange={handleRawChange}
              onSelect={(event) => syncRawCursor(event.currentTarget)}
              onClick={(event) => syncRawCursor(event.currentTarget)}
              onKeyUp={(event) => syncRawCursor(event.currentTarget)}
            />
          )}
        </div>

        {/* ── Scoring strip + Lint badge (merged single row) ── */}
        {(score || lintIssues.length > 0) && (
          <div className="flex items-center gap-3 flex-wrap">
            {score && (
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-semibold ${m.textSub} uppercase tracking-wider`}>Quality</span>
                <span className={`text-[10px] font-bold ${scoreCnt >= 4 ? 'text-green-500' : scoreCnt >= 2 ? 'text-yellow-500' : 'text-red-500'}`}>{scoreCnt}/5</span>
                <span className={`text-[10px] ${m.textMuted}`} title={qualityHint}>
                  1 pt each
                </span>
                <div className="flex gap-1.5">
                  {scoreChecks.map(([lbl, ok]) => (
                    <span key={lbl} className={`flex items-center gap-0.5 text-[10px] ${ok ? m.scoreGood : m.scoreBad}`}>
                      {ok ? <Ic n="Check" size={8} /> : <Ic n="X" size={8} />}{lbl}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {lintIssues.length > 0 && (
              <button
                type="button"
                onClick={() => setLintOpen(p => !p)}
                className={`flex items-center gap-1 text-[10px] font-semibold ${m.textSub} hover:text-yellow-400 transition-colors`}
              >
                <Ic n="AlertTriangle" size={9} className="text-yellow-500" />
                {lintIssues.length} lint {lintIssues.length === 1 ? 'issue' : 'issues'}
                <Ic n={lintOpen ? 'ChevronUp' : 'ChevronDown'} size={8} />
              </button>
            )}
          </div>
        )}

        {/* Lint detail (expandable) */}
        {lintOpen && lintIssues.length > 0 && (
          <div className={`${m.surface} border ${m.border} rounded-lg px-3 py-2 flex flex-col gap-1`}>
            {lintIssues.map(issue => (
              <div key={issue.id} className={`flex items-start justify-between gap-2 text-xs ${
                issue.severity === 'warning' ? 'text-yellow-400' : m.textAlt
              }`}>
                <span className="flex-1">{issue.message}</span>
                <button
                  type="button"
                  onClick={() => handleLintQuickFix(issue.id)}
                  className="shrink-0 text-amber-300 hover:text-amber-200 text-xs underline"
                >
                  {getLintQuickFixMeta(issue.id)?.label || 'Quick Fix'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Actions row (with merged status + test case indicators) ── */}
        <div className="flex flex-col gap-1.5">
          <EditorActions
            m={m}
            compact={compact}
            enhMode={enhMode}
            onEnhanceModeChange={setEnhMode}
            onEnhance={enhance}
            onRunCases={runAllCases}
            onSave={() => openSavePanel()}
            onClear={clearEditor}
            onCancelEnhance={cancelEnhance}
            loading={loading}
            hasInput={Boolean(raw.trim())}
            runningCases={runningCases}
            batchProgress={batchProgress}
            testCaseCount={currentTestCases.length}
            hasSavablePrompt={hasSavablePrompt}
            enhanceShortcutLabel={`${primaryModKey}+Enter`}
            runCasesLocked={runCasesLocked}
          />

          {/* Status + test cases merged indicator strip */}
          {(loading || batchProgress.active || optimisticSaveVisible || (editingId && currentTestCases.length > 0)) && (
            <div className={`flex items-center justify-between gap-2 ${m.surface} border ${m.border} rounded-lg px-3 py-1.5`}>
              <div className="flex items-center gap-3 min-w-0 text-[11px]">
                {loading && (
                  <span className={`flex items-center gap-1.5 ${m.textSub}`}>
                    <span className="w-2.5 h-2.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                    {streaming ? 'Streaming…' : 'Preparing…'}
                  </span>
                )}
                {!loading && batchProgress.active && (
                  <span className={`flex items-center gap-1.5 ${m.textSub}`}>
                    <span className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    Batch {Math.min(batchProgress.completed, batchProgress.total)}/{batchProgress.total}
                    {batchProgress.currentLabel ? ` · ${batchProgress.currentLabel}` : ''}
                  </span>
                )}
                {!loading && !batchProgress.active && optimisticSaveVisible && (
                  <span className={`flex items-center gap-1.5 text-green-400`}>
                    <Ic n="Check" size={10} />
                    Save ready
                  </span>
                )}
                {editingId && currentTestCases.length > 0 && (
                  <span className={`flex items-center gap-1 ${m.textSub}`}>
                    <Ic n="FlaskConical" size={9} />
                    {currentTestCases.length} test {currentTestCases.length === 1 ? 'case' : 'cases'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {hasSavablePrompt && !showSave && !loading && (
                  <button
                    type="button"
                    onClick={() => openSavePanel()}
                    className="text-[10px] font-semibold text-green-400 hover:text-green-300 transition-colors"
                  >
                    Save to Library
                  </button>
                )}
                {loading && (
                  <button
                    type="button"
                    onClick={cancelEnhance}
                    className={`text-[10px] font-semibold transition-colors ${m.textAlt} hover:text-red-400`}
                  >
                    Cancel
                  </button>
                )}
                {editingId && currentTestCases.length > 0 && !loading && (
                  <button onClick={runAllCases} disabled={runningCases}
                    className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 disabled:opacity-40 font-semibold transition-colors">
                    {runningCases ? <span className="w-2.5 h-2.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Ic n="FlaskConical" size={9} />}
                    {runCasesLocked ? 'Run All Pro' : (batchProgress.active ? `${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}` : 'Run All')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Scrollable results container ── */}
        <div className={resultsClass}>
          {/* Error (moved into scroll area so it doesn't eat fixed space) */}
          {error && (
            <div className={`rounded-xl border p-3 ${colorMode === 'dark' ? 'border-red-500/35 bg-red-950/24' : 'border-red-300 bg-red-50'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold uppercase tracking-wider ${colorMode === 'dark' ? 'text-red-300' : 'text-red-700'}`}>Recovery</p>
                  <p className={`mt-1 text-sm font-semibold ${colorMode === 'dark' ? 'text-red-100' : 'text-red-800'}`}>{error.userMessage}</p>
                </div>
                <Ic n="AlertTriangle" size={14} className={`${colorMode === 'dark' ? 'text-red-300' : 'text-red-600'} shrink-0 mt-0.5`} />
              </div>
              {error.suggestions?.length > 0 && (
                <div className="mt-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${colorMode === 'dark' ? 'text-red-200/80' : 'text-red-700/80'}`}>Next steps</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {error.suggestions.map((suggestion, index) => (
                      <span key={index} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${colorMode === 'dark' ? 'border-red-400/20 bg-red-500/10 text-red-100' : 'border-red-200 bg-white text-red-700'}`}>
                        {suggestion}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {error.actions?.includes('retry') && (
                  <button
                    type="button"
                    onClick={() => enhance()}
                    className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSolidClass}`}
                  >
                    <Ic n="RefreshCw" size={11} />
                    Try Again
                  </button>
                )}
                {error.actions?.includes('open_provider_settings') && (
                  <button
                    type="button"
                    onClick={openOptions}
                    className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                  >
                    <Ic n="Settings" size={11} />
                    Provider Settings
                  </button>
                )}
              </div>
            </div>
          )}

          {showWorkbenchEmptyState && (
            <div className={`${m.surface} border ${m.border} rounded-xl p-4`}>
              <div className={`flex items-start justify-between gap-3 ${compact ? 'flex-col' : ''}`}>
                <div className="min-w-0">
                  <p className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${accentTextClass}`}>Workbench flow</p>
                  <h2 className={`mt-2 text-lg font-semibold ${m.text}`}>
                    {hasDraftInput ? 'Draft in the editor. Refine when ready.' : 'Start with a draft or load a starter.'}
                  </h2>
                  <p className={`mt-1 text-sm ${m.textMuted}`}>
                    {hasDraftInput
                      ? 'Run one pass to tighten the draft, then save the keepers to Library and evaluate them side by side.'
                      : 'Use a Quick starter above or paste your own draft. Prompt Lab keeps the write-refine-save loop in one place.'}
                  </p>
                </div>
                <span className={`inline-flex items-center rounded-full border border-amber-400/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${accentBadgeClass}`}>
                  {primaryModKey}+Enter to refine
                </span>
              </div>
              <div className={`mt-4 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-3'}`}>
                <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${accentTextClass}`}>Start</p>
                  <p className={`mt-1 text-sm ${m.text}`}>Load a Quick starter or paste a draft.</p>
                </div>
                <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${accentTextClass}`}>Refine</p>
                  <p className={`mt-1 text-sm ${m.text}`}>Generate a tighter version with the mode that fits the task.</p>
                </div>
                <div className={`${m.codeBlock} border ${m.border} rounded-lg px-3 py-2`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-wider ${accentTextClass}`}>Keep</p>
                  <p className={`mt-1 text-sm ${m.text}`}>Save strong versions to Library and run cases when you need proof.</p>
                </div>
              </div>
              <div className={`mt-4 rounded-xl border ${accentFieldClass} ${m.codeBlock} p-3`}>
                <div className={`flex items-start justify-between gap-3 ${compact ? 'flex-col' : ''}`}>
                  <div className="min-w-0">
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.24em] ${accentTextClass}`}>Activation runway</p>
                    <h3 className={`mt-2 text-base font-semibold ${m.text}`}>{completedActivationMilestones}/3 milestones</h3>
                    <p className={`mt-1 text-sm ${m.textMuted}`}>
                      {activationPrimaryAction?.helper || 'The first-run loop is complete. Keep iterating, comparing, and saving stronger prompts.'}
                    </p>
                  </div>
                  {activationPrimaryAction && typeof activationPrimaryAction.onClick === 'function' && (
                    <button
                      type="button"
                      onClick={activationPrimaryAction.onClick}
                      className={`ui-control inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${accentSolidClass}`}
                    >
                      <Ic n={activationPrimaryAction.label === 'Open Evaluate' ? 'FlaskConical' : 'Wand2'} size={11} />
                      {activationPrimaryAction.label}
                    </button>
                  )}
                </div>
                <div className={`mt-3 grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-3'}`}>
                  {activationMilestones.map((step) => (
                    <div key={step.label} className={`rounded-lg border px-3 py-2 ${step.complete ? 'border-orange-400/35 bg-orange-500/10' : `${m.border} ${m.surface}`}`}>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${step.complete ? 'bg-orange-500/90 text-white' : `${m.btn} ${m.textMuted}`}`}>
                          {step.complete ? '✓' : '·'}
                        </span>
                        <p className={`text-xs font-semibold uppercase tracking-wider ${step.complete ? accentTextClass : m.textSub}`}>{step.label}</p>
                      </div>
                      <p className={`mt-1 text-xs leading-relaxed ${m.textMuted}`}>{step.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Enhanced results */}
          {(loading || enhanced) && <>
            {loading && !enhanced && (
              <div className={`${m.surface} border ${m.border} rounded-xl p-3`}>
                <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs uppercase tracking-widest font-semibold ${accentTextClass}`}>Results</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accentBadgeClass}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-200 animate-pulse" />
                        {streaming ? 'Streaming' : 'Preparing'}
                      </span>
                    </div>
                    <p className={`mt-1 text-xs ${m.textMuted}`}>Output stays live while the request is in flight.</p>
                  </div>
                </div>
                <div className="pl-skeleton-stack">
                  <div className="pl-skeleton-line w-4/5" />
                  <div className="pl-skeleton-line w-full" />
                  <div className="pl-skeleton-line w-11/12" />
                </div>
                {streamPreview && (
                  <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap mt-3 max-h-56 overflow-y-auto`}>
                    {streamPreview}
                  </div>
                )}
              </div>
            )}
            {enhanced && <>
              <div data-testid="output-panel" className={`${m.surface} border ${m.border} rounded-xl p-3`}>
                <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs uppercase tracking-widest font-semibold ${accentTextClass}`}>Results</span>
                      {goldenVerdict && (
                        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${goldenVerdict === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {goldenVerdict === 'pass' ? '✓' : '✗'} {Math.round(goldenSimilarity * 100)}%
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-xs ${m.textMuted}`}>Copy keeps plain text only. Save stores a reusable library entry or a new library version.</p>
                  </div>
                  <div className={`flex items-center gap-2 ${compact ? 'w-full flex-wrap' : 'justify-end flex-wrap'} min-w-0`}>
                    {activeResultTab === 'improved' && (
                      <button onClick={() => setEnhMdPreview(p => !p)} className={`flex items-center gap-1 text-xs transition-colors ${enhMdPreview ? accentTextClass : `${m.textSub} hover:text-white`} shrink-0`}>
                        <Ic n="Eye" size={10} />{enhMdPreview ? 'Edit' : 'Preview'}
                      </button>
                    )}
                    {editingId && (
                      <button
                        onClick={() => lib.pinGoldenResponse(editingId, {
                          text: enhanced,
                          runId: evalRuns[0]?.id,
                          provider: evalRuns[0]?.provider,
                          model: evalRuns[0]?.model,
                        })}
                        disabled={!enhanced.trim()}
                        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors shrink-0 ${
                          enhanced.trim() ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : `${m.btn} ${m.textMuted} opacity-40 cursor-not-allowed`
                        }`}
                      >
                        <Ic n="Save" size={12} />Pin Golden
                      </button>
                    )}
                    <button
                      onClick={() => copy(enhanced)}
                      className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md font-semibold transition-colors ${copyBtn} shrink-0`}
                    ><Ic n="Copy" size={12} />Copy Output</button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3" role="tablist" aria-label="Result views">
                  {resultTabs.map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={activeResultTab === id}
                      onClick={() => {
                        setResultTab(id);
                        if (id !== 'improved') setEnhMdPreview(false);
                      }}
                      className={`ui-control rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeResultTab === id ? accentTabClass : `${m.btn} ${m.textAlt}`}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {showDiffUpgradeHint && (
                  <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${m.codeBlock} ${m.border}`}>
                    <span className={m.textMuted}>Side-by-side diff is part of Prompt Lab Pro.</span>
                    {typeof onUnlockDiff === 'function' && (
                      <button
                        type="button"
                        onClick={onUnlockDiff}
                        className="ml-2 font-semibold text-amber-300 transition-colors hover:text-amber-200"
                      >
                        Unlock Diff
                      </button>
                    )}
                  </div>
                )}

                {/* Inline save bar */}
                {showInlineSaveBar && (
                  <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 mb-3`}>
                    <div className={`flex items-center gap-3 ${compact ? 'flex-col items-stretch' : ''}`}>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.textSub} shrink-0`}>
                        {currentEntry ? 'Library Version' : 'Library Save'}
                      </span>
                      <label htmlFor="inline-save-title" className="sr-only">Prompt title</label>
                      <input
                        id="inline-save-title"
                        className={`${m.input} border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-orange-400 ${m.text} min-w-0 flex-1`}
                        placeholder={suggestedSaveTitle}
                        value={saveTitle}
                        onChange={(e) => setSaveTitle(e.target.value)}
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          data-testid="save-to-library"
                          onClick={quickSave}
                          disabled={!canSavePanel}
                          className="ui-control rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-40"
                        >
                          {currentEntry ? 'Save New Version' : 'Save to Library'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openSavePanel()}
                          className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                        >
                          Library Details
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeResultTab === 'improved' && (
                  enhMdPreview ? (
                    <div className={`${inp} ${accentFieldClass} overflow-y-auto`} style={{ minHeight: '8rem', maxHeight: '24rem' }}>
                      <MarkdownPreview text={enhanced} />
                    </div>
                  ) : (
                    <textarea data-testid="output-textarea" rows={5} className={`${inp} ${accentFieldClass}`} value={enhanced} onChange={e => setEnhanced(e.target.value)} />
                  )
                )}

                {activeResultTab === 'diff' && (
                  <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose overflow-x-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
                    {wordDiff(raw, enhanced).map((d, i) => (
                      <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5 break-words [overflow-wrap:anywhere]`}>{d.v}</span>
                    ))}
                  </div>
                )}

                {activeResultTab === 'variants' && variants.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {variants.map((v, i) => (
                      <div key={i} className={`${m.codeBlock} border ${m.border} ${m.borderHov} rounded-lg p-3 transition-colors`}>
                        <div className="flex justify-between items-center mb-1 gap-3">
                          <span className={`text-xs font-bold ${accentTextClass}`}>{v.label}</span>
                          <div className="flex gap-3">
                            <button onClick={() => { setEnhanced(v.content); setResultTab('improved'); }} className={`text-xs ${m.textAlt} ${accentHoverTextClass} transition-colors`}>Use</button>
                            <button onClick={() => copy(v.content)} className={`${m.textAlt} hover:text-white transition-colors`}><Ic n="Copy" size={10} /></button>
                          </div>
                        </div>
                        <p className={`text-xs ${m.textAlt} leading-relaxed whitespace-pre-wrap`}>{v.content}</p>
                      </div>
                    ))}
                  </div>
                )}

                {activeResultTab === 'notes' && showNotes && notes && (
                  <div className={`${m.notesBg} border rounded-lg p-3`}>
                    <p className={`text-xs font-bold ${m.notesText} mb-1`}>Enhancement Notes</p>
                    <p className={`text-xs ${m.textBody} leading-relaxed whitespace-pre-wrap`}>{notes}</p>
                  </div>
                )}
              </div>

              {/* Run history (collapsible) */}
              <div className={`${m.surface} border ${m.border} rounded-lg`}>
                <button type="button" onClick={() => setShowEvalHistory(p => !p)}
                  className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
                  <span>{editingId ? `Run History (${evalRuns.length})` : `Recent Runs (${evalRuns.length})`}</span>
                  <Ic n={showEvalHistory ? 'ChevronUp' : 'ChevronDown'} size={10} />
                </button>
                {showEvalHistory && evalRuns.length > 0 && (
                  <div className="px-3 pb-3 flex flex-col gap-2 max-h-56 overflow-y-auto">
                    {evalRuns.map((run) => (
                      <div key={run.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5 text-xs`}>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`font-semibold truncate ${accentTextClass}`}>{run.variantLabel || run.promptTitle}</span>
                          <span className={m.textMuted}>{new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        </div>
                        <div className={`flex flex-wrap gap-2 mb-1 ${m.textMuted}`}>
                          <span className="uppercase">{run.mode}</span>
                          <span>{run.provider}</span>
                          <span>{run.model}</span>
                          <span>{run.latencyMs}ms</span>
                          {run.goldenScore != null && (
                            <span className={`font-semibold ${run.goldenScore >= goldenThreshold ? 'text-emerald-400' : 'text-red-400'}`}>
                              golden {Math.round(run.goldenScore * 100)}%
                            </span>
                          )}
                        </div>
                        <p className={`${m.textBody} leading-relaxed whitespace-pre-wrap`}>{(run.output || '').slice(0, 220)}{run.output && run.output.length > 220 ? '…' : ''}</p>
                        {run.output && (
                          <div className="mt-1 flex flex-wrap gap-3">
                            <button onClick={() => copy(run.output, 'Run output copied')}
                              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md font-semibold transition-colors ${copyBtn}`}>
                              <Ic n="Copy" size={10} />Copy output
                            </button>
                            {editingId && (
                              <button
                                onClick={() => lib.pinGoldenResponse(editingId, {
                                  text: run.output,
                                  runId: run.id,
                                  provider: run.provider,
                                  model: run.model,
                                })}
                                className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
                              >
                                <Ic n="Save" size={10} />Pin as Golden
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {showEvalHistory && evalRuns.length === 0 && (
                  <div className={`ui-empty-state px-3 pb-3 text-xs ${m.textMuted}`}>No saved runs yet.</div>
                )}
              </div>

              {/* Golden benchmark (collapsible) */}
              {editingId && goldenResponse && (
                <GoldenBenchmark
                  m={m}
                  editingId={editingId}
                  goldenResponse={goldenResponse}
                  goldenSimilarity={goldenSimilarity}
                  goldenThreshold={goldenThreshold}
                  goldenVerdict={goldenVerdict}
                  comparisonText={comparisonText}
                  comparisonSourceLabel={comparisonSourceLabel}
                  lib={lib}
                  raw={raw}
                />
              )}
            </>}
          </>}
        </div>
      </div>
    </div>
  );
}

/** Golden benchmark comparison – extracted to keep the main component focused. */
function GoldenBenchmark({ m, editingId, goldenResponse, goldenSimilarity, goldenThreshold, goldenVerdict, comparisonText, comparisonSourceLabel, lib, raw }) {
  const [show, setShow] = useState(true);
  return (
    <div className={`${m.surface} border ${m.border} rounded-lg`}>
      <button
        type="button"
        onClick={() => setShow(p => !p)}
        className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}
      >
        <span>Golden Benchmark</span>
        <Ic n={show ? 'ChevronUp' : 'ChevronDown'} size={10} />
      </button>
      {show && (
        <div className="px-3 pb-3 flex flex-col gap-3">
          <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Pinned Golden</p>
                <p className={`text-xs ${m.textMuted} mt-1`}>
                  {goldenResponse.provider || 'Unknown provider'}
                  {goldenResponse.model ? ` · ${goldenResponse.model}` : ''}
                  {goldenResponse.pinnedAt ? ` · ${new Date(goldenResponse.pinnedAt).toLocaleString()}` : ''}
                </p>
              </div>
              <button
                onClick={() => lib.clearGoldenResponse(editingId)}
                className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors font-semibold"
              >
                <Ic n="Trash2" size={10} />Clear Golden
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mb-1">
              <span className={`text-xs ${m.textSub}`}>Similarity vs {comparisonSourceLabel.toLowerCase()}</span>
              <span className={`text-xs font-semibold ${goldenVerdict === 'fail' ? 'text-red-400' : 'text-emerald-400'}`}>
                {Math.round(goldenSimilarity * 100)}%
                {goldenVerdict && <span className="ml-1">({goldenVerdict})</span>}
              </span>
            </div>
            <div className={`relative w-full h-2 rounded-full overflow-hidden ${m.input} border ${m.border}`}>
              <div className={`h-full transition-all ${goldenVerdict === 'fail' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(0, Math.min(100, goldenSimilarity * 100))}%` }} />
              <div className="absolute top-0 bottom-0 w-px bg-white/50" style={{ left: `${goldenThreshold * 100}%` }} title={`Threshold: ${Math.round(goldenThreshold * 100)}%`} />
            </div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <label className={`text-xs ${m.textMuted}`}>Pass threshold</label>
              <div className="flex items-center gap-2">
                <input
                  type="range" min="0" max="100" step="5"
                  value={Math.round(goldenThreshold * 100)}
                  onChange={(e) => lib.setGoldenThreshold(editingId, Number(e.target.value) / 100)}
                  className="w-20 h-1 accent-emerald-500"
                />
                <span className={`text-xs font-mono ${m.textSub} w-8 text-right`}>{Math.round(goldenThreshold * 100)}%</span>
              </div>
            </div>
          </div>
          {comparisonText ? (
            <div>
              <p className={`text-xs ${m.textSub} font-semibold mb-1 uppercase tracking-wider`}>
                Word Diff: Golden vs {comparisonSourceLabel}
              </p>
              <div className={`${m.codeBlock} border ${m.border} rounded-lg p-3 text-sm leading-loose`}>
                {wordDiff(goldenResponse.text, comparisonText).map((d, i) => (
                  <span key={i} className={`${d.t === 'add' ? m.diffAdd : d.t === 'del' ? m.diffDel : m.diffEq} px-0.5 rounded mr-0.5`}>
                    {d.v}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className={`text-xs ${m.textMuted}`}>No enhanced output or eval run output is available to compare yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
