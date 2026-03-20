import { useEffect, useRef, useState } from 'react';
import Ic from './icons';
import {
  scorePrompt,
  ngramSimilarity, suggestTitleFromText,
} from './promptUtils';
import { T, APP_VERSION } from './constants';
import useLibrary from './hooks/usePromptLibrary.js';
import useUiState from './hooks/useUiState.js';
import useEditorState from './hooks/useEditorState.js';
import useExecutionFlow from './hooks/useExecutionFlow.js';
import usePersistenceFlow from './hooks/usePersistenceFlow.js';
import useExperiments from './hooks/useExperiments.js';
import PadTab from './PadTab';
import ComposerTab from './ComposerTab';
import ABTestTab from './ABTestTab';
import LibraryPanel from './LibraryPanel';
import RunTimelinePanel from './RunTimelinePanel';
import { isExtension } from './lib/platform.js';
import {
  matchShortcut,
  buildCommandActions,
  filterCommands,
  resolveTabState,
} from './lib/navigationRegistry.js';
import MainWorkspace from './MainWorkspace';
import HeaderNav from './HeaderNav';
import EditorActions from './EditorActions';
import ResultPane from './ResultPane';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import MarkdownPreview from './MarkdownPreview';
import SavePanel from './SavePanel';
import ModalLayer from './ModalLayer';
import { clearPromptLabDraftParams, readPromptLabDraftParams } from './lib/promptLabBridge.js';

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const ui = useUiState();
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showBugReport, setShowBugReport] = useState(false);
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

  // ── Library hook ──
  const lib = useLibrary(notify);
  const experiments = useExperiments({ notify });

  // ── Editor controllers (state + execution + persistence) ──
  const editorState = useEditorState();
  const persistenceFlow = usePersistenceFlow({
    ui: {
      ...ui,
      setABVariant: (side, promptText) => experiments.loadVariant(side, promptText),
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

  // ── Derived (view-only) ──
  const score = scorePrompt(raw);
  const wc = typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0;
  const compact = viewportWidth < 720 || viewportHeight < 560;
  const effectiveEditorLayout = compact && editorLayout === 'split' ? 'editor' : editorLayout;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-violet-500 transition-colors placeholder-gray-400 ${m.text}`;
  const resultField = `w-full ${m.input} border rounded-xl p-4 text-base leading-7 resize-none focus:outline-none focus:border-violet-400 transition-colors placeholder-gray-400 ${m.text}`;
  const copyBtn = colorMode === 'dark'
    ? 'border border-violet-400/30 bg-violet-500/15 text-violet-200 hover:border-violet-300 hover:bg-violet-500/25'
    : 'border border-violet-300 bg-violet-50 text-violet-700 hover:border-violet-400 hover:bg-violet-100';
  const showEditorPane = tab !== 'editor' || effectiveEditorLayout !== 'library';
  const showLibraryPane = tab !== 'editor' || effectiveEditorLayout !== 'editor';
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
  const activeSection = primaryView === 'runs'
    ? 'runs'
    : (workspaceView === 'library' ? 'saved' : 'create');
  const primaryTabs = [
    { id: 'create', label: 'Create' },
    { id: 'saved', label: 'Saved' },
    { id: 'runs', label: 'Runs' },
  ];
  const createLayoutOptions = compact
    ? []
    : [
        ['editor', 'Focus'],
        ['split', 'Dual Pane'],
      ];
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
  const hasEditorContent = Boolean(raw.trim() || enhanced.trim() || variants.length > 0 || notes.trim());

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

  const openCreateView = (nextView) => {
    setPrimaryView('create');
    setWorkspaceView(nextView);
  };

  const openSection = (nextSection) => {
    if (nextSection === 'create') {
      setPrimaryView('create');
      setWorkspaceView('editor');
      return;
    }
    if (nextSection === 'saved') {
      setPrimaryView('create');
      setWorkspaceView('library');
      return;
    }
    if (nextSection === 'runs') {
      setPrimaryView('runs');
      setRunsView('compare');
    }
  };

  const openRunsView = (nextView) => {
    setPrimaryView('runs');
    setRunsView(nextView);
  };

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
          setShowBugReport(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const incoming = readPromptLabDraftParams(window.location.search);
    if (!incoming.hasPayload) return;

    const nextTab = incoming.tab || 'editor';
    const nextState = resolveTabState(nextTab);
    setPrimaryView(nextState.primaryView);
    if (nextState.workspaceView) setWorkspaceView(nextState.workspaceView);
    if (nextState.runsView) setRunsView(nextState.runsView);

    if (incoming.title) {
      setSaveTitle(incoming.title.trim());
    }

    if (incoming.draft) {
      setRaw(incoming.draft);
      setEnhanced('');
      setVariants([]);
      setNotes('');
      setShowSave(false);
      setShowDiff(false);
      if (!incoming.title) {
        setSaveTitle(suggestTitleFromText(incoming.draft));
      }
    }

    if (incoming.clipboard) {
      notify('Draft copied from notes. Paste with Cmd/Ctrl+V.');
    } else if (incoming.draft) {
      notify(incoming.source ? `Draft imported from ${incoming.source}.` : 'Draft imported.');
    }

    clearPromptLabDraftParams();
  }, [
    notify,
    setEnhanced,
    setNotes,
    setPrimaryView,
    setRaw,
    setRunsView,
    setSaveTitle,
    setShowDiff,
    setShowSave,
    setVariants,
    setWorkspaceView,
  ]);

  const requestClearEditor = () => {
    if (!hasEditorContent) {
      clearEditor();
      return;
    }
    if (!window.confirm('Clear the current draft, results, and notes?')) return;
    clearEditor();
    notify('Editor cleared.');
  };

  // ── Command palette (driven by navigationRegistry) ──
  const closePalette = () => setShowCmdPalette(false);
  const CMD_ACTIONS = buildCommandActions({
    enhance: () => { if (!loading && raw.trim()) enhance(); closePalette(); },
    save: () => { if (hasSavablePrompt) openSavePanel(); closePalette(); },
    clear: () => { requestClearEditor(); closePalette(); },
    goEditor: () => { openSection('create'); closePalette(); },
    goLibrary: () => { openSection('saved'); closePalette(); },
    goBuild: () => { openCreateView('composer'); closePalette(); },
    goRuns: () => { openSection('runs'); closePalette(); },
    goCompare: () => { openRunsView('compare'); closePalette(); },
    goNotebook: () => { setPrimaryView('notebook'); closePalette(); },
    toggleTheme: () => { setColorMode(p => p === 'dark' ? 'light' : 'dark'); closePalette(); },
    exportLib: () => { lib.exportLib(); closePalette(); },
    openSettings: () => { setShowSettings(true); closePalette(); },
    reportBug: () => { setShowBugReport(true); closePalette(); },
    openOptions: () => { openOptions(); closePalette(); },
    showShortcuts: () => { setShowShortcuts(true); closePalette(); },
  });
  const filteredCmds = filterCommands(CMD_ACTIONS, cmdQuery);
  const currentSurface = primaryView === 'notebook'
    ? 'Notebook'
    : activeSection === 'runs'
      ? `Runs / ${runsView === 'compare' ? 'Compare' : 'Timeline'}`
      : workspaceView === 'composer'
        ? 'Build'
        : workspaceView === 'library'
          ? 'Saved'
          : 'Editor';
  const piiSummary = piiWarning
    ? Object.entries(
        piiWarning.matches.reduce((acc, match) => {
          const key = match.type || 'item';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      )
        .map(([type, count]) => `${count} ${type.replace(/_/g, ' ')}`)
        .join(', ')
    : '';
  const bugReportContext = {
    appVersion: APP_VERSION,
    environment: isExtension ? 'extension' : (isWeb ? 'web' : 'desktop'),
    browser: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    url: typeof window !== 'undefined' ? window.location.href : '',
    viewPath: `${primaryView}/${workspaceView}/${runsView}`,
    primaryView,
    workspaceView,
    runsView,
    tab,
    activeSection,
    colorMode,
    density,
    enhanceMode: enhMode,
    viewport: `${viewportWidth}x${viewportHeight}`,
    librarySize: lib.library.length,
    composerBlockCount: composerBlocks.length,
    testCaseCount: currentTestCases.length,
    lastError: typeof error === 'string' ? error : error?.userMessage || '',
  };

  const handleTabListKeyDown = (event, items, activeId, onActivate) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    if (!Array.isArray(items) || items.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    const nextId = items[nextIndex]?.id;
    if (!nextId) return;
    onActivate(nextId);
    requestAnimationFrame(() => {
      const tabs = event.currentTarget.querySelectorAll('[role="tab"]');
      tabs[nextIndex]?.focus();
    });
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider mode={colorMode}>
      <div data-theme={colorMode} className={`min-h-screen ${m.bg} ${m.text} flex flex-col pl-density-${density}`} style={{ fontFamily: 'system-ui,sans-serif' }}>
      <h1 className="sr-only">Prompt Lab</h1>

      {/* Header */}
      <HeaderNav
        m={m}
        compact={compact}
        colorMode={colorMode}
        setColorMode={setColorMode}
        primaryView={primaryView}
        setPrimaryView={setPrimaryView}
        workspaceView={workspaceView}
        runsView={runsView}
        tab={tab}
        libraryCount={lib.library.length}
        setShowCmdPalette={setShowCmdPalette}
        setCmdQuery={setCmdQuery}
        setShowBugReport={setShowBugReport}
        setShowShortcuts={setShowShortcuts}
        setShowSettings={setShowSettings}
        openSection={openSection}
        openCreateView={openCreateView}
        openRunsView={openRunsView}
        activeSection={activeSection}
        primaryTabs={primaryTabs}
        effectiveEditorLayout={effectiveEditorLayout}
        setEditorLayout={setEditorLayout}
        createLayoutOptions={createLayoutOptions}
        handleTabListKeyDown={handleTabListKeyDown}
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
                        className={`ui-control text-xs px-2 py-0.5 transition-colors ${!mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Write</button>
                      <button type="button" onClick={() => setMdPreview(true)} aria-pressed={mdPreview}
                        className={`ui-control text-xs px-2 py-0.5 transition-colors ${mdPreview ? 'bg-violet-600 text-white' : `${m.btn} ${m.textAlt}`}`}>Preview</button>
                    </div>
                  </div>
                  <span className={`text-xs ${m.textMuted}`} title={`${wc} words · ${raw.length} chars`}>~{score ? score.tokens : Math.round(raw.length / 4)} tok{wc ? ` · ${wc}w` : ''}</span>
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
                        <div key={issue.id} className={`${m.codeBlock} border ${m.border} rounded-lg p-2.5`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                                  issue.severity === 'warning'
                                    ? 'bg-amber-500/15 text-amber-300'
                                    : issue.severity === 'error'
                                      ? 'bg-red-500/15 text-red-300'
                                      : 'bg-slate-500/15 text-slate-300'
                                }`}>
                                  {issue.severity}
                                </span>
                                <span className={`text-[11px] ${m.textMuted}`}>Line {issue.line}</span>
                              </div>
                              <p className={`mt-1 text-sm ${m.textBody}`}>{issue.message}</p>
                              {issue.suggestedFix && (
                                <p className={`mt-1 text-xs ${m.textMuted}`}>Suggested fix: {issue.suggestedFix}</p>
                              )}
                            </div>
                            <button onClick={() => handleLintFix(issue.id)}
                              className="shrink-0 text-sm font-semibold text-violet-400 hover:text-violet-300 transition-colors">Fix</button>
                          </div>
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
                hasClearableContent={hasEditorContent}
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
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${colorMode === 'dark' ? 'bg-red-500/15 text-red-200' : 'bg-red-100 text-red-700'}`}>
                          {(error.category || 'unknown').replace(/_/g, ' ')}
                        </span>
                        {error.retryable && (
                          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${colorMode === 'dark' ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-100 text-amber-700'}`}>
                            Retryable
                          </span>
                        )}
                      </div>
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
              <ResultPane
                m={m}
                compact={compact}
                colorMode={colorMode}
                loading={loading}
                enhanced={enhanced}
                setEnhanced={setEnhanced}
                streaming={streaming}
                streamPreview={streamPreview}
                variants={variants}
                notes={notes}
                showNotes={showNotes}
                resultTab={resultTab}
                setResultTab={setResultTab}
                enhMdPreview={enhMdPreview}
                setEnhMdPreview={setEnhMdPreview}
                activeResultTab={activeResultTab}
                resultTabs={resultTabs}
                resultField={resultField}
                copyBtn={copyBtn}
                raw={raw}
                goldenVerdict={goldenVerdict}
                goldenSimilarity={goldenSimilarity}
                goldenThreshold={goldenThreshold}
                goldenResponse={goldenResponse}
                comparisonText={comparisonText}
                comparisonSourceLabel={comparisonSourceLabel}
                editingId={editingId}
                latestEvalRun={latestEvalRun}
                evalRuns={evalRuns}
                showEvalHistory={showEvalHistory}
                setShowEvalHistory={setShowEvalHistory}
                showGoldenComparison={showGoldenComparison}
                setShowGoldenComparison={setShowGoldenComparison}
                handleTabListKeyDown={handleTabListKeyDown}
                copy={copy}
                setRaw={setRaw}
                notify={notify}
                pinGoldenResponse={lib.pinGoldenResponse}
                clearGoldenResponse={lib.clearGoldenResponse}
                setGoldenThreshold={lib.setGoldenThreshold}
              />
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
      {tab === 'abtest' && <div className="pl-tab-panel"><ABTestTab m={m} copy={copy} compact={compact} pageScroll={isWeb} {...experiments} /></div>}

      {/* ══ PAD TAB (Notebook) ══ */}
      {tab === 'pad' && <div className="pl-tab-panel"><PadTab m={m} notify={notify} pageScroll={isWeb} /></div>}

      {/* ══ HISTORY TAB ══ */}
      {tab === 'history' && <div className="pl-tab-panel"><RunTimelinePanel m={m} prompt={currentEntry} copy={copy} compact={compact} pageScroll={isWeb} /></div>}
      </main>

      <SavePanel
        m={m}
        compact={compact}
        showSave={showSave}
        closeSavePanel={closeSavePanel}
        saveTargetId={saveTargetId}
        saveTitle={saveTitle}
        setSaveTitle={setSaveTitle}
        saveCollection={saveCollection}
        setSaveCollection={setSaveCollection}
        saveTags={saveTags}
        setSaveTags={setSaveTags}
        changeNote={changeNote}
        setChangeNote={setChangeNote}
        newCollName={newCollName}
        setNewCollName={setNewCollName}
        showNewColl={showNewColl}
        setShowNewColl={setShowNewColl}
        collections={lib.collections}
        commitNewCollection={commitNewCollection}
        doSave={doSave}
        canSavePanel={canSavePanel}
        primaryModKey={primaryModKey}
      />

      <ModalLayer
        m={m}
        compact={compact}
        toast={toast}
        setToast={setToast}
        templateVars={{
          showVarForm, setShowVarForm, pendingTemplate,
          varVals, setVarVals, applyTemplate, skipTemplate,
          pendingTemplateInputMap,
        }}
        settings={{
          showSettings, setShowSettings,
          showNotes, setShowNotes,
          density, setDensity,
          collections: lib.collections, setCollections: lib.setCollections,
          setLibrary: lib.setLibrary,
          exportLib: lib.exportLib, importLib: lib.importLib,
          openOptions, notify,
        }}
        cmdPalette={{
          showCmdPalette, setShowCmdPalette,
          cmdQuery, setCmdQuery,
          filteredCmds,
        }}
        shortcuts={{
          showShortcuts, setShowShortcuts,
          primaryModKey,
        }}
        pii={{
          piiWarning, piiRedactAndSend, piiSendAnyway, piiCancel,
          piiSummary,
        }}
        bugReport={{
          showBugReport,
          onCloseBugReport: () => setShowBugReport(false),
          notify, isWeb, currentSurface,
          bugReportContext, raw, enhanced, enhMode,
        }}
        versionDiff={{
          entry: versionHistoryEntry,
          selectedIndex: lib.diffVersionIdx,
          onSelectIndex: lib.setDiffVersionIdx,
          onClose: lib.closeVersionHistory,
          onRestore: (version) => lib.restoreVersion(versionHistoryEntry?.id, version),
        }}
        desktopSettings={{
          showDesktopSettings,
          onCloseDesktopSettings: () => setShowDesktopSettings(false),
          notify,
        }}
      />
      </div>
    </ThemeProvider>
  );
}
