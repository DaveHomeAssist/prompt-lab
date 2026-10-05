import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Guards the wiring in App.jsx, which is where "Batch test-case runs" lost its
// only way to create a case: LibraryPanel (the one component with an Add Case
// control) is never mounted, so the Library workspace has to carry it. Unlike
// LibraryWorkspace.test.jsx this mounts the real App, MainWorkspace,
// LibraryWorkspace and TestCasesPanel, so it fails if App stops handing the
// workspace the case state and handlers, or stops rendering the workspace.
//
// Hook mocks follow the shapes in App.test.jsx.

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  const alpha = {
    id: 'alpha', title: 'Alpha prompt', original: 'Summarize the incident report.',
    enhanced: 'Summarize the incident report in five bullet points.', favorite: false, collection: '', tags: [],
    useCount: 0, updatedAt: '2026-08-19T00:00:00Z', createdAt: '2026-08-19T00:00:00Z',
    metadata: { purpose: '', status: '', compatibility: [] }, versions: [], inputs: [], variants: [], testCases: [],
  };
  const defaults = {
    useUiState: () => ({
      viewportWidth: 1280, viewportHeight: 800, colorMode: 'dark', setColorMode: fn(),
      density: 'comfortable', setDensity: fn(),
      primaryView: 'create', setPrimaryView: fn(), workspaceView: 'library', setWorkspaceView: fn(),
      runsView: 'history', setRunsView: fn(), tab: 'editor', setTab: fn(),
      toast: null, setToast: fn(), notify: fn(),
      showSettings: false, setShowSettings: fn(), showCmdPalette: false, setShowCmdPalette: fn(),
      showShortcuts: false, setShowShortcuts: fn(), cmdQuery: '', setCmdQuery: fn(),
    }),
    useLibrary: () => ({
      library: [alpha], trash: [], collections: [], allLibTags: [], quickInject: [], recentPrompts: [],
      search: '', setSearch: fn(), sortBy: 'newest', setSortBy: fn(),
      activeCollection: null, setActiveCollection: fn(), activeTag: null, setActiveTag: fn(),
      trackRecentAccess: fn(), expandedVersionId: null, diffVersionIdx: null,
      setCollections: fn(), deleteCollection: fn(), exportLib: fn(), importLib: fn(), clearLibrary: fn(),
      setShareId: fn(), closeVersionHistory: fn(), setDiffVersionIdx: fn(), restoreVersion: fn(), bumpUse: fn(),
      pinGoldenResponse: fn(), clearGoldenResponse: fn(), setGoldenThreshold: fn(),
      updateEntries: fn(), moveEntriesToCollection: fn(), addTagToEntries: fn(), deleteEntries: fn(),
      restoreDeleted: fn(), permanentlyDelete: fn(), setFavorite: fn(), duplicateEntry: fn(), del: fn(),
    }),
    useABTest: () => ({ loadVariant: fn() }),
    useEditorState: () => ({
      raw: '', setRaw: fn(), enhanced: '', setEnhanced: fn(), variants: [], setVariants: fn(),
      notes: '', setNotes: fn(), enhMode: 'balanced', setEnhMode: fn(), showNotes: false, setShowNotes: fn(),
      editorLayout: 'editor', setEditorLayout: fn(), composerBlocks: [], setComposerBlocks: fn(),
      cursor: { start: 0, end: 0 }, updateCursor: fn(), lintIssues: [], lintOpen: false, setLintOpen: fn(),
      handleLintFix: fn(), hasSavablePrompt: false, clearEditorState: fn(),
    }),
    usePersistenceFlow: () => ({
      showSave: false, setShowSave: fn(), editingId: null, setEditingId: fn(), saveTargetId: null,
      hasPanelSaveSource: false, saveTitle: '', setSaveTitle: fn(), saveTags: [], setSaveTags: fn(),
      saveCollection: '', setSaveCollection: fn(), changeNote: '', setChangeNote: fn(), setShowDiff: fn(),
      showNewColl: false, setShowNewColl: fn(), newCollName: '', setNewCollName: fn(),
      varVals: {}, setVarVals: fn(), showVarForm: false, setShowVarForm: fn(),
      pendingTemplate: null, applyTemplate: fn(), skipTemplate: fn(),
      doSave: fn(), closeSavePanel: fn(), openSavePanel: fn(), loadEntry: fn(), sendEntryToABTest: fn(),
      addToComposer: fn(), currentTestCases: [], clearPersistenceState: fn(),
    }),
    // Case state and handlers come from useExecutionFlow, as in the real hook.
    useExecutionFlow: () => ({
      loading: false, error: null, streamPreview: '', streaming: false, optimisticSaveVisible: false,
      batchProgress: { active: false, completed: 0, total: 0, currentLabel: '' },
      piiWarning: null, piiSendAnyway: fn(), piiRedactAndSend: fn(), piiCancel: fn(),
      evalRuns: [], showEvalHistory: false, setShowEvalHistory: fn(),
      testCasesByPrompt: {}, caseFormPromptId: null, editingCaseId: null,
      caseTitle: '', setCaseTitle: fn(), caseInput: '', setCaseInput: fn(),
      caseTraits: '', setCaseTraits: fn(), caseExclusions: '', setCaseExclusions: fn(),
      caseNotes: '', setCaseNotes: fn(), runningCases: false,
      openCaseForm: fn(), resetCaseForm: fn(), saveCaseForPrompt: fn(), removeCase: fn(),
      loadCaseIntoEditor: fn(), runSingleCase: fn(), runAllCases: fn(),
      enhance: fn(), enhanceWithMode: fn(), openOptions: fn(), copy: fn(), cancelEnhance: fn(),
      refreshEvalRuns: fn(), clearExecutionState: fn(),
    }),
    useNavigation: () => ({
      activeSection: 'library', openCreateView: fn(), openSection: fn(), openRunsView: fn(),
    }),
  };
  const mocks = Object.fromEntries(Object.entries(defaults).map(([name, factory]) => [name, vi.fn(factory)]));
  return { ...mocks, defaults };
});

vi.mock('../hooks/useUiState.js', () => ({ default: mocks.useUiState }));
// LibraryWorkspace imports sortLibraryEntries from this module, so keep the real exports.
vi.mock('../hooks/usePromptLibrary.js', async (importOriginal) => ({
  ...(await importOriginal()),
  default: mocks.useLibrary,
}));
vi.mock('../hooks/useABTest.js', () => ({ default: mocks.useABTest }));
vi.mock('../hooks/useEditorState.js', () => ({ default: mocks.useEditorState }));
vi.mock('../hooks/usePersistenceFlow.js', () => ({ default: mocks.usePersistenceFlow }));
vi.mock('../hooks/useExecutionFlow.js', () => ({ default: mocks.useExecutionFlow }));
vi.mock('../hooks/useNavigation.js', () => ({ default: mocks.useNavigation }));
vi.mock('../lib/platform.js', () => ({ isExtension: false }));
vi.mock('../lib/navigationRegistry.js', () => ({
  matchShortcut: vi.fn(() => null),
  buildCommandActions: vi.fn(() => []),
  filterCommands: vi.fn(() => []),
  resolveRouteState: vi.fn(() => null),
  stateToRoute: vi.fn(() => '/'),
}));
vi.mock('../theme/ThemeProvider.jsx', () => ({ ThemeProvider: ({ children }) => <>{children}</> }));
vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../AppHeader.jsx', () => ({ default: () => <div data-testid="app-header" /> }));
vi.mock('../PackStudioPanel.jsx', () => ({ default: () => null }));
vi.mock('../EditorActions.jsx', () => ({ default: () => <div data-testid="editor-actions" /> }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: () => null }));
vi.mock('../LibraryPanel.jsx', () => ({ default: () => <div data-testid="library-panel" /> }));
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
vi.mock('../modals/BillingModal.jsx', () => ({ default: () => null }));

import App from '../App.jsx';

const savedCase = {
  id: 'case-1', promptId: 'alpha', title: 'Executive brevity', input: 'Summarize the Q3 outage report for the board.',
  expectedTraits: ['bullet points'], expectedExclusions: ['jargon'], notes: '',
};

function arrange(overrides = {}) {
  for (const [name, patch] of Object.entries(overrides)) {
    mocks[name].mockImplementation(() => ({ ...mocks.defaults[name](), ...patch }));
  }
  render(<MemoryRouter><App /></MemoryRouter>);
}

function openTestsTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Alpha prompt' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Tests' }));
  return screen.getByRole('region', { name: 'Test cases' });
}

describe('App Library workspace test cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // App keeps the undo snapshot for a replaced draft in sessionStorage, so a
    // test that creates one would otherwise show its banner in the next test.
    sessionStorage.clear();
    localStorage.setItem('pl_telemetry_consent', 'denied');
    for (const name of Object.keys(mocks.defaults)) mocks[name].mockImplementation(mocks.defaults[name]);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('shows the Library workspace, not the unmounted legacy panel, in Library view', () => {
    arrange();

    expect(screen.getByRole('region', { name: 'Prompt library workspace' })).toBeInTheDocument();
    expect(screen.queryByTestId('library-panel')).not.toBeInTheDocument();
  });

  it('lets a user reach Add Case from the Tests tab of a saved prompt', () => {
    const openCaseForm = vi.fn();
    arrange({ useExecutionFlow: { openCaseForm } });

    const region = openTestsTab();
    expect(within(region).getByText(/Test Cases \(0\)/)).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Add Case' }));
    expect(openCaseForm).toHaveBeenCalledWith('alpha');
    expect(document.body).not.toHaveTextContent('Evaluate to add cases');
  });

  it('hands the workspace the saved cases, open form and every case handler', () => {
    const handlers = {
      openCaseForm: vi.fn(), resetCaseForm: vi.fn(), saveCaseForPrompt: vi.fn(),
      removeCase: vi.fn(), runSingleCase: vi.fn(), setCaseInput: vi.fn(),
    };
    arrange({
      useExecutionFlow: {
        ...handlers,
        testCasesByPrompt: { alpha: [savedCase] },
        caseFormPromptId: 'alpha', caseTitle: 'Draft title', caseInput: 'Draft input',
      },
    });

    const region = openTestsTab();
    expect(within(region).getByText(/Test Cases \(1\)/)).toBeInTheDocument();
    expect(region).toHaveTextContent('Executive brevity');
    expect(within(region).getByLabelText('Test case title')).toHaveValue('Draft title');

    fireEvent.change(within(region).getByLabelText('Test case prompt input'), { target: { value: 'Edited input' } });
    expect(handlers.setCaseInput).toHaveBeenCalledWith('Edited input');
    fireEvent.click(within(region).getByRole('button', { name: 'Save Case' }));
    expect(handlers.saveCaseForPrompt).toHaveBeenCalledWith('alpha');
    fireEvent.click(within(region).getByRole('button', { name: 'Cancel' }));
    expect(handlers.resetCaseForm).toHaveBeenCalledTimes(1);
    fireEvent.click(within(region).getByRole('button', { name: 'Edit' }));
    expect(handlers.openCaseForm).toHaveBeenCalledWith('alpha', savedCase);
    fireEvent.click(within(region).getByRole('button', { name: 'Run' }));
    expect(handlers.runSingleCase).toHaveBeenCalledWith(savedCase, 'Alpha prompt');
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }));
    expect(handlers.removeCase).toHaveBeenCalledWith(savedCase);
  });

  it('keeps Run disabled while a case run is already in flight', () => {
    arrange({ useExecutionFlow: { testCasesByPrompt: { alpha: [savedCase] }, runningCases: true } });

    expect(within(openTestsTab()).getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  describe('Use', () => {
    it('starts a clean draft from the case input and keeps a loaded draft recoverable', () => {
      const loadCaseIntoEditor = vi.fn();
      const clearEditorState = vi.fn();
      const clearExecutionState = vi.fn();
      const clearPersistenceState = vi.fn();
      arrange({
        useEditorState: { raw: 'Draft of another prompt', clearEditorState },
        usePersistenceFlow: { editingId: 'beta', clearPersistenceState },
        useExecutionFlow: { testCasesByPrompt: { alpha: [savedCase] }, loadCaseIntoEditor, clearExecutionState },
      });

      fireEvent.click(within(openTestsTab()).getByRole('button', { name: 'Use' }));

      // The editor was holding prompt "beta"; a bare setRaw would leave it editing
      // beta with the case input, and the next save would overwrite beta.
      expect(clearEditorState).toHaveBeenCalledTimes(1);
      expect(clearPersistenceState).toHaveBeenCalledTimes(1);
      expect(clearExecutionState).toHaveBeenCalledTimes(1);
      expect(loadCaseIntoEditor).toHaveBeenCalledWith(savedCase);
      expect(screen.getByText('Restore previous draft')).toBeInTheDocument();
    });

    it('does not raise a recovery notice when the editor was empty', () => {
      const loadCaseIntoEditor = vi.fn();
      arrange({ useExecutionFlow: { testCasesByPrompt: { alpha: [savedCase] }, loadCaseIntoEditor } });

      fireEvent.click(within(openTestsTab()).getByRole('button', { name: 'Use' }));

      expect(loadCaseIntoEditor).toHaveBeenCalledWith(savedCase);
      expect(screen.queryByText('Restore previous draft')).not.toBeInTheDocument();
    });
  });
});
