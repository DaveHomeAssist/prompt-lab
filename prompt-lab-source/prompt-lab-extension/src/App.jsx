import { useEffect, useMemo, useRef, useState } from 'react';
import {
  scorePrompt,
  ngramSimilarity,
  suggestTitleFromText,
} from './promptUtils';
import { T } from './constants';
import useLibrary from './hooks/usePromptLibrary.js';
import useUiState from './hooks/useUiState.js';
import useNavigation from './hooks/useNavigation.js';
import useEditorState from './hooks/useEditorState.js';
import useExecutionFlow from './hooks/useExecutionFlow.js';
import usePersistenceFlow from './hooks/usePersistenceFlow.js';
import useABTest from './hooks/useABTest.js';
import useBillingState from './hooks/useBillingState.js';
import useTelemetryState from './hooks/useTelemetryState.js';
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
import CreateEditorPane from './CreateEditorPane';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import AppHeader from './AppHeader';
import useRouteSync from './hooks/useRouteSync.js';
import SavePanel from './SavePanel';
import TemplateVariablesModal from './modals/TemplateVariablesModal';
import SettingsModal from './modals/SettingsModal';
import CommandPaletteModal from './modals/CommandPaletteModal';
import ShortcutsModal from './modals/ShortcutsModal';
import PiiWarningModal from './modals/PiiWarningModal';
import BillingModal from './modals/BillingModal.jsx';

const EVALUATE_QUICK_START_PROMPT = `Write a concise product update about Prompt Lab's Evaluate workspace.

Audience: experienced prompt engineers

Output format:
- one short summary paragraph
- three practical bullets

Constraints:
- keep it under 140 words
- sound precise, not hypey`;

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App({ clerkUser, clerkGetToken, clerkUserButton } = {}) {
  const ui = useUiState();
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingFeaturePrompt, setBillingFeaturePrompt] = useState(null);
  const [mdPreview, setMdPreview] = useState(false);
  const [enhMdPreview, setEnhMdPreview] = useState(false);
  const [resultTab, setResultTab] = useState('improved');
  const isWeb = !isExtension && import.meta.env?.VITE_WEB_MODE === 'true';
  const pageScroll = isWeb || isExtension;
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
  const telemetry = useTelemetryState({ notify });
  const billing = useBillingState({ notify, telemetry, clerkUser, clerkGetToken });
  const telemetryConsentPending = telemetry.consentGiven == null;
  const trackTelemetry = (event, context = {}) => {
    if (telemetry.consentGiven !== 'granted') return false;
    void telemetry.track(event, context);
    return true;
  };

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
    doSave: (overrides = {}) => persistenceFlow.doSave(executionFlow.refreshEvalRuns, overrides),
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
    cursor, updateCursor,
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
    enhance, enhanceWithMode, doSave, clearEditor, closeSavePanel, openSavePanel, openOptions, copy, cancelEnhance,
    loadEntry, sendEntryToABTest, addToComposer,
    hasSavablePrompt, currentTestCases,
  } = ed;

  const openBilling = (featureId = null) => {
    trackTelemetry('billing.modal_opened', {
      featureId: featureId || 'general',
      plan: billing.plan,
      section: activeSection,
    });
    setBillingFeaturePrompt(featureId);
    setShowBillingModal(true);
  };
  const closeBilling = () => {
    setShowBillingModal(false);
    setBillingFeaturePrompt(null);
  };

  const canUseCollections = billing.hasFeature('collections');
  const canExportLibrary = billing.hasFeature('export');
  const canRunBatchCases = billing.hasFeature('batchRuns');
  const canUseDiffView = billing.hasFeature('diffView');
  const canUseAbTesting = billing.hasFeature('abTesting');
  const saveFlowOverrides = canUseCollections ? {} : { collectionOverride: '' };

  // Keep latest handler fns in a ref so the keydown effect never goes stale
  const kbFns = useRef({ enhance, doSave, openSavePanel });
  useEffect(() => { kbFns.current = { enhance, doSave, openSavePanel }; });

  const nav = useNavigation({
    primaryView, setPrimaryView,
    workspaceView, setWorkspaceView,
    runsView, setRunsView,
    tab, setTab,
  });
  const { activeSection, openCreateView, openSection, openRunsView } = nav;
  const openRunsViewWithBilling = (nextView) => {
    if (nextView === 'compare' && !canUseAbTesting) {
      openBilling('abTesting');
      return;
    }
    openRunsView(nextView);
  };

  // ── Sync hash routes ↔ nav state ──
  useRouteSync({ primaryView, setPrimaryView, workspaceView, setWorkspaceView, runsView, setRunsView });

  useEffect(() => {
    if (primaryView === 'runs' && runsView === 'compare' && !canUseAbTesting) {
      setRunsView('history');
    }
  }, [canUseAbTesting, primaryView, runsView, setRunsView]);

  // ── Derived (view-only) ──
  const score = useMemo(() => scorePrompt(raw), [raw]);
  const wc = useMemo(
    () => (typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0),
    [raw],
  );
  // The extension shell is always effectively compact. Letting it participate
  // in desktop breakpoint switching causes narrow-panel layout oscillation,
  // which is most visible in the Library view as repeated flicker.
  const compact = isExtension || viewportWidth < 720 || viewportHeight < 560;
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
  const saveSourceText = comparisonText || raw;
  const suggestedSaveTitle = (saveTitle || '').trim() || currentEntry?.title || suggestTitleFromText(saveSourceText);
  const comparisonSourceLabel = typeof enhanced === 'string' && enhanced.trim() ? 'Current enhanced output' : 'Latest eval run';
  const goldenSimilarity = goldenResponse?.text && comparisonText
    ? ngramSimilarity(goldenResponse.text, comparisonText)
    : 0;
  const goldenThreshold = currentEntry?.goldenThreshold ?? 0.7;
  const goldenVerdict = goldenResponse?.text && comparisonText
    ? (goldenSimilarity >= goldenThreshold ? 'pass' : 'fail')
    : null;
  // activeSection is now provided by useNavigation
  const libraryOnlyMode = tab === 'editor' && workspaceView === 'library';
  const studioCreateMode = tab === 'editor' && activeSection === 'create';
  const showEditorPane = tab !== 'editor' || (!libraryOnlyMode && effectiveEditorLayout !== 'library');
  const showLibraryPane = tab !== 'editor' || libraryOnlyMode || (!studioCreateMode && effectiveEditorLayout !== 'editor');
  const createLayoutOptions = [];
  const resultTabs = [
    { id: 'improved', label: 'Improved' },
    ...(canUseDiffView ? [{ id: 'diff', label: 'Diff' }] : []),
    ...(variants.length > 0 ? [{ id: 'variants', label: `Variants (${variants.length})` }] : []),
    ...(showNotes && notes ? [{ id: 'notes', label: 'Notes' }] : []),
  ];
  const activeResultTab = resultTabs.some((tabItem) => tabItem.id === resultTab) ? resultTab : 'improved';
  const canSavePanel = hasSavablePrompt || hasPanelSaveSource;
  const showCreateContext = activeSection === 'create' && Boolean((raw || '').trim() || (enhanced || '').trim() || currentEntry);
  const showInlineSaveBar = activeSection === 'create' && canSavePanel && Boolean((enhanced || '').trim() || currentEntry);
  const pendingTemplateInputs = Array.isArray(pendingTemplate?.inputs) ? pendingTemplate.inputs : [];
  const pendingTemplateInputMap = Object.fromEntries(
    pendingTemplateInputs
      .filter((input) => input && typeof input === 'object' && typeof input.key === 'string')
      .map((input) => [input.key, input])
  );

  const appOpenTrackedRef = useRef(false);
  const lastSectionRef = useRef('');

  useEffect(() => {
    if (appOpenTrackedRef.current) return;
    if (telemetry.consentGiven !== 'granted') return;
    appOpenTrackedRef.current = true;
    trackTelemetry('app.opened', {
      section: activeSection,
      surface: telemetry.surface,
      libraryCount: lib.library.length,
      plan: billing.plan,
    });
  }, [activeSection, billing.plan, lib.library.length, telemetry]);

  useEffect(() => {
    if (telemetry.consentGiven !== 'granted') return;
    if (!activeSection || lastSectionRef.current === activeSection) return;
    lastSectionRef.current = activeSection;
    trackTelemetry('navigation.section_changed', {
      section: activeSection,
      runsView,
      workspaceView,
      plan: billing.plan,
    });
  }, [activeSection, billing.plan, runsView, telemetry, workspaceView]);

  useEffect(() => {
    if (tab !== 'editor') return;
    if (workspaceView === 'composer') return;

    // Keep layout aligned to the active workspace section, but do not sync the
    // other direction. Bi-directional syncing here causes editor/library
    // ping-pong updates and visible flicker when opening the Library view.
    if (editorLayout !== workspaceView) {
      setEditorLayout(workspaceView);
    }
  }, [editorLayout, setEditorLayout, tab, workspaceView]);

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
  const handleEnhanceRequest = () => {
    trackTelemetry('editor.enhance_requested', {
      mode: enhMode,
      inputLength: raw.length,
      wordCount: wc,
      editing: Boolean(editingId),
      plan: billing.plan,
    });
    enhance();
  };
  const handleExportLibrary = () => {
    if (canExportLibrary) {
      trackTelemetry('library.export_requested', {
        promptCount: lib.library.length,
        plan: billing.plan,
      });
      lib.exportLib();
      return;
    }
    trackTelemetry('billing.feature_blocked', {
      featureId: 'export',
      plan: billing.plan,
    });
    openBilling('export');
  };
  const handleLoadEntry = async (entry, source = 'library') => {
    trackTelemetry('library.prompt_loaded', {
      source,
      hasCollection: Boolean(entry?.collection),
      plan: billing.plan,
    });
    await loadEntry(entry);
  };
  const handleAddToComposer = (entry) => {
    trackTelemetry('composer.block_added', {
      source: 'library',
      plan: billing.plan,
    });
    addToComposer(entry);
  };
  const quickSave = () => {
    const trackedCollection = (saveFlowOverrides.collectionOverride ?? saveCollection ?? '').trim();
    const saved = persistenceFlow.doSave(executionFlow.refreshEvalRuns, {
      titleOverride: suggestedSaveTitle,
      ...saveFlowOverrides,
    });
    if (saved?.id) {
      trackTelemetry('library.prompt_saved', {
        plan: billing.plan,
        via: 'inline',
        isVersion: Boolean(saveTargetId),
        hasCollection: Boolean(trackedCollection),
      });
    }
    return saved;
  };
  const handleRunCases = () => {
    if (!canRunBatchCases) {
      trackTelemetry('billing.feature_blocked', {
        featureId: 'batchRuns',
        plan: billing.plan,
      });
      openBilling('batchRuns');
      return;
    }
    trackTelemetry('evaluate.batch_runs_requested', {
      testCaseCount: currentTestCases.length,
      plan: billing.plan,
    });
    runAllCases();
  };
  const handleSendToABTest = (entry, side) => {
    if (!canUseAbTesting) {
      trackTelemetry('billing.feature_blocked', {
        featureId: 'abTesting',
        plan: billing.plan,
      });
      openBilling('abTesting');
      return;
    }
    trackTelemetry('evaluate.abtest_prompt_sent', {
      side,
      plan: billing.plan,
    });
    sendEntryToABTest(entry, side);
  };
  const handleReEnhance = (modeId) => {
    setEnhMode(modeId);
    setResultTab('improved');
    setEnhMdPreview(false);
    enhanceWithMode(modeId);
  };
  const handleEvaluateQuickStart = () => {
    trackTelemetry('evaluate.quick_start_requested', { plan: billing.plan });
    if (currentEntry || raw.trim()) {
      openSection('create');
      notify(currentEntry
        ? 'Opened Create. Enhance this prompt to generate its first run.'
        : 'Opened Create. Enhance your current draft to generate its first run.');
      return;
    }
    clearEditor();
    setRaw(EVALUATE_QUICK_START_PROMPT);
    openSection('create');
    notify('Loaded a starter prompt into Create. Enhance it to generate your first saved run.');
  };
  const handleWorkbenchOpenEvaluate = () => {
    trackTelemetry('workbench.activation_evaluate_opened', {
      plan: billing.plan,
      libraryCount: lib.library.length,
      evalRunCount: evalRuns.length,
    });
    openRunsViewWithBilling('history');
    notify(evalRuns.length > 0
      ? 'Opened Evaluate. Review recent runs and compare the winners.'
      : 'Opened Evaluate. Your first run will appear here after you refine and save a prompt.');
  };
  const handleEvaluateOpenCompare = () => {
    if (!canUseAbTesting) {
      trackTelemetry('billing.feature_blocked', {
        featureId: 'abTesting',
        plan: billing.plan,
      });
      openBilling('abTesting');
      return;
    }
    trackTelemetry('evaluate.compare_opened', { plan: billing.plan });
    openRunsViewWithBilling('compare');
    notify('Opened Compare. Paste two variants or send prompts from the library to start an A/B run.');
  };
  const CMD_ACTIONS = buildCommandActions({
    enhance: () => { if (!loading && raw.trim()) handleEnhanceRequest(); closePalette(); },
    save: () => { if (hasSavablePrompt) openSavePanel(); closePalette(); },
    clear: () => { clearEditor(); closePalette(); },
    goEditor: () => { openSection('create'); closePalette(); },
    goLibrary: () => { openSection('library'); closePalette(); },
    goBuild: () => { openCreateView('composer'); closePalette(); },
    goRuns: () => { openSection('evaluate'); closePalette(); },
    goCompare: () => { openRunsViewWithBilling('compare'); closePalette(); },
    goNotebook: () => { setPrimaryView('notebook'); closePalette(); },
    toggleTheme: () => { setColorMode(p => p === 'dark' ? 'light' : 'dark'); closePalette(); },
    exportLib: () => { handleExportLibrary(); closePalette(); },
    openSettings: () => { setShowSettings(true); closePalette(); },
    openOptions: () => { openOptions(); closePalette(); },
    showShortcuts: () => { setShowShortcuts(true); closePalette(); },
  });
  const filteredCmds = filterCommands(CMD_ACTIONS, cmdQuery);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <ThemeProvider mode={colorMode}>
      <div
        data-theme={colorMode}
        className={`${isExtension ? 'h-screen overflow-y-auto' : 'min-h-screen'} ${m.bg} ${m.text} flex flex-col pl-density-${density}`}
        style={{ fontFamily: 'system-ui,sans-serif' }}
      >
      <h1 className="sr-only">Prompt Lab</h1>

      <AppHeader
        m={m} compact={compact} libraryCount={lib.library.length}
        colorMode={colorMode} setColorMode={setColorMode}
        activeSection={activeSection} openSection={openSection}
        openCreateView={openCreateView} openRunsView={openRunsViewWithBilling}
        primaryView={primaryView} setPrimaryView={setPrimaryView}
        workspaceView={workspaceView} runsView={runsView}
        effectiveEditorLayout={effectiveEditorLayout} setEditorLayout={setEditorLayout}
        createLayoutOptions={createLayoutOptions}
        setShowCmdPalette={setShowCmdPalette} setCmdQuery={setCmdQuery}
        setShowShortcuts={setShowShortcuts} setShowSettings={setShowSettings}
        billingPlan={billing.plan}
        billingLabel={billing.planLabel}
        openBilling={openBilling}
        clerkUserButton={clerkUser ? clerkUserButton : null}
      />

      {telemetryConsentPending && (
        <div className={`${m.surface} ${m.border} border-b px-4 py-3`}>
          <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className={`text-sm ${m.text}`}>
              Help improve Prompt Lab with lightweight usage analytics.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="telemetry-allow"
                onClick={telemetry.grantConsent}
                className="ui-control rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
              >
                Allow analytics
              </button>
              <button
                type="button"
                data-testid="telemetry-deny"
                onClick={telemetry.denyConsent}
                className={`ui-control rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${m.border} ${m.textSub} hover:bg-white/[0.06]`}
              >
                No thanks
              </button>
            </div>
          </div>
        </div>
      )}

      <main role="tabpanel" aria-label={tab} className={`pl-tab-panel flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <MainWorkspace
          m={m}
          compact={compact}
          pageScroll={pageScroll}
          showEditorPane={showEditorPane}
          showLibraryPane={showLibraryPane}
          editorPane={(
            <CreateEditorPane
              m={m}
              compact={compact}
              pageScroll={pageScroll}
              colorMode={colorMode}
              quickInject={lib.quickInject}
              recentPrompts={lib.recentPrompts}
              loadEntry={(entry) => handleLoadEntry(entry, 'create')}
              copy={copy}
              bumpUse={lib.bumpUse}
              showCreateContext={showCreateContext}
              currentEntry={currentEntry}
              suggestedSaveTitle={suggestedSaveTitle}
              canSavePanel={canSavePanel}
              openSavePanel={openSavePanel}
              openSection={openSection}
              raw={raw} setRaw={setRaw}
              updateCursor={updateCursor}
              mdPreview={mdPreview} setMdPreview={setMdPreview}
              wc={wc} score={score} inp={inp}
              lintIssues={lintIssues} lintOpen={lintOpen} setLintOpen={setLintOpen} handleLintFix={handleLintFix}
              enhMode={enhMode} setEnhMode={setEnhMode}
              enhance={handleEnhanceRequest} runAllCases={handleRunCases} clearEditor={clearEditor} cancelEnhance={cancelEnhance}
              loading={loading} runningCases={runningCases} batchProgress={batchProgress}
              currentTestCases={currentTestCases} hasSavablePrompt={hasSavablePrompt} primaryModKey={primaryModKey}
              streaming={streaming} optimisticSaveVisible={optimisticSaveVisible} showSave={showSave}
              error={error} openOptions={openOptions}
              enhanced={enhanced} setEnhanced={setEnhanced}
              enhMdPreview={enhMdPreview} setEnhMdPreview={setEnhMdPreview}
              resultTab={resultTab} setResultTab={setResultTab}
              resultTabs={resultTabs} activeResultTab={activeResultTab} copyBtn={copyBtn}
              showInlineSaveBar={showInlineSaveBar}
              saveTitle={saveTitle} setSaveTitle={setSaveTitle} quickSave={quickSave}
              editingId={editingId}
              goldenResponse={goldenResponse} goldenSimilarity={goldenSimilarity}
              goldenThreshold={goldenThreshold} goldenVerdict={goldenVerdict}
              comparisonText={comparisonText} comparisonSourceLabel={comparisonSourceLabel}
              lib={lib}
              variants={variants} showNotes={showNotes} notes={notes}
              evalRuns={evalRuns} libraryCount={lib.library.length} evalRunCount={evalRuns.length}
              onLoadQuickStartPrompt={handleEvaluateQuickStart}
              onOpenEvaluate={handleWorkbenchOpenEvaluate}
              showEvalHistory={showEvalHistory} setShowEvalHistory={setShowEvalHistory}
              streamPreview={streamPreview}
              showDiffUpgradeHint={!canUseDiffView && Boolean((enhanced || '').trim())}
              onUnlockDiff={() => openBilling('diffView')}
              runCasesLocked={!canRunBatchCases}
            />
          )}
          libraryPane={(
            <LibraryPanel
              m={m} lib={lib} compact={compact} isWeb={pageScroll}
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
              loadEntry={handleLoadEntry} addToComposer={handleAddToComposer}
              openSavePanel={openSavePanel} sendToABTest={handleSendToABTest} copy={copy}
              canUseCollections={canUseCollections}
              canExportLibrary={canExportLibrary}
              openBilling={openBilling}
            />
          )}
        />
      )}

      {/* ══ COMPOSER TAB ══ */}
      {tab === 'composer' && (
        <div className="pl-tab-panel">
        <ComposerTab m={m} library={lib.library} composerBlocks={composerBlocks} setComposerBlocks={setComposerBlocks}
          addToComposer={addToComposer} notify={notify} copy={copy} setRaw={setRaw} setTab={setTab} compact={compact} pageScroll={pageScroll} />
        </div>
      )}

      {/* ══ EVALUATE SURFACE ══ */}
      {primaryView === 'runs' && (
        <div className={`pl-tab-panel flex h-full min-h-0 flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
          <div className={`border-b px-4 py-2 ${m.border} shrink-0`}>
            <p className={`text-xs font-semibold ${m.textSub} uppercase tracking-wider`}>Evaluate</p>
            <p className={`mt-1 text-xs ${m.textMuted}`}>
              {runsView === 'compare'
                ? 'Compare prompt variants, capture winners, and keep recent A/B runs in one place.'
                : (currentEntry
                    ? 'Review enhance, test-case, and A/B runs for the selected prompt.'
                    : 'Review enhance, test-case, and A/B runs across your saved workbench.')}
            </p>
          </div>
          <div className={`min-h-0 flex-1 ${pageScroll ? '' : 'overflow-hidden'}`}>
            {runsView === 'compare' && canUseAbTesting
              ? <ABTestTab m={m} copy={copy} compact={compact} pageScroll={pageScroll} {...abTest} />
              : runsView === 'compare'
                ? (
                  <div className="flex h-full items-center justify-center p-6">
                    <div className={`${m.surface} ${m.border} max-w-md rounded-2xl border p-5 text-center`}>
                      <p className={`text-sm font-semibold ${m.text}`}>A/B testing is part of Prompt Lab Pro.</p>
                      <p className={`mt-2 text-xs leading-relaxed ${m.textMuted}`}>
                        Unlock head-to-head prompt runs, saved winners, and compare history with a Prompt Lab Pro plan.
                      </p>
                      <button
                        type="button"
                        onClick={() => openBilling('abTesting')}
                        className="ui-control mt-4 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
                      >
                        Upgrade to Pro
                      </button>
                    </div>
                  </div>
                )
              : (
                <RunTimelinePanel
                  m={m}
                  prompt={currentEntry}
                  copy={copy}
                  compact={compact}
                  pageScroll={pageScroll}
                  onQuickStart={handleEvaluateQuickStart}
                  onOpenCompare={handleEvaluateOpenCompare}
                />
              )}
          </div>
        </div>
      )}

      {/* ══ PAD TAB ══ */}
      {tab === 'pad' && <div className="pl-tab-panel"><PadTab m={m} notify={notify} pageScroll={pageScroll} onPromoteToLibrary={(title, content) => {
        setRaw(content);
        setEnhanced(content);
        setSaveTitle(title);
        setShowSave(true);
        setTab('editor');
        notify('Loaded into editor — save to library when ready.');
      }} /></div>}
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
          doSave={() => {
            const trackedCollection = (saveFlowOverrides.collectionOverride ?? saveCollection ?? '').trim();
            const saved = doSave(saveFlowOverrides);
            if (saved?.id) {
              trackTelemetry('library.prompt_saved', {
                plan: billing.plan,
                via: 'save-panel',
                isVersion: Boolean(saveTargetId),
                hasCollection: Boolean(trackedCollection),
              });
            }
            return saved;
          }} closeSavePanel={closeSavePanel} canSavePanel={canSavePanel}
          canUseCollections={canUseCollections}
          onRequestCollectionsUpgrade={() => openBilling('collections')}
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
          exportLib={handleExportLibrary} importLib={lib.importLib} clearLibrary={lib.clearLibrary}
          openOptions={openOptions} onClose={() => setShowSettings(false)}
          billing={billing}
          openBilling={openBilling}
          canUseCollections={canUseCollections}
          canExportLibrary={canExportLibrary}
          telemetry={telemetry}
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

      {showBillingModal && (
        <BillingModal
          m={m}
          billing={billing}
          requestedFeature={billingFeaturePrompt}
          onClose={closeBilling}
        />
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
