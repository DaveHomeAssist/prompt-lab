import { useEffect, useMemo, useRef, useState } from 'react';
import {
  scorePrompt,
  ngramSimilarity,
  suggestTitleFromText,
  extractVars,
} from './promptUtils';
import { scanSensitiveData } from './piiScanner.js';
import { captureContext } from './lib/platform.js';
import { buildCaptureInsertion } from './lib/captureContext.js';
import { T, DEFAULT_GOLDEN_THRESHOLD } from './constants';
import useLibrary from './hooks/usePromptLibrary.js';
import useUiState from './hooks/useUiState.js';
import useNavigation from './hooks/useNavigation.js';
import useEditorState from './hooks/useEditorState.js';
import useExecutionFlow from './hooks/useExecutionFlow.js';
import usePersistenceFlow from './hooks/usePersistenceFlow.js';
import useFollowUpSuggestions from './hooks/useFollowUpSuggestions.js';
import useABTest from './hooks/useABTest.js';
import useBillingState from './hooks/useBillingState.js';
import useTelemetryState from './hooks/useTelemetryState.js';
import Toast from './Toast';
import PendingWritesNotice from './PendingWritesNotice.jsx';
import PadTab from './PadTab';
import ComposerTab from './ComposerTab';
import ABTestTab from './ABTestTab';
import LibraryPanel from './LibraryPanel';
import LibraryWorkspace from './LibraryWorkspace.jsx';
import DualPaneWorkspace from './DualPaneWorkspace.jsx';
import DesktopSettingsModal from './DesktopSettingsModal';
import VersionDiffModal from './VersionDiffModal';
import RunTimelinePanel from './RunTimelinePanel';
import { isExtension, sessionSet } from './lib/platform.js';
import {
  matchShortcut,
  buildCommandActions,
  filterCommands,
} from './lib/navigationRegistry.js';
import MainWorkspace from './MainWorkspace';
import CreateEditorPane from './CreateEditorPane';
import { ThemeProvider } from './theme/ThemeProvider.jsx';
import AppHeader from './AppHeader';
import MobileNavigation from './MobileNavigation.jsx';
import useRouteSync from './hooks/useRouteSync.js';
import useDialogA11y from './hooks/useDialogA11y.js';
import Ic from './icons.jsx';
import SavePanel from './SavePanel';
import TemplateVariablesModal from './modals/TemplateVariablesModal';
import SettingsModal from './modals/SettingsModal';
import CommandPaletteModal from './modals/CommandPaletteModal';
import ShortcutsModal from './modals/ShortcutsModal';
import PiiWarningModal from './modals/PiiWarningModal';
import BillingModal from './modals/BillingModal.jsx';
import {
  buildLandingTelemetryEvents,
  normalizeLandingIntent,
} from './lib/landingAttribution.js';
import { createPromptEntry } from './lib/promptSchema.js';
import { getPrimarySaveLabel } from './lib/promptLifecycle.js';

const EVALUATE_QUICK_START_PROMPT = `Write a concise product update about Prompt Lab's Evaluate workspace.

Audience: experienced prompt engineers

Output format:
- one short summary paragraph
- three practical bullets

Constraints:
- keep it under 140 words
- sound precise, not hypey`;

const DRAFT_RECOVERY_STORAGE_KEY = 'pl2-draft-reset-recovery-v1';

function loadDraftRecovery() {
  try {
    if (typeof window === 'undefined') return null;
    const parsed = JSON.parse(window.sessionStorage.getItem(DRAFT_RECOVERY_STORAGE_KEY) || 'null');
    return parsed && typeof parsed === 'object' && parsed.editor ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function persistDraftRecovery(snapshot) {
  try {
    if (snapshot) {
      window.sessionStorage.setItem(DRAFT_RECOVERY_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      window.sessionStorage.removeItem(DRAFT_RECOVERY_STORAGE_KEY);
    }
  } catch (_error) {
    // Recovery still works for the active page when session storage is unavailable.
  }
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App({
  clerkUser,
  clerkGetToken,
  clerkUserButton,
  landingIntent,
  landingAttribution,
  onLandingIntentConsumed,
  onLandingAttributionConsumed,
} = {}) {
  const ui = useUiState();
  const [showDesktopSettings, setShowDesktopSettings] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingReturnToSettings, setBillingReturnToSettings] = useState(false);
  const [billingFeaturePrompt, setBillingFeaturePrompt] = useState(null);
  const [requestedBillingPeriod, setRequestedBillingPeriod] = useState(null);
  const [requestedBillingSource, setRequestedBillingSource] = useState(null);
  const [mdPreview, setMdPreview] = useState(false);
  const [enhMdPreview, setEnhMdPreview] = useState(false);
  const [resultTab, setResultTab] = useState('improved');
  const [showResetDraftConfirmation, setShowResetDraftConfirmation] = useState(false);
  const [pendingResetIntent, setPendingResetIntent] = useState('reset');
  const [splitMobilePane, setSplitMobilePane] = useState('library');
  const [scratchOpenNoteId, setScratchOpenNoteId] = useState('');
  const [draftRecovery, setDraftRecovery] = useState(loadDraftRecovery);
  const appShellRef = useRef(null);
  const settingsButtonRef = useRef(null);
  const resetCancelRef = useRef(null);
  const resetDialogRef = useDialogA11y({
    open: showResetDraftConfirmation,
    onClose: () => setShowResetDraftConfirmation(false),
    initialFocusRef: resetCancelRef,
  });
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
  const followUpSuggestions = useFollowUpSuggestions({
    raw: editorState.raw,
    enhanced: editorState.enhanced,
  });
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
    raw, setRaw, enhanced, setEnhanced, variants, setVariants, notes, setNotes, resultMeta, setResultMeta, loading, error,
    streamPreview, streaming, optimisticSaveVisible, batchProgress,
    enhMode, setEnhMode, showNotes, setShowNotes,
    cursor, updateCursor,
    lintIssues, lintOpen, setLintOpen, handleLintFix,
    piiWarning, piiSendAnyway, piiRedactAndSend, piiCancel,
    showSave, setShowSave, editingId, setEditingId, saveTargetId, hasPanelSaveSource, saveTitle, setSaveTitle,
    saveTags, setSaveTags, saveCollection, setSaveCollection,
    changeNote, setChangeNote,
    sourceNoteId, setSourceNoteId,
    lastSaveReceipt, dismissSaveReceipt,
    setShowDiff,
    evalRuns, showEvalHistory, setShowEvalHistory, updateEvalRun,
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
    loadEntry, deleteEntry, restoreEntryVersion, sendEntryToABTest, addToComposer,
    hasSavablePrompt, currentTestCases,
  } = ed;

  const openBilling = (featureId = null) => {
    trackTelemetry('billing.modal_opened', {
      featureId: featureId || 'general',
      plan: billing.plan,
      section: activeSection,
    });
    setRequestedBillingPeriod(null);
    setRequestedBillingSource(null);
    setBillingFeaturePrompt(featureId);
    setShowBillingModal(true);
  };
  const closeBilling = () => {
    setShowBillingModal(false);
    if (billingReturnToSettings) setShowSettings(true);
    setBillingReturnToSettings(false);
    setBillingFeaturePrompt(null);
    setRequestedBillingPeriod(null);
    setRequestedBillingSource(null);
  };

  const canUseCollections = billing.hasFeature('collections');
  const canExportLibrary = billing.hasFeature('export');
  const canImportLibrary = billing.hasFeature('import');
  const canUsePacks = billing.hasFeature('packs');
  const canRunBatchCases = billing.hasFeature('batchRuns');
  const canUseDiffView = billing.hasFeature('diffView');
  const canUseAbTesting = billing.hasFeature('abTesting');
  const saveFlowOverrides = canUseCollections ? {} : { collectionOverride: '' };

  // Keep latest handler fns in a ref so the keydown effect never goes stale
  const kbFns = useRef({ enhance, doSave, openSavePanel, primarySave: doSave });
  useEffect(() => { kbFns.current = { enhance, doSave, openSavePanel, primarySave: quickSave }; });

  const nav = useNavigation({
    primaryView, setPrimaryView,
    workspaceView, setWorkspaceView,
    runsView, setRunsView,
    tab, setTab,
  });
  const { activeSection, openCreateView, openSection, openRunsView } = nav;
  useEffect(() => {
    if (typeof appShellRef.current?.scrollTo === 'function') {
      appShellRef.current.scrollTo({ top: 0, left: 0 });
    }
  }, [primaryView, workspaceView, runsView]);
  const landingPricingIntent = normalizeLandingIntent(landingIntent);
  const landingRequestedPeriod = landingPricingIntent?.period || null;
  const landingRequestedSource = landingPricingIntent?.source || null;
  const landingIntentHandledRef = useRef(false);
  const landingAttributionHandledRef = useRef(false);

  useEffect(() => {
    if (!isWeb || !landingRequestedPeriod || landingIntentHandledRef.current) return;
    landingIntentHandledRef.current = true;
    setBillingFeaturePrompt(null);
    setRequestedBillingPeriod(landingRequestedPeriod);
    setRequestedBillingSource(landingRequestedSource);
    setShowBillingModal(true);
    onLandingIntentConsumed?.();
  }, [isWeb, landingRequestedPeriod, landingRequestedSource, onLandingIntentConsumed]);

  useEffect(() => {
    if (!isWeb || landingAttributionHandledRef.current || telemetry.consentGiven == null) return;
    if (telemetry.consentGiven === 'granted' && telemetry.telemetryEnabled !== true) return;
    landingAttributionHandledRef.current = true;

    if (telemetry.consentGiven === 'granted') {
      const events = buildLandingTelemetryEvents({ landingIntent, landingAttribution });
      events.forEach(({ event, context }) => {
        void telemetry.track(event, context, { includeContactEmail: false });
      });
    }

    onLandingAttributionConsumed?.();
  }, [
    isWeb,
    landingAttribution,
    landingIntent,
    onLandingAttributionConsumed,
    telemetry,
  ]);
  const openRunsViewWithBilling = (nextView) => {
    if (nextView === 'compare' && !canUseAbTesting) {
      openBilling('abTesting');
      return;
    }
    openRunsView(nextView);
  };

  // ── Sync hash routes ↔ nav state ──
  const { replaceRoute } = useRouteSync({
    primaryView, setPrimaryView,
    workspaceView, setWorkspaceView,
    runsView, setRunsView,
    splitPane: splitMobilePane,
    setSplitPane: setSplitMobilePane,
    compact: viewportWidth < 720,
    preserveSharedHash: persistenceFlow.sharedHashPending,
    // L-2: a dead deep link recovers to Write with a visible explanation
    // instead of silently resolving back to the previous workspace.
    onUnknownRoute: (pathname) => {
      notify(`Page not found (${pathname}). Showing the Write workspace.`);
    },
  });

  useEffect(() => {
    if (primaryView === 'runs' && runsView === 'compare' && !canUseAbTesting) {
      replaceRoute('/evaluate');
      setRunsView('history');
      openBilling('abTesting');
    }
  }, [canUseAbTesting, primaryView, replaceRoute, runsView, setRunsView]);

  const buildDraftSnapshot = (reason = 'reset') => ({
    reason,
    editor: {
      raw,
      enhanced,
      variants: variants.map((variant) => ({ ...variant })),
      notes,
      resultMeta,
      enhMode,
      cursor,
    },
    persistence: {
      editingId,
      saveTitle,
      saveTags: [...saveTags],
      saveCollection,
      changeNote,
      sourceNoteId,
    },
    resultTab,
    workspaceView,
  });

  const preserveDraftForUndo = (reason) => {
    const snapshot = buildDraftSnapshot(reason);
    persistDraftRecovery(snapshot);
    setDraftRecovery(snapshot);
    return snapshot;
  };

  const requestDraftReset = (intent = 'reset') => {
    const hasDraftContent = Boolean(
      raw.trim()
      || enhanced.trim()
      || variants.length
      || notes.trim()
      || editingId,
    );
    if (!hasDraftContent) {
      clearEditor();
      openCreateView('editor');
      return;
    }
    setPendingResetIntent(intent === 'new' ? 'new' : 'reset');
    setShowResetDraftConfirmation(true);
  };

  const confirmDraftReset = () => {
    preserveDraftForUndo(pendingResetIntent);
    clearEditor();
    openCreateView('editor');
    setEnhMdPreview(false);
    setResultTab('improved');
    setShowResetDraftConfirmation(false);
    notify(`${pendingResetIntent === 'new' ? 'New prompt started' : 'Draft reset'}. Undo is available.`);
  };

  const dismissDraftRecovery = () => {
    persistDraftRecovery(null);
    setDraftRecovery(null);
  };

  const undoDraftReset = () => {
    if (!draftRecovery) return;
    const { editor, persistence, resultTab: recoveredResultTab } = draftRecovery;
    setRaw(editor.raw || '');
    setEnhanced(editor.enhanced || '');
    setVariants(Array.isArray(editor.variants) ? editor.variants : []);
    setNotes(editor.notes || '');
    setResultMeta(editor.resultMeta || null);
    setEnhMode(editor.enhMode || 'balanced');
    if (editor.cursor && typeof updateCursor === 'function') updateCursor(editor.cursor.start || 0, editor.cursor.end || 0);
    setEditingId(persistence?.editingId || null);
    setSaveTitle(persistence?.saveTitle || '');
    setSaveTags(Array.isArray(persistence?.saveTags) ? persistence.saveTags : []);
    setSaveCollection(persistence?.saveCollection || '');
    setChangeNote(persistence?.changeNote || '');
    setSourceNoteId(persistence?.sourceNoteId || '');
    setResultTab(recoveredResultTab || 'improved');
    if (draftRecovery.workspaceView) openCreateView(draftRecovery.workspaceView);
    dismissDraftRecovery();
    notify('Draft restored.');
  };

  // ── Derived (view-only) ──
  const score = useMemo(() => scorePrompt(raw), [raw]);
  const wc = useMemo(
    () => (typeof raw === 'string' && raw.trim() ? raw.trim().split(/\s+/).length : 0),
    [raw],
  );
  // Navigation shape follows width across extension, hosted web, and desktop.
  // This keeps the wide two-level hierarchy available in resized shells while
  // preserving the flattened bottom navigation below the compact breakpoint.
  const compact = viewportWidth < 720;
  const effectiveEditorLayout = compact && editorLayout === 'split' ? 'editor' : editorLayout;
  const inp = `w-full ${m.input} border rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-orange-500 transition-colors placeholder-gray-400 ${m.text}`;
  const copyBtn = colorMode === 'dark'
    ? 'border border-orange-400/30 bg-orange-500/15 text-orange-200 hover:border-orange-300 hover:bg-orange-500/25'
    : 'border border-orange-300 bg-orange-50 text-orange-700 hover:border-orange-400 hover:bg-orange-100';
  const primaryModKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
    ? 'Cmd'
    : 'Ctrl';
  const currentEntry = editingId ? lib.library.find((entry) => entry.id === editingId) || null : null;
  const primarySaveLabel = getPrimarySaveLabel(editingId);
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
  const goldenThreshold = currentEntry?.goldenThreshold ?? DEFAULT_GOLDEN_THRESHOLD;
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
  const recoveryActionLabel = draftRecovery?.reason === 'discard-result'
    ? 'Restore discarded result'
    : draftRecovery?.reason === 'navigation'
      ? 'Restore previous draft'
      : draftRecovery?.reason === 'follow-up'
        ? 'Restore pre-follow-up draft'
        : 'Undo reset';
  const recoveryDescription = draftRecovery?.reason === 'discard-result'
    ? 'Your discarded enhancement result is recoverable in this session.'
    : draftRecovery?.reason === 'navigation'
      ? 'The draft from before navigation is recoverable in this session.'
      : 'The previous draft is recoverable in this session.';

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
          if (canSavePanel && showSave) kbFns.current.doSave();
          else if (canSavePanel) kbFns.current.primarySave();
          break;
        case 'navWrite': openCreateView('editor'); break;
        case 'navLibrary': openCreateView('library'); break;
        case 'navCompose': openCreateView('composer'); break;
        case 'navSplit': openCreateView('split'); break;
        case 'navEvaluate': openSection('evaluate'); break;
        case 'navScratch': setPrimaryView('notebook'); break;
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
  }, [canSavePanel, loading, raw, showSave, openCreateView, openSection, setPrimaryView]);

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
    if ((raw.trim() || enhanced.trim()) && entry?.id !== editingId) {
      preserveDraftForUndo('navigation');
    }
    await loadEntry(entry);
  };
  const handleAddToComposer = (entry) => {
    trackTelemetry('composer.block_added', {
      source: 'library',
      plan: billing.plan,
    });
    addToComposer(entry);
  };
  const handleUseFollowUp = (suggestion) => {
    trackTelemetry('followups.loaded_into_editor', { plan: billing.plan });
    preserveDraftForUndo('follow-up');
    setRaw(suggestion.prompt);
    setSaveTitle(suggestion.title);
    notify('Follow-up loaded into editor.');
  };
  const handleCaptureContext = async () => {
    try {
      const response = await captureContext();
      if (!response?.ok || !response.capture) {
        notify(response?.reason || 'Nothing captured from the page.');
        return;
      }
      const value = response.capture.selection || response.capture.title || '';
      const { matches } = scanSensitiveData({ prompt: value });
      if (matches.length > 0) {
        notify('Capture blocked: sensitive data detected in the page selection.');
        return;
      }
      const insertion = buildCaptureInsertion(response.capture, raw, extractVars(raw));
      if (!insertion) {
        notify('Nothing captured from the page.');
        return;
      }
      if (insertion.type === 'var') {
        setVarVals((prev) => ({ ...prev, [insertion.name]: insertion.value }));
        setShowVarForm(true);
        notify(`Filled {{${insertion.name}}} from the page.`);
      } else {
        setRaw(raw + insertion.block);
        notify('Page context appended to the prompt.');
      }
    } catch (caught) {
      notify(caught?.message || 'Capture failed.');
    }
  };
  const saveComposerChain = (blocks) => {
    const steps = (Array.isArray(blocks) ? blocks : [])
      .filter((block) => (block?.content || '').trim())
      .map((block) => ({ label: block.label || 'Step', template: block.content }));
    if (steps.length === 0) {
      notify('Add composer blocks with content before saving a chain.');
      return null;
    }
    const title = `Chain: ${steps[0].label}${steps.length > 1 ? ` +${steps.length - 1}` : ''}`;
    const entry = createPromptEntry({
      title,
      original: steps.map((step) => `# ${step.label}\n${step.template}`).join('\n\n---\n\n'),
      enhanced: '',
      tags: ['chain'],
      metadata: { chain: { version: 1, steps } },
    });
    lib.setLibrary((prev) => [entry, ...prev]);
    notify(`Saved ${steps.length}-step chain to the library.`);
    return entry;
  };
  const handleChainFollowUp = (suggestion) => {
    trackTelemetry('composer.block_added', {
      source: 'follow-up',
      plan: billing.plan,
    });
    addToComposer({ title: suggestion.title, enhanced: suggestion.prompt });
  };
  const quickSave = (candidate = null) => {
    const trackedCollection = (saveFlowOverrides.collectionOverride ?? saveCollection ?? '').trim();
    const candidateOverrides = candidate?.content
      ? {
          enhancedOverride: candidate.content,
          resultMetaOverride: {
            ...(resultMeta || {}),
            selectedCandidateId: candidate.id,
          },
        }
      : {};
    const saved = persistenceFlow.doSave(executionFlow.refreshEvalRuns, {
      titleOverride: suggestedSaveTitle,
      ...candidateOverrides,
      ...saveFlowOverrides,
    });
    if (saved?.id) {
      trackTelemetry('library.prompt_saved', {
        plan: billing.plan,
        via: 'inline',
        isVersion: Boolean(saveTargetId || editingId) && saved.savedAsNew !== true,
        hasCollection: Boolean(trackedCollection),
      });
    }
    return saved;
  };
  const quickSaveAsNew = (candidate = null) => {
    const trackedCollection = (saveFlowOverrides.collectionOverride ?? saveCollection ?? '').trim();
    const candidateOverrides = candidate?.content
      ? {
          enhancedOverride: candidate.content,
          resultMetaOverride: {
            ...(resultMeta || {}),
            selectedCandidateId: candidate.id,
          },
        }
      : {};
    const saved = persistenceFlow.doSave(executionFlow.refreshEvalRuns, {
      titleOverride: suggestedSaveTitle,
      targetId: null,
      copyAsNew: true,
      ...candidateOverrides,
      ...saveFlowOverrides,
    });
    if (saved?.id) {
      trackTelemetry('library.prompt_saved', {
        plan: billing.plan,
        via: 'result-save-as-new',
        isVersion: false,
        hasCollection: Boolean(trackedCollection),
      });
    }
    return saved;
  };
  const dismissEnhancedResult = () => {
    preserveDraftForUndo('discard-result');
    setEnhanced('');
    setVariants([]);
    setNotes('');
    setResultMeta(null);
    notify('Result discarded. Restore is available from the recovery banner.');
  };
  const handleCandidateSelection = (candidate, meta) => {
    const runId = meta?.runId || resultMeta?.runId;
    if (!runId || !candidate?.id) return;
    void updateEvalRun?.(runId, {
      selectedCandidateId: candidate.id,
      output: candidate.content,
      candidates: meta?.candidates || resultMeta?.candidates,
    });
  };
  const autosaveDualDraft = async ({ raw: draftRaw, title }) => {
    try {
      const acknowledged = await sessionSet({
        'pl2-dual-draft': { raw: draftRaw, title, updatedAt: new Date().toISOString() },
      });
      return acknowledged !== false;
    } catch {
      return false;
    }
  };
  const saveDualDraft = ({ raw: draftRaw, title }, asVersion = false) => persistenceFlow.doSave(
    executionFlow.refreshEvalRuns,
    {
      titleOverride: title || suggestedSaveTitle,
      rawOverride: draftRaw,
      enhancedOverride: draftRaw,
      targetId: asVersion ? editingId : null,
      copyAsNew: !asVersion,
      ...saveFlowOverrides,
    },
  );
  const sendScratchToEditor = (payload) => {
    if (raw.trim() || enhanced.trim() || editingId) preserveDraftForUndo('scratch-handoff');
    clearEditor();
    setRaw(payload.content || '');
    setSaveTitle(payload.title || suggestTitleFromText(payload.content || ''));
    setSaveTags(Array.isArray(payload.tags) ? payload.tags : []);
    setSourceNoteId(payload.sourceNoteId || '');
    openCreateView('editor');
    notify(payload.selectionOnly ? 'Scratch selection opened in Write.' : 'Scratch note opened in Write.');
  };
  const sendScratchToComposer = (payload) => {
    handleAddToComposer({
      id: payload.sourceNoteId,
      title: payload.title,
      enhanced: payload.content,
      original: payload.content,
    });
    openCreateView('composer');
  };
  const sendScratchToABTest = (payload) => {
    if (!canUseAbTesting) {
      openBilling('abTesting');
      return;
    }
    abTest.loadVariant('a', payload.content, {
      entryId: payload.linkedPromptId || payload.sourceNoteId,
      title: payload.title,
    });
    openRunsViewWithBilling('compare');
    notify('Scratch content loaded into A/B Variant A.');
  };
  const promoteScratchToLibrary = (title, content, options = {}) => lib.doSave({
    raw: content,
    enhanced: content,
    variants: [],
    notes: '',
    resultMeta: null,
    tags: Array.isArray(options.tags) ? options.tags : [],
    title,
    collection: canUseCollections ? (options.collection || '') : '',
    editingId: null,
    changeNote: 'Promoted from Scratch',
    sourceEntry: null,
    sourceNoteId: options.sourceNoteId || '',
    kind: options.kind === 'template' ? 'template' : 'prompt',
    metadata: {
      type: options.kind === 'template' ? 'template' : 'working-prompt',
      sourceSurface: 'scratch',
      sourceNoteName: options.sourceNoteName || '',
    },
    copyAsNew: true,
  });
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
    save: () => { if (canSavePanel) quickSave(); closePalette(); },
    saveLabel: primarySaveLabel,
    newPrompt: () => { requestDraftReset('new'); closePalette(); },
    clear: () => { requestDraftReset(); closePalette(); },
    goEditor: () => { openSection('create'); closePalette(); },
    goLibrary: () => { openSection('library'); closePalette(); },
    goBuild: () => { openCreateView('composer'); closePalette(); },
    goSplit: () => { openCreateView('split'); closePalette(); },
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
        ref={appShellRef}
        data-theme={colorMode}
        className={`pl-app-shell ${compact ? 'is-compact' : ''} ${isExtension ? 'h-screen overflow-y-auto' : 'min-h-screen'} ${m.bg} ${m.text} flex flex-col pl-density-${density}`}
        style={{ fontFamily: 'system-ui,sans-serif' }}
      >
      <h1 className="sr-only">Prompt Lab</h1>
      <a className="pl-skip-link" href="#prompt-lab-main">Skip to workspace</a>

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
        billingDisabled={billing.billingDisabled}
        openBilling={openBilling}
        clerkUserButton={clerkUser ? clerkUserButton : null}
        settingsButtonRef={settingsButtonRef}
        renderMobileNavigation={false}
      />

      <PendingWritesNotice m={m} />

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
                className="ui-control rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-500"
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

      <main id="prompt-lab-main" tabIndex={-1} className={`pl-tab-panel flex-1 flex flex-col ${pageScroll ? '' : 'overflow-hidden'}`}>
      {/* ══ EDITOR TAB ══ */}
      {tab === 'editor' && (
        <MainWorkspace
          m={m}
          compact={compact}
          pageScroll={pageScroll}
          libraryIsWorkspace={libraryOnlyMode}
          showEditorPane={showEditorPane}
          showLibraryPane={showLibraryPane}
          editorPane={(
            workspaceView === 'split' ? <DualPaneWorkspace
              library={lib.library}
              raw={raw}
              setRaw={setRaw}
              notify={notify}
              copy={copy}
              draftTitle={saveTitle}
              onDraftTitleChange={setSaveTitle}
              onAutosave={autosaveDualDraft}
              onEnhance={({ title }) => {
                setSaveTitle(title || suggestedSaveTitle);
                handleEnhanceRequest();
              }}
              onSave={(payload) => saveDualDraft(payload, false)}
              onSaveVersion={editingId ? (payload) => saveDualDraft(payload, true) : undefined}
              enhancing={loading}
              mobilePane={splitMobilePane}
              onMobilePaneChange={setSplitMobilePane}
              openEntry={(entry) => handleLoadEntry(entry, 'create')}
            /> : <CreateEditorPane
              m={m}
              compact={compact}
              pageScroll={pageScroll}
              onCaptureContext={isExtension ? handleCaptureContext : undefined}
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
              enhance={handleEnhanceRequest} runAllCases={handleRunCases} clearEditor={requestDraftReset} cancelEnhance={cancelEnhance}
              loading={loading} runningCases={runningCases} batchProgress={batchProgress}
              currentTestCases={currentTestCases} hasSavablePrompt={hasSavablePrompt} primaryModKey={primaryModKey}
              streaming={streaming} optimisticSaveVisible={optimisticSaveVisible} showSave={showSave}
              error={error} openOptions={openOptions}
              enhanced={enhanced} setEnhanced={setEnhanced}
              resultMeta={resultMeta} setResultMeta={setResultMeta}
              enhMdPreview={enhMdPreview} setEnhMdPreview={setEnhMdPreview}
              resultTab={resultTab} setResultTab={setResultTab}
              resultTabs={resultTabs} activeResultTab={activeResultTab} copyBtn={copyBtn}
              showInlineSaveBar={showInlineSaveBar}
              saveTitle={saveTitle} setSaveTitle={setSaveTitle} quickSave={quickSave}
              quickSaveAsNew={quickSaveAsNew} dismissResult={dismissEnhancedResult}
              newPrompt={() => requestDraftReset('new')}
              onCandidateSelection={handleCandidateSelection}
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
              followUps={followUpSuggestions.followUps}
              followUpsLoading={followUpSuggestions.followUpsLoading}
              followUpsError={followUpSuggestions.followUpsError}
              fetchFollowUps={followUpSuggestions.fetchFollowUps}
              onUseFollowUp={handleUseFollowUp}
              onChainFollowUp={handleChainFollowUp}
            />
          )}
          libraryPane={(
            libraryOnlyMode ? <LibraryWorkspace
              m={m}
              lib={lib}
              loadEntry={handleLoadEntry}
              copy={copy}
              addToComposer={handleAddToComposer}
              sendToABTest={(entry) => handleSendToABTest(entry, 'a')}
              openSavePanel={openSavePanel}
              onNewPrompt={() => requestDraftReset('new')}
              onOpenScratchSource={(noteId) => {
                setScratchOpenNoteId(noteId);
                setPrimaryView('notebook');
              }}
              canUseCollections={canUseCollections}
              canExportLibrary={canExportLibrary}
              canImportLibrary={canImportLibrary}
              canUsePacks={canUsePacks}
              openBilling={openBilling}
              compact={compact}
            /> : <LibraryPanel
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
              loadEntry={handleLoadEntry} deleteEntry={deleteEntry} addToComposer={handleAddToComposer}
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
          addToComposer={addToComposer} notify={notify} copy={copy} setRaw={setRaw} setTab={setTab} saveChain={saveComposerChain} compact={compact} pageScroll={pageScroll} />
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
              ? <ABTestTab m={m} copy={copy} compact={compact} pageScroll={pageScroll} pinGoldenResponse={lib.pinGoldenResponse} {...abTest} />
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
                        className="ui-control mt-4 rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-500"
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

      {/* ══ SCRATCH TAB ══ */}
      {tab === 'pad' && (
        <div className="pl-tab-panel">
          <PadTab
            m={m}
            colorMode={colorMode}
            notify={notify}
            pageScroll={pageScroll}
            library={lib.library}
            collections={lib.collections}
            openNoteId={scratchOpenNoteId}
            onOpenLibraryEntry={(entry) => entry && handleLoadEntry(entry, 'scratch')}
            onPromoteToLibrary={promoteScratchToLibrary}
            onSendToEditor={sendScratchToEditor}
            onSendToComposer={sendScratchToComposer}
            onSendToABTest={sendScratchToABTest}
          />
        </div>
      )}
      </main>

      {compact && (
        <MobileNavigation
          primaryView={primaryView}
          workspaceView={workspaceView}
          openCreateView={openCreateView}
          openSection={openSection}
          setPrimaryView={setPrimaryView}
        />
      )}

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
                isVersion: Boolean(saveTargetId) && saved.savedAsNew !== true,
                hasCollection: Boolean(trackedCollection),
              });
            }
            return saved;
          }}
          doSaveAsNew={() => quickSaveAsNew()}
          closeSavePanel={closeSavePanel} canSavePanel={canSavePanel}
          canUseCollections={canUseCollections}
          onRequestCollectionsUpgrade={() => openBilling('collections')}
        />
      )}

      {lastSaveReceipt && (
        <section className={`pl-save-receipt mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${m.surface} ${m.border}`} aria-labelledby="save-receipt-title">
          <div>
            <p id="save-receipt-title" className={`text-sm font-semibold ${m.text}`} role="status" aria-live="polite">
              Saved “{lastSaveReceipt.title}” · version {lastSaveReceipt.versionNumber}
            </p>
            <p className={`mt-0.5 text-xs ${m.textMuted}`}>The editor remains linked to this library entry.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => openCreateView('library')} className="pl-secondary-button">View in Library</button>
            <button
              type="button"
              onClick={() => {
                dismissSaveReceipt();
                requestDraftReset('new');
              }}
              className="pl-primary-button"
            >
              New prompt
            </button>
            <button type="button" onClick={dismissSaveReceipt} className="pl-icon-button" aria-label="Dismiss save receipt"><Ic n="X" size={14} /></button>
          </div>
        </section>
      )}

      {draftRecovery && (
        <div className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${m.surface} ${m.border}`} role="status">
          <span className={m.textSub}>{recoveryDescription}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={undoDraftReset}
              className="ui-control rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-orange-500"
            >
              {recoveryActionLabel}
            </button>
            <button
              type="button"
              onClick={dismissDraftRecovery}
              className={`ui-control rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/[0.06] ${m.textSub}`}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ══ MODALS ══ */}
      {showResetDraftConfirmation && (
        <div
          className={`fixed inset-0 z-[80] flex items-center justify-center p-4 ${m.modalBg}`}
          onClick={() => setShowResetDraftConfirmation(false)}
        >
          <div
            ref={resetDialogRef}
            className={`pl-modal-panel w-full max-w-md rounded-2xl border p-5 shadow-2xl ${m.modal} ${m.border} ${m.text}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-draft-title"
            aria-describedby="reset-draft-description"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="reset-draft-title" className="text-lg font-semibold">{pendingResetIntent === 'new' ? 'Start a new prompt?' : 'Reset this draft?'}</h2>
            <p id="reset-draft-description" className={`mt-2 text-sm leading-relaxed ${m.textMuted}`}>
              Your prompt, generated results, notes, and unsaved save details will move to session recovery before the editor is cleared.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={resetCancelRef}
                type="button"
                onClick={() => setShowResetDraftConfirmation(false)}
                className={`ui-control rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.06] ${m.textSub}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDraftReset}
                className="ui-control rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
              >
                {pendingResetIntent === 'new' ? 'Start new prompt' : 'Reset draft'}
              </button>
            </div>
          </div>
        </div>
      )}

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
          pendingImport={lib.pendingImport} retryImport={lib.retryImport}
          openOptions={openOptions} onClose={() => setShowSettings(false)}
          billing={billing}
          openBilling={(featureId) => {
            setBillingReturnToSettings(true);
            setShowSettings(false);
            openBilling(featureId);
          }}
          canUseCollections={canUseCollections}
          canExportLibrary={canExportLibrary}
          telemetry={telemetry}
          returnFocusRef={settingsButtonRef}
        />
      )}

      {showCmdPalette && (
        <CommandPaletteModal
          m={m} cmdQuery={cmdQuery} setCmdQuery={setCmdQuery}
          filteredCmds={filteredCmds} onClose={() => setShowCmdPalette(false)}
        />
      )}

      {showShortcuts && (
        <ShortcutsModal m={m} primaryModKey={primaryModKey} saveLabel={primarySaveLabel} onClose={() => setShowShortcuts(false)} />
      )}

      {showBillingModal && (
        <BillingModal
          m={m}
          billing={billing}
          requestedFeature={billingFeaturePrompt}
          requestedPeriod={requestedBillingPeriod}
          requestedSource={requestedBillingSource}
          onClose={closeBilling}
        />
      )}

      <VersionDiffModal
        entry={versionHistoryEntry}
        selectedIndex={lib.diffVersionIdx}
        onSelectIndex={lib.setDiffVersionIdx}
        onClose={lib.closeVersionHistory}
        onRestore={(version) => restoreEntryVersion(versionHistoryEntry?.id, version)}
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
