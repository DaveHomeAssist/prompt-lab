import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();

  return {
    useUiState: vi.fn(() => ({
      viewportWidth: 1280,
      viewportHeight: 800,
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
      trackRecentAccess: fn(),
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
      pinGoldenResponse: fn(),
      clearGoldenResponse: fn(),
      setGoldenThreshold: fn(),
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
      setVariants: fn(),
      notes: '',
      setNotes: fn(),
      enhMode: 'balanced',
      setEnhMode: fn(),
      showNotes: false,
      setShowNotes: fn(),
      editorLayout: 'editor',
      setEditorLayout: fn(),
      composerBlocks: [],
      setComposerBlocks: fn(),
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

vi.mock('../hooks/useUiState.js', () => ({
  default: mocks.useUiState,
}));

vi.mock('../hooks/usePromptLibrary.js', () => ({
  default: mocks.useLibrary,
}));

vi.mock('../hooks/useABTest.js', () => ({
  default: mocks.useABTest,
}));

vi.mock('../hooks/useEditorState.js', () => ({
  default: mocks.useEditorState,
}));

vi.mock('../hooks/usePersistenceFlow.js', () => ({
  default: mocks.usePersistenceFlow,
}));

vi.mock('../hooks/useExecutionFlow.js', () => ({
  default: mocks.useExecutionFlow,
}));

vi.mock('../hooks/useNavigation.js', () => ({
  default: mocks.useNavigation,
}));

vi.mock('../lib/platform.js', () => ({
  isExtension: false,
}));

vi.mock('../lib/navigationRegistry.js', () => ({
  matchShortcut: vi.fn(() => null),
  buildCommandActions: vi.fn(() => []),
  filterCommands: vi.fn(() => []),
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
  default: ({ editorPane, libraryPane, showEditorPane, showLibraryPane }) => (
    <div data-testid="main-workspace">
      {showEditorPane ? editorPane : null}
      {showLibraryPane ? libraryPane : null}
    </div>
  ),
}));

vi.mock('../EditorActions.jsx', () => ({
  default: () => <div data-testid="editor-actions" />,
}));

vi.mock('../MarkdownPreview.jsx', () => ({
  default: () => <div data-testid="markdown-preview" />,
}));

vi.mock('../LibraryPanel.jsx', () => ({
  default: () => <div data-testid="library-panel" />,
}));

vi.mock('../ComposerTab.jsx', () => ({
  default: () => <div data-testid="composer-tab" />,
}));

vi.mock('../ABTestTab.jsx', () => ({
  default: () => <div data-testid="abtest-tab" />,
}));

vi.mock('../PadTab.jsx', () => ({
  default: () => <div data-testid="pad-tab" />,
}));

vi.mock('../RunTimelinePanel.jsx', () => ({
  default: () => <div data-testid="run-timeline" />,
}));

vi.mock('../SavePanel.jsx', () => ({
  default: () => <div data-testid="save-panel" />,
}));

vi.mock('../VersionDiffModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../DesktopSettingsModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../Toast.jsx', () => ({
  default: () => null,
}));

vi.mock('../modals/TemplateVariablesModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../modals/SettingsModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../modals/CommandPaletteModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../modals/ShortcutsModal.jsx', () => ({
  default: () => null,
}));

vi.mock('../modals/PiiWarningModal.jsx', () => ({
  default: () => null,
}));

import App from '../App.jsx';

function useDefaultMock(name) {
  const mock = mocks[name];
  return mock.getMockImplementation()();
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the editor shell without reading navigation state before initialization', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Prompt Lab' })).toBeInTheDocument();
    expect(mocks.useNavigation).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('app-header')).toBeInTheDocument();
  });

  it('shows the draft context before the first enhance run', () => {
    mocks.useEditorState.mockReturnValueOnce({
      ...useDefaultMock('useEditorState'),
      raw: 'Draft a support reply for a delayed shipment.',
    });

    render(<App />);

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Draft a support reply for a delayed shipment.')).toBeInTheDocument();
    expect(screen.getByTestId('editor-actions')).toBeInTheDocument();
    expect(screen.queryByText('Results')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Prompt title')).not.toBeInTheDocument();
  });

  it('shows the inline save bar next to generated results in Create mode', () => {
    mocks.useEditorState.mockReturnValueOnce({
      ...useDefaultMock('useEditorState'),
      raw: 'Turn this into a tighter prompt.',
      enhanced: 'Rewritten prompt with stronger constraints.',
      hasSavablePrompt: true,
    });
    mocks.usePersistenceFlow.mockReturnValueOnce({
      ...useDefaultMock('usePersistenceFlow'),
      saveTitle: 'Support rewrite',
    });

    render(<App />);

    expect(screen.getByText('Results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(screen.getByLabelText('Prompt title')).toBeInTheDocument();
  });
});
