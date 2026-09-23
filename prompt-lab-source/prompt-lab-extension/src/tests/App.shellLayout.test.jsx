import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase 0 guardrail for docs/VIEWPORT_SHELL_OVERHAUL_PLAN.md.
//
// `tests/app/layout-invariant.spec.js` in prompt-lab-web proves the *behaviour*
// of the hosted shell in a real browser, which is where layout can actually be
// measured. jsdom cannot lay anything out, so this file does the one job the
// browser suite cannot: it pins the shell's height contract for all three
// surfaces at once.
//
// Extension, desktop and hosted web all render the same `src/App.jsx`. Phase A
// changes the hosted web shell to a viewport-locked container and must leave
// the other two byte-identical, because a bad extension build waits on a Chrome
// Web Store re-review to undo. That makes this a deliberate change detector:
// when Phase A lands, update the `web` expectation *only*. If the extension or
// desktop expectation fails, the blast radius escaped its intended surface.

const platform = vi.hoisted(() => ({ isExtension: true }));

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    useUiState: vi.fn(() => ({
      viewportWidth: 1280,
      viewportHeight: 900,
      colorMode: 'dark',
      setColorMode: fn(),
      density: 'comfortable',
      setDensity: fn(),
      primaryView: 'create',
      setPrimaryView: fn(),
      workspaceView: 'editor',
      setWorkspaceView: fn(),
      runsView: 'history',
      setRunsView: fn(),
      tab: 'editor',
      setTab: fn(),
      toast: null,
      setToast: fn(),
      notify: fn(),
      showSettings: false,
      setShowSettings: fn(),
      showCmdPalette: false,
      setShowCmdPalette: fn(),
      showShortcuts: false,
      setShowShortcuts: fn(),
      cmdQuery: '',
      setCmdQuery: fn(),
    })),
    useLibrary: vi.fn(() => ({
      library: [],
      collections: [],
      quickInject: [],
      recentPrompts: [],
      expandedVersionId: null,
      diffVersionIdx: null,
      setCollections: fn(),
      deleteCollection: fn(),
      exportLib: fn(),
      importLib: fn(),
      clearLibrary: fn(),
      setShareId: fn(),
      closeVersionHistory: fn(),
      setDiffVersionIdx: fn(),
      restoreVersion: fn(),
      bumpUse: fn(),
    })),
    useABTest: vi.fn(() => ({ loadVariant: fn() })),
    useEditorState: vi.fn(() => ({
      raw: '',
      setRaw: fn(),
      enhanced: '',
      setEnhanced: fn(),
      variants: [],
      notes: '',
      enhMode: 'balanced',
      setEnhMode: fn(),
      showNotes: false,
      setShowNotes: fn(),
      editorLayout: 'editor',
      setEditorLayout: fn(),
      composerBlocks: [],
      setComposerBlocks: fn(),
      cursor: { start: 0, end: 0 },
      updateCursor: fn(),
      lintIssues: [],
      lintOpen: false,
      setLintOpen: fn(),
      handleLintFix: fn(),
      hasSavablePrompt: false,
      clearEditorState: fn(),
    })),
    usePersistenceFlow: vi.fn(() => ({
      showSave: false,
      setShowSave: fn(),
      editingId: null,
      setEditingId: fn(),
      saveTargetId: null,
      hasPanelSaveSource: false,
      saveTitle: '',
      setSaveTitle: fn(),
      saveTags: [],
      setSaveTags: fn(),
      saveCollection: '',
      setSaveCollection: fn(),
      changeNote: '',
      setChangeNote: fn(),
      setShowDiff: fn(),
      testCasesByPrompt: {},
      caseFormPromptId: null,
      editingCaseId: null,
      caseTitle: '',
      setCaseTitle: fn(),
      caseInput: '',
      setCaseInput: fn(),
      caseTraits: '',
      setCaseTraits: fn(),
      caseExclusions: '',
      setCaseExclusions: fn(),
      caseNotes: '',
      setCaseNotes: fn(),
      openCaseForm: fn(),
      resetCaseForm: fn(),
      saveCaseForPrompt: fn(),
      removeCase: fn(),
      loadCaseIntoEditor: fn(),
      showNewColl: false,
      setShowNewColl: fn(),
      newCollName: '',
      setNewCollName: fn(),
      varVals: {},
      setVarVals: fn(),
      showVarForm: false,
      setShowVarForm: fn(),
      pendingTemplate: null,
      applyTemplate: fn(),
      skipTemplate: fn(),
      doSave: fn(),
      closeSavePanel: fn(),
      openSavePanel: fn(),
      loadEntry: fn(),
      sendEntryToABTest: fn(),
      addToComposer: fn(),
      currentTestCases: [],
      clearPersistenceState: fn(),
    })),
    useExecutionFlow: vi.fn(() => ({
      loading: false,
      error: null,
      streamPreview: '',
      streaming: false,
      optimisticSaveVisible: false,
      batchProgress: { active: false, completed: 0, total: 0, currentLabel: '' },
      piiWarning: null,
      piiSendAnyway: fn(),
      piiRedactAndSend: fn(),
      piiCancel: fn(),
      evalRuns: [],
      showEvalHistory: false,
      setShowEvalHistory: fn(),
      runningCases: false,
      runSingleCase: fn(),
      runAllCases: fn(),
      enhance: fn(),
      enhanceWithMode: fn(),
      openOptions: fn(),
      copy: fn(),
      cancelEnhance: fn(),
      refreshEvalRuns: fn(),
      clearExecutionState: fn(),
    })),
    useNavigation: vi.fn(() => ({
      activeSection: 'create',
      openCreateView: fn(),
      openSection: fn(),
      openRunsView: fn(),
    })),
  };
});

vi.mock('../hooks/useUiState.js', () => ({ default: mocks.useUiState }));
vi.mock('../hooks/usePromptLibrary.js', () => ({ default: mocks.useLibrary }));
vi.mock('../hooks/useABTest.js', () => ({ default: mocks.useABTest }));
vi.mock('../hooks/useEditorState.js', () => ({ default: mocks.useEditorState }));
vi.mock('../hooks/usePersistenceFlow.js', () => ({ default: mocks.usePersistenceFlow }));
vi.mock('../hooks/useExecutionFlow.js', () => ({ default: mocks.useExecutionFlow }));
vi.mock('../hooks/useNavigation.js', () => ({ default: mocks.useNavigation }));

// A getter keeps one module mock while letting each case pick its surface.
vi.mock('../lib/platform.js', () => ({
  get isExtension() {
    return platform.isExtension;
  },
}));

vi.mock('../lib/navigationRegistry.js', () => ({
  matchShortcut: vi.fn(() => null),
  buildCommandActions: vi.fn(() => []),
  filterCommands: vi.fn(() => []),
  resolveRouteState: vi.fn(() => null),
  stateToRoute: vi.fn(() => '/'),
}));

vi.mock('../theme/ThemeProvider.jsx', () => ({
  ThemeProvider: ({ children }) => <>{children}</>,
}));

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../AppHeader.jsx', () => ({ default: () => <div data-testid="app-header" /> }));
vi.mock('../MainWorkspace.jsx', () => ({ default: () => <div data-testid="main-workspace" /> }));
vi.mock('../CreateEditorPane.jsx', () => ({ default: () => <div data-testid="create-editor-pane" /> }));
vi.mock('../LibraryPanel.jsx', () => ({ default: () => null }));
vi.mock('../ComposerTab.jsx', () => ({ default: () => null }));
vi.mock('../ABTestTab.jsx', () => ({ default: () => null }));
vi.mock('../PadTab.jsx', () => ({ default: () => null }));
vi.mock('../RunTimelinePanel.jsx', () => ({ default: () => null }));
vi.mock('../SavePanel.jsx', () => ({ default: () => null }));
vi.mock('../VersionDiffModal.jsx', () => ({ default: () => null }));
vi.mock('../DesktopSettingsModal.jsx', () => ({ default: () => null }));
vi.mock('../Toast.jsx', () => ({ default: () => null }));
vi.mock('../modals/TemplateVariablesModal.jsx', () => ({ default: () => null }));
vi.mock('../modals/SettingsModal.jsx', () => ({ default: () => null }));
vi.mock('../modals/CommandPaletteModal.jsx', () => ({ default: () => null }));
vi.mock('../modals/ShortcutsModal.jsx', () => ({ default: () => null }));
vi.mock('../modals/PiiWarningModal.jsx', () => ({ default: () => null }));

import App from '../App.jsx';

function renderShell({ isExtension, webMode }) {
  platform.isExtension = isExtension;
  if (webMode) vi.stubEnv('VITE_WEB_MODE', 'true');
  const { container } = render(<MemoryRouter><App /></MemoryRouter>);
  return container.querySelector('.pl-app-shell');
}

describe('app shell height contract per surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platform.isExtension = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('gives the extension shell a bounded viewport height', () => {
    const shell = renderShell({ isExtension: true, webMode: false });

    // The extension already bounds its shell; Phase A must not disturb this.
    expect(shell).toHaveClass('h-screen');
    expect(shell).toHaveClass('overflow-y-auto');
    expect(shell.className).not.toContain('min-h-screen');
  });

  it('leaves the desktop shell on the unbounded document flow', () => {
    const shell = renderShell({ isExtension: false, webMode: false });

    // Desktop is out of scope until hosted web has been proven in production.
    expect(shell).toHaveClass('min-h-screen');
  });

  it('binds the hosted web shell to the viewport', () => {
    const shell = renderShell({ isExtension: false, webMode: true });

    // Phase A1. `min-h-screen` was a height floor, not a ceiling, so every
    // min-h-0 and overflow-hidden beneath it was inert — a flex child cannot
    // clamp against an unbounded parent. `.pl-shell-contained` supplies the
    // ceiling, mirroring the `.is-compact` rule that already worked on mobile.
    // The behavioural proof is prompt-lab-web/tests/app/layout-invariant.spec.js.
    expect(shell).toHaveClass('pl-shell-contained');
    expect(shell).not.toHaveClass('min-h-screen');
    // Token matching, not substring: "min-h-screen" contains "h-screen".
    expect(shell).not.toHaveClass('h-screen');
  });
});

describe('shell layout harness', () => {
  it('actually varies the surface between cases', () => {
    // Guards the getter-based platform mock: if it ever stopped switching, all
    // three cases above would silently assert the same surface.
    const extensionShell = renderShell({ isExtension: true, webMode: false });
    const extensionClass = extensionShell.className;
    const webShell = renderShell({ isExtension: false, webMode: true });

    expect(webShell.className).not.toEqual(extensionClass);
  });
});
