import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();

  return {
    useUiState: vi.fn(() => ({
      viewportWidth: 420,
      viewportHeight: 640,
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
    useABTest: vi.fn(() => ({
      loadVariant: fn(),
    })),
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

vi.mock('../lib/platform.js', () => ({
  isExtension: true,
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

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

vi.mock('../AppHeader.jsx', () => ({
  default: () => <div data-testid="app-header" />,
}));

vi.mock('../MainWorkspace.jsx', () => ({
  default: ({ pageScroll, editorPane, libraryPane }) => (
    <div data-testid="main-workspace" data-pagescroll={String(pageScroll)}>
      {editorPane}
      {libraryPane}
    </div>
  ),
}));

vi.mock('../CreateEditorPane.jsx', () => ({
  default: ({ pageScroll }) => <div data-testid="create-editor-pane" data-pagescroll={String(pageScroll)} />,
}));

vi.mock('../LibraryPanel.jsx', () => ({
  default: () => <div data-testid="library-panel" />,
}));

vi.mock('../ComposerTab.jsx', () => ({
  default: ({ pageScroll }) => <div data-testid="composer-tab" data-pagescroll={String(pageScroll)} />,
}));

vi.mock('../ABTestTab.jsx', () => ({
  default: ({ pageScroll }) => <div data-testid="abtest-tab" data-pagescroll={String(pageScroll)} />,
}));

vi.mock('../PadTab.jsx', () => ({
  default: ({ pageScroll }) => <div data-testid="pad-tab" data-pagescroll={String(pageScroll)} />,
}));

vi.mock('../RunTimelinePanel.jsx', () => ({
  default: ({ pageScroll }) => <div data-testid="run-timeline" data-pagescroll={String(pageScroll)} />,
}));

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

describe('App extension scroll mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses page scroll layout for the extension shell', () => {
    const { container } = render(<MemoryRouter><App /></MemoryRouter>);

    const shell = container.querySelector('[data-theme="dark"]');
    expect(shell).toHaveClass('h-screen');
    expect(shell).toHaveClass('overflow-y-auto');
    expect(screen.getByTestId('main-workspace')).toHaveAttribute('data-pagescroll', 'true');
    expect(screen.getByTestId('create-editor-pane')).toHaveAttribute('data-pagescroll', 'true');
    expect(screen.getByRole('tabpanel', { name: 'editor' }).className).not.toContain('overflow-hidden');
  });
});
