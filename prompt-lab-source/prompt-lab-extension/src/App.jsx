import { useEffect, useRef, useState } from 'react';
import Ic from './icons';
import {
  wordDiff, scorePrompt,
  ngramSimilarity,
} from './promptUtils';
import { T } from './constants';
import useLibrary from './hooks/usePromptLibrary.js';
import useUiState from './hooks/useUiState.js';
import useNavigation from './hooks/useNavigation.js';
import useEditorState from './hooks/useEditorState.js';
import useExecutionFlow from './hooks/useExecutionFlow.js';
import usePersistenceFlow from './hooks/usePersistenceFlow.js';
import useABTest from './hooks/useABTest.js';
import Toast from './Toast';
import PadTab from './PadTab';
import ComposerTab from './ComposerTab';
import ABTestTab from './ABTestTab';
import LibraryPanel from './LibraryPanel';
import DesktopSettingsModal from './DesktopSettingsModal';
import VersionDiffModal from './VersionDiffModal';
import RunTimelinePanel from './RunTimelinePanel';
import { isExtension } from './lib/platform.js';
import {
  matchShortcut,
  buildCommandActions,
  filterCommands,
} from './lib/navigationRegistry.js';
import MainWorkspace from './MainWorkspace';
import EditorActions from './EditorActions';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import MarkdownPreview from './MarkdownPreview';
import AppHeader from './AppHeader';
import SavePanel from './SavePanel';
import TemplateVariablesModal from './modals/TemplateVariablesModal';
import SettingsModal from './modals/SettingsModal';
import CommandPaletteModal from './modals/CommandPaletteModal';
import ShortcutsModal from './modals/ShortcutsModal';
import PiiWarningModal from './modals/PiiWarningModal';

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const ui = useUiState();
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showGoldenComparison, setShowGoldenComparison] = useState(true);
  const [showQuickInject, setShowQuickInject] = useState(true);
  const [mdPreview, setMdPreview] = useState(false);
  const [enhMdPreview, setEnhMdPreview] = useState(false);
  const [resultTab, setResultTab] = useState('improved');
  const isWeb = !isExtension && import.meta.env?.VITE_WEB_MODE === 'true';
  const {
    viewportWidth,
    viewportHeight,
    colorMode,
    setColorMode,
    density,
    setDensity,
    primaryView,
    setPrimaryView,
    workspaceView,
    setWorkspaceView,
    runsView,
    setRunsView,
    tab,
    setTab,
    toast,
    setToast,
    notify,
    showSettings,
    setShowSettings,
    showCmdPalette,
    setShowCmdPalette,
    showShortcuts,
    setShowShortcuts,
    cmdQuery,
    setCmdQuery,
  } = ui;
  const m = T[colorMode];

  // ── Navigation hook (must precede any derived state that reads activeSection) ──
  const nav = useNavigation({
    primaryView, setPrimaryView,
    workspaceView, setWorkspaceView,
    runsView, setRunsView,
    tab, setTab,
  });
  const { activeSection, openCreateView, openSection, openRunsView } = nav;

  // ── Library hook ──
  const lib = useLibrary(notify);
  const abTest = useABTest({ notify });

  // ── Editor controllers (state + execution + persistence) ──
  const editorState = useEditorState();
  const persistenceFlow = usePersistenceFlow({
    ui: {
      ...ui,
      setABVariant: (side, promptText) => abTest.loadVariant(side, promptText),
    },
    lib,
    editor: editorState,
  });
  const executionFlow = useExecutionFlow({ ui, lib, editor: editorState, persistence: persistenceFlow });
  const ed = {
    ...editorState,
    ...persistenceFlow,
    ...executionFlow,
    doSave: () => persistenceFlow.doSave(executionFlow.refreshEvalRuns),
    clearEditor: () => {
      executionFlow.clearExecutionState();
      persistenceFlow.clearPersistenceState();
      editorState.clearEditorState();
    },
  };
  const {
    raw, setRaw, enhanced, setEnhanced, variants, notes, loading, error,
    streamPreview, streaming, optimisticSaveVisible, batchProgress,
    enhMode, setEnhMode, showNotes, setShowNotes,
    lintIssues, lintOpen, setLintOpen, handleLintFix,
    piiWarning, piiSendAnyway, piiRedactAndSend, piiCancel,
    showSave, setShowSave, editingId, setEditingId, saveTargetId, hasPanelSaveSource, saveTitle, setSaveTitle,
    saveTags, setSaveTags, saveCollection, setSaveCollection,
    changeNote, setChangeNote,
    setShowDiff,
    evalRuns, showEvalHistory, setShowEvalHistory,
    testCasesByPrompt, caseFormPromptId, editingCaseId,
    caseTitle, setCaseTitle, caseInput, setCaseInput,
    caseTraits, setCaseTraits, caseExclusions, setCaseExclusions,
    caseNotes, setCaseNotes, runningCases,
    openCaseForm, resetCaseForm, saveCaseForPrompt, removeCase,
    loadCaseIntoEditor, runSingleCase, runAllCases,
    showNewColl, setShowNewColl, newCollName, setNewCollName,
    varVals, setVarVals, showVarForm, setShowVarForm, pendingTemplate, applyTemplate, skipTemplate,
    editorLayout, setEditorLayout,
    composerBlocks, setComposerBlocks,
    enhance, doSave, clearEditor, closeSavePanel, openSavePanel, openOptions, copy, cancelEnhance,
    loadEntry, sendEntryToABTest, addToComposer,
    hasSavablePrompt, currentTestCases,
  } = ed;

  // Keep latest handler fns in a ref so the keydown effect never goes stale
  const kbFns = useRef({ enhance, doSave, openSavePanel });
  useEffect(() => { kbFns.current = { enhance, doSave, openSavePanel }; });

  // ── Derived state (no hooks below this line) ─────────────────────────────
  const score = scorePrompt(raw);
  const wc = typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const compact = viewportWidth < 720 || viewportHeight < 560;
  const effectiveEditorLayout = compact && editorLayout === 'split' ? 'editor' : editorLayout;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const copyBtn = colorMode === 'dark'
    ? 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300 hover:bg-violet-500/25'
    : 'border border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100';
  const primaryModKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl';
  const currentEntry = editingId ? lib.library.find((entry) => entry.id === editingId) || null : null;
  const versionHistoryEntry = lib.expandedVersionId
    ? lib.library.find((entry) => entry.id === lib.expandedVersionId) || null
    : null;
  const goldenResponse = currentEntry?.goldenResponse || null;
  const latestEvalRun = evalRuns[0] || null;
  const comparisonText = typeof enhanced === 'string' && enhanced.trim()
    ? enhanced
    : (typeof latestEvalRun?.output === 'string' ? latestEvalRun.output : '');
  const comparisonSourceLabel = typeof enhanced === 'string' && enhanced.trim() ? 'Current enhanced output' : 'Latest eval run';
  const goldenSimilarity = goldenResponse?.text && comparisonText
    ? ngramSimilarity(goldenResponse.text, comparisonText)
    : 0;
  const goldenThreshold = currentEntry?.goldenThreshold ?? 0.7;
  const goldenVerdict = goldenResponse?.text && comparisonText
    ? (goldenSimilarity >= goldenThreshold ? 'pass' : 'fail')
    : null;
  // ── Derived (layout modes) ──
  const libraryOnlyMode = tab === 'editor' && workspaceView === 'library';
  const studioCreateMode = tab === 'editor' && activeSection === 'create';
  const showEditorPane = tab !== 'editor' || (!libraryOnlyMode && effectiveEditorLayout !== 'library');
  const showLibraryPane = tab !== 'editor' || libraryOnlyMode || (!studioCreateMode && effectiveEditorLayout !== 'editor');
  const createLayoutOptions = [];
  const resultTabs = [
    { id: 'improved', label: 'Improved' },
    { id: 'diff', label: 'Diff' },
    ...(variants.length > 0 ? [{ id: 'variants', label: `Variants (${variants.length})` }] : []),
    ...(showNotes && notes ? [{ id: 'notes', label: 'Notes' }] : []),
  ];
  const activeResultTab = resultTabs.some((tabItem) => tabItem.id === resultTab) ? resultTab : 'improved';
  const canSavePanel = hasSavablePrompt || hasPanelSaveSource;
  const pendingTemplateInputs = Array.isArray(pendingTemplate?.inputs) ? pendingTemplate.inputs : [];
  const pendingTemplateInputMap = Object.fromEntries(
    pendingTemplateInputs
      .filter((input) => input && typeof input === 'object' && typeof input.key === 'string')
      .map((input) => [input.key, input])
  );

  useEffect(() => {
    if (tab !== 'editor') return;
    if (workspaceView === 'composer') return;
    if (editorLayout !== workspaceView) {
      setEditorLayout(workspaceView);
    }
  }, [editorLayout, setEditorLayout, tab, workspaceView]);

  useEffect(() => {
    if (tab !== 'editor') return;
    if (workspaceView === 'composer') return;
    if (effectiveEditorLayout !== workspaceView) {
      setWorkspaceView(effectiveEditorLayout);
    }
  }, [effectiveEditorLayout, setWorkspaceView, tab, workspaceView]);

  useEffect(() => {
    if (!enhanced.trim()) {
      setResultTab('improved');
      return;
    }
    setResultTab('improved');
    setEnhMdPreview(false);
  }, [enhanced, setEnhMdPreview]);

  const commitNewCollection = () => {
    const name = newCollName.trim();
    if (!name) {
      setNewCollName('');
      setShowNewColl(false);
      return;
    }
    if (!lib.collections.includes(name)) {
      lib.setCollections((prev) => [...prev, name]);
    }
    setSaveCollection(name);
    setNewCollName('');
    setShowNewColl(false);
  };

  // ── Keyboard shortcuts (driven by navigationRegistry) ──
  useEffect(() => {
    const h = e => {
      const shortcut = matchShortcut(e);
      if (!shortcut) return;
      e.preventDefault();
      switch (shortcut.id) {
        case 'enhance': if (!loading && raw.trim()) kbFns.current.enhance(); break;
        case 'save':
          if (hasSavablePrompt && !showSave) kbFns.current.openSavePanel();
          else if (canSavePanel && showSave) kbFns.current.doSave();
          break;
        case 'cmdPalette': setShowCmdPalette(p => !p); setCmdQuery(''); break;
        case 'shortcuts': setShowShortcuts(p => !p); break;
        case 'escape':
          setShowCmdPalette(false);
          setShowShortcuts(false);
          setShowSettings(false);
          closeSavePanel();
          lib.setShareId(null);
          lib.closeVersionHistory();
          break;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canSavePanel, loading, raw, showSave, hasSavablePrompt]);

  useEffect(() => {
    if (isExtension) return;
    const handler = () => setShowDesktopSettings(true);
    window.addEventListener('pl:open-settings', handler);
    return () => window.removeEventListener('pl:open-settings', handler);
  }, []);

  // ── Command palette (driven by navigationRegistry) ──
  const closePalette = () => setShowCmdPalette(false);
  const CMD_ACTIONS = buildCommandActions({
    enhance: () => { if (!loading && raw.trim()) enhance(); closePalette(); },
    save: () => { if (hasSavablePrompt) openSavePanel(); closePalette(); },
    clear: () => { clearEditor(); closePalette(); },
    goEditor: () => { openSection('create'); closePalette(); },
    goLibrary: () => { openSection('library'); closePalette(); },
    goBuild: () => { openCreateView('composer'); closePalette(); },
    goRuns: () => { openSection('experiments'); closePalette(); },
    goCompare: () => { openRunsView('compare'); closePalette(); },
    goNotebook: () => { setPrimaryView('notebook'); closePalette(); },
    toggleTheme: () => { setColorMode(p => p === 'dark' ? 'light' : 'dark'); closePalette(); },
    exportLib: () => { lib.exportLib(); closePalette(); },
    openSettings: () => { setShowSettings(true); closePalette(); },
    openOptions: () => { openOptions(); closePalette(); },
    showShortcuts: () => { setShowShortcuts(true); closePalette(); },
  });
  const filteredCmds = filterCommands(CMD_ACTIONS, cmdQuery);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider mode={colorMode}>
      <div data-theme={colorMode} className={`min-h-screen ${m.bg} ${m.text} flex flex-col pl-density-${density}`} style={{ fontFamily: 'system-ui,sans-serif' }}>
      <h1 className="sr-only">Prompt Lab</h1>

      <AppHeader
        m={m} compact={compact} libraryCount={lib.library.length}
        colorMode={colorMode} setColorMode={setColorMode}
        activeSection={activeSection} openSection={openSection}
        openCreateView={openCreateView} openRunsView={openRunsView}
        primaryView={primaryView} setPrimaryView={setPrimaryView}
        workspaceView={workspaceView} runsView={runsView}
        effectiveEditorLayout={effectiveEditorLayout} setEditorLayout={setEditorLayout}
        createLayoutOptions={createLayoutOptions}
        setShowCmdPalette={setShowCmdPalette} setCmdQuery={setCmdQuery}
        setShowShortcuts={setShowShortcuts} setShowSettings={setShowSettings}
      />

      <main role="tabpanel" aria-label={tab} className="pl-tab-panel flex-1 flex flex-col overflow-hidden">
      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <MainWorkspace
          m={m}
          compact={compact}
          isWeb={isWeb}
          showEditorPane={showEditorPane}
          showLibraryPane={showLibraryPane}
          editorPane={(
            <div className="pl-tab-panel h-full min-h-0 flex flex-col overflow-hidden">
              <div className="p-4 flex flex-col gap-3 h-full min-h-0 overflow-hidden">
              {activeSection === 'create' && createLayoutOptions.length > 0 && (
                <div className={`${compact ? 'overflow-x-auto pb-1 pl-subtle-scroll' : ''}`}>
                  <div className="pl-scroll-row">
                  {createLayoutOptions.map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setEditorLayout(id)}
                      className={`pl-tab-btn ui-control text-xs px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${effectiveEditorLayout === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>
                      {label}
                    </button>
                  ))}
                  </div>
                </div>
              )}
              {lib.quickInject.length > 0 && (
                <div className={`${m.surface} border ${m.border} rounded-lg`}>
                  <button
                    type="button"
                    onClick={() => setShowQuickInject((prev) => !prev)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Ic n="Zap" size={10} className="text-yellow-500" />
                      Frequently Used
                    </span>
                    <Ic n={showQuickInject ? 'ChevronUp' : 'ChevronDown'} size={10} />
                  </button>
                  {showQuickInject && (
                    <div className="px-3 pb-3 flex flex-col gap-2">
                      <p className={`text-xs ${m.textMuted}`}>Reuse saved prompts without leaving Create. Load replaces the current draft; Copy keeps your editor state intact.</p>
                      <div className="flex flex-col gap-1.5">
                        {lib.quickInject.map((entry) => (
                          <div key={entry.id} className={`flex flex-wrap items-center justify-between ${m.codeBlock} border ${m.border} rounded-lg px-3 py-2 gap-2`}>
                            <span className={`text-xs ${m.textBody} min-w-0 flex-1 truncate`}>{entry.title}</span>
                            <div className="flex flex-wrap gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => { copy(entry.enhanced, `Copied: ${entry.title}`); lib.bumpUse(entry.id); }}
                                className={`ui-control px-2 py-1 rounded text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => loadEntry(entry)}
                                className="ui-control px-2 py-1 rounded bg-violet-600 text-white text-xs font-semibold transition-colors hover:bg-violet-500"
                              >
                                Load
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Input */}
              <div>
                <div className={`flex justify-between items-center mb-1.5 ${compact ? 'gap-2 flex-wrap' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Input</span>
                    <div className="flex rounded-md overflow-visible border" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                      <button type="button" onClick={() => setMdPreview(false)} aria-pressed={!mdPreview}
                        className={`text-[10px] px-2 py-0.5 transition-colors ${!mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Write</button>
                      <button type="button" onClick={() => setMdPreview(true)} aria-pressed={mdPreview}
                        className={`text-[10px] px-2 py-0.5 transition-colors ${mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Preview</button>
                    </div>
                  </div>
                  <span className={`text-xs ${m.textMuted}`}>{wc}w · {raw.length}c{score ? ` · ~${score.tokens} tok` : ''}</span>
                </div>
                {mdPreview ? (
                  <div className={`${inp} overflow-y-auto`} style={{ minHeight: '12rem', maxHeight: '24rem' }}>
                    {raw.trim() ? <MarkdownPreview text={raw} /> : <span className={`text-sm ${m.textSub}`}>Nothing to preview</span>}
                  </div>
                ) : (
                  <textarea rows={8} className={inp} placeholder="Paste or write your prompt here…" value={raw} onChange={e => setRaw(e.target.value)} />
                )}
              </div>
              {/* Scoring */}
              {score && (() => {
                const checks = [['Role', score.role], ['Task', score.task], ['Format', score.format], ['Constraints', score.constraints], ['Context', score.context]];
                const cnt = checks.filter(c => c[1]).length;
                return (
                  <div className={`${m.surface} border ${m.border} rounded-lg p-3`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Prompt Quality</span>
                      <span className={`text-xs font-bold ${cnt >= 4 ? 'text-green-500' : cnt >= 2 ? 'text-yellow-500' : 'text-red-500'}`}>{cnt}/5</span>
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {checks.map(([lbl, ok]) => (
                        <span key={lbl} className={`flex items-center gap-1 text-xs ${ok ? m.scoreGood : m.scoreBad}`}>
                          {ok ? <Ic n="Check" size={9} /> : <Ic n="X" size={9} />}{lbl}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Lint Issues */}
              {lintIssues.length > 0 && (
                <div className={`${m.surface} border ${m.border} rounded-lg`}>
                  <button onClick={() => setLintOpen(p => !p)}
                    className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>
                    <span>Lint ({lintIssues.length} {lintIssues.length === 1 ? 'issue' : 'issues'})</span>
                    <Ic n={lintOpen ? 'ChevronUp' : 'ChevronDown'} size={10} />
                  </button>
                  {lintOpen && (
                    <div className="px-3 pb-3 flex flex-col gap-1.5">
                      {lintIssues.map(issue => (
                        <div key={issue.id} className={`flex items-start justify-between gap-2 text-xs ${
                          issue.severity === 'warning' ? 'text-yellow-400' : m.textAlt
                        }`}>
                          <span className="flex-1">{issue.message}</span>
                          <button onClick={() => handleLintFix(issue.id)}
                            className="shrink-0 text-violet-400 hover:text-violet-300 text-xs underline">Fix</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Mode + Enhance */}
              <span className={`text-xs ${m.textSub} uppercase tracking-widest font-semibold`}>Enhance Lab</span>
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
              />
              {(loading || batchProgress.active || optimisticSaveVisible) && (
                <div className={`${m.surface} border ${m.border} rounded-lg px-3 py-2 flex items-center justify-between gap-3`}>
                  <div className="min-w-0">
                    {loading ? (
                      <>
                        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Generation Active</p>
                        <p className={`text-xs ${m.textMuted} truncate`}>
                          {streaming ? 'Streaming response from provider…' : 'Preparing response…'}
                        </p>
                      </>
                    ) : batchProgress.active ? (
                      <>
                        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Batch Progress</p>
                        <p className={`text-xs ${m.textMuted} truncate`}>
                          {Math.min(batchProgress.completed, batchProgress.total)}/{batchProgress.total} complete
                          {batchProgress.currentLabel ? ` · ${batchProgress.currentLabel}` : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Save Ready</p>
                        <p className={`text-xs ${m.textMuted}`}>You can save this draft before the final result finishes.</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {hasSavablePrompt && !showSave && (
                      <button
                        type="button"
                        onClick={() => openSavePanel()}
                        className="ui-control rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-green-500"
                      >
                        Save Draft
                      </button>
                    )}
                    {loading && (
                      <button
                        type="button"
                        onClick={cancelEnhance}
                        className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${m.btn} ${m.textAlt}`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}
              {editingId && currentTestCases.length > 0 && (
                <div className={`flex items-center justify-between ${m.surface} border ${m.border} rounded-lg px-3 py-2`}>
                  <span className={`text-xs ${m.textSub} flex items-center gap-1.5`}>
                    <Ic n="FlaskConical" size={10} />
                    {currentTestCases.length} test {currentTestCases.length === 1 ? 'case' : 'cases'}
                  </span>
                  <button onClick={runAllCases} disabled={loading || runningCases}
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40 font-semibold transition-colors">
                    {runningCases ? <span className="w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> : <Ic n="FlaskConical" size={10} />}
                    {batchProgress.active ? `${Math.min(batchProgress.completed, batchProgress.total)}/${batchProgress.total}` : 'Run All'}
                  </button>
                </div>
              )}
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
                    <div className="mt-3">
                      <p className={`text-[11px] font-semibold uppercase tracking-wider ${colorMode === 'dark' ? 'text-red-200/80' : 'text-red-700/80'}`}>Next steps</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {error.suggestions.map((suggestion, index) => (
                          <span key={index} className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${colorMode === 'dark' ? 'border-red-400/20 bg-red-500/10 text-red-100' : 'border-red-200 bg-white text-red-700'}`}>
                            {suggestion}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {error.actions?.includes('retry') && (
                      <button
                        type="button"
                        onClick={() => enhance()}
                        className="ui-control inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-500"
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
                        Open Provider Settings
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-3">
              {/* Enhanced */}
              {(loading || enhanced) && <>
                {loading && !enhanced && (
                  <div className={`${m.surface} border ${m.border} rounded-xl p-3`}>
                    <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Results</span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse" />
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
                <div className={`${m.surface} border ${m.border} rounded-xl p-3`}>
                  <div className={`flex justify-between items-start gap-3 mb-3 ${compact ? 'flex-col' : ''}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-violet-400 uppercase tracking-widest font-semibold">Results</span>
                        {goldenVerdict && (
                          <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${goldenVerdict === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                            {goldenVerdict === 'pass' ? '✓' : '✗'} {Math.round(goldenSimilarity * 100)}%
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 text-xs ${m.textMuted}`}>Review output, compare changes, and decide what to keep.</p>
                    </div>
                    <div className={`flex items-center gap-2 ${compact ? 'w-full flex-wrap' : 'justify-end flex-wrap'} min-w-0`}>
                      {activeResultTab === 'improved' && (
                        <button onClick={() => setEnhMdPreview(p => !p)} className={`flex items-center gap-1 text-xs transition-colors ${enhMdPreview ? 'text-violet-400' : `${m.textSub} hover:text-white`} shrink-0`}>
                          <Ic n="Eye" size={10} />{enhMdPreview ? 'Edit' : 'Preview'}
                        </button>
                      )}
                      {editingId && (
                        <button
                          onClick={() => lib.pinGoldenResponse(editingId, {
                            text: enhanced,
                            runId: latestEvalRun?.id,
                            provider: latestEvalRun?.provider,
                            model: latestEvalRun?.model,
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
                      ><Ic n="Copy" size={12} />Copy</button>
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
                        className={`ui-control rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${activeResultTab === id ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeResultTab === 'improved' && (
                    enhMdPreview ? (
                      <div className={`${inp} border-violet-500/40 overflow-y-auto`} style={{ minHeight: '8rem', maxHeight: '24rem' }}>
                        <MarkdownPreview text={enhanced} />
                      </div>
                    ) : (
                      <textarea rows={5} className={`${inp} border-violet-500/40`} value={enhanced} onChange={e => setEnhanced(e.target.value)} />
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
                            <span className="text-xs font-bold text-violet-400">{v.label}</span>
                            <div className="flex gap-3">
                              <button onClick={() => { setEnhanced(v.content); setResultTab('improved'); }} className={`text-xs ${m.textAlt} hover:text-violet-400 transition-colors`}>Use</button>
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
                            <span className="font-semibold text-violet-400 truncate">{run.variantLabel || run.promptTitle}</span>
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
                {editingId && goldenResponse && (
                  <div className={`${m.surface} border ${m.border} rounded-lg`}>
                    <button
                      type="button"
                      onClick={() => setShowGoldenComparison((p) => !p)}
                      className={`w-full flex justify-between items-center px-3 py-2 text-xs font-semibold ${m.textSub} uppercase tracking-wider`}
                    >
                      <span>Golden Benchmark</span>
                      <Ic n={showGoldenComparison ? 'ChevronUp' : 'ChevronDown'} size={10} />
                    </button>
                    {showGoldenComparison && (
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
                )}
              </>}
              </>}
              </div>
            </div>
            </div>
          )}
          libraryPane={(
            <LibraryPanel
              m={m} lib={lib} compact={compact} isWeb={isWeb}
              showEditorPane={showEditorPane}
              effectiveEditorLayout={effectiveEditorLayout} setEditorLayout={setEditorLayout}
              editingId={editingId} setSaveTitle={setSaveTitle}
              testCasesByPrompt={testCasesByPrompt} evalRuns={evalRuns}
              editingCaseId={editingCaseId} caseFormPromptId={caseFormPromptId}
              caseTitle={caseTitle} setCaseTitle={setCaseTitle}
              caseInput={caseInput} setCaseInput={setCaseInput}
              caseTraits={caseTraits} setCaseTraits={setCaseTraits}
              caseExclusions={caseExclusions} setCaseExclusions={setCaseExclusions}
              caseNotes={caseNotes} setCaseNotes={setCaseNotes}
              openCaseForm={openCaseForm} resetCaseForm={resetCaseForm}
              saveCaseForPrompt={saveCaseForPrompt}
              loadCaseIntoEditor={loadCaseIntoEditor}
              runSingleCase={runSingleCase} removeCase={removeCase}
              loadEntry={loadEntry} addToComposer={addToComposer}
              openSavePanel={openSavePanel} sendToABTest={sendEntryToABTest} copy={copy}
            />
          )}
        />
      )}

      {/* ══ COMPOSER TAB ══ */}
      {tab === 'composer' && (
        <div className="pl-tab-panel">
        <ComposerTab m={m} library={lib.library} composerBlocks={composerBlocks} setComposerBlocks={setComposerBlocks}
          addToComposer={addToComposer} notify={notify} copy={copy} setRaw={setRaw} setTab={setTab} compact={compact} pageScroll={isWeb} />
        </div>
      )}

      {/* ══ A/B TEST TAB ══ */}
      {tab === 'abtest' && <div className="pl-tab-panel"><ABTestTab m={m} copy={copy} compact={compact} pageScroll={isWeb} {...abTest} /></div>}

      {/* ══ PAD TAB ══ */}
      {tab === 'pad' && <div className="pl-tab-panel"><PadTab m={m} notify={notify} pageScroll={isWeb} onPromoteToLibrary={(title, content) => {
        setRaw(content);
        setEnhanced(content);
        setSaveTitle(title);
        setShowSave(true);
        setTab('editor');
        notify('Loaded into editor — save to library when ready.');
      }} /></div>}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && <div className="pl-tab-panel"><RunTimelinePanel m={m} prompt={currentEntry} copy={copy} compact={compact} pageScroll={isWeb} /></div>}
      </main>

      {showSave && (
        <SavePanel
          m={m} primaryModKey={primaryModKey} saveTargetId={saveTargetId}
          saveTitle={saveTitle} setSaveTitle={setSaveTitle}
          saveCollection={saveCollection} setSaveCollection={setSaveCollection}
          saveTags={saveTags} setSaveTags={setSaveTags}
          changeNote={changeNote} setChangeNote={setChangeNote}
          collections={lib.collections}
          showNewColl={showNewColl} setShowNewColl={setShowNewColl}
          newCollName={newCollName} setNewCollName={setNewCollName}
          commitNewCollection={commitNewCollection}
          doSave={doSave} closeSavePanel={closeSavePanel} canSavePanel={canSavePanel}
        />
      )}

      {/* ══ MODALS ══ */}
      {showVarForm && pendingTemplate && (
        <TemplateVariablesModal
          m={m} varVals={varVals} setVarVals={setVarVals}
          pendingTemplate={pendingTemplate} pendingTemplateInputMap={pendingTemplateInputMap}
          applyTemplate={applyTemplate} skipTemplate={skipTemplate}
          onClose={() => setShowVarForm(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          m={m} showNotes={showNotes} setShowNotes={setShowNotes}
          density={density} setDensity={setDensity}
          collections={lib.collections} deleteCollection={lib.deleteCollection}
          exportLib={lib.exportLib} importLib={lib.importLib} clearLibrary={lib.clearLibrary}
          openOptions={openOptions} onClose={() => setShowSettings(false)}
        />
      )}

      {showCmdPalette && (
        <CommandPaletteModal
          m={m} cmdQuery={cmdQuery} setCmdQuery={setCmdQuery}
          filteredCmds={filteredCmds} onClose={() => setShowCmdPalette(false)}
        />
      )}

      {showShortcuts && (
        <ShortcutsModal m={m} primaryModKey={primaryModKey} onClose={() => setShowShortcuts(false)} />
      )}

      <VersionDiffModal
        entry={versionHistoryEntry}
        selectedIndex={lib.diffVersionIdx}
        onSelectIndex={lib.setDiffVersionIdx}
        onClose={lib.closeVersionHistory}
        onRestore={(version) => lib.restoreVersion(versionHistoryEntry?.id, version)}
        m={m}
      />

      <PiiWarningModal m={m} piiWarning={piiWarning} piiRedactAndSend={piiRedactAndSend} piiSendAnyway={piiSendAnyway} piiCancel={piiCancel} />

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {!isExtension && (
        <DesktopSettingsModal
          show={showDesktopSettings}
          onClose={() => setShowDesktopSettings(false)}
          m={m}
          notify={notify}
        />
      )}
      </div>
    </ThemeProvider>
  );
}
