import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCRATCH_KEY, SCRATCH_SCHEMA_VERSION_KEY } from '../lib/scratchSchema.js';

// Scratch beside Write, mounted through the real App, CreateContextBar and
// MainWorkspace. Hook mocks follow App.failedRunComparison.test.jsx.

const mocks = vi.hoisted(() => {
  const fn = () => vi.fn();
  const defaults = {
    useUiState: () => ({
      viewportWidth: 1280, viewportHeight: 900, colorMode: 'dark', setColorMode: fn(),
      density: 'comfortable', setDensity: fn(),
      primaryView: 'create', setPrimaryView: fn(), workspaceView: 'editor', setWorkspaceView: fn(),
      runsView: 'history', setRunsView: fn(), tab: 'editor', setTab: fn(),
      toast: null, setToast: fn(), notify: fn(),
      showSettings: false, setShowSettings: fn(), showCmdPalette: false, setShowCmdPalette: fn(),
      showShortcuts: false, setShowShortcuts: fn(), cmdQuery: '', setCmdQuery: fn(),
    }),
    useLibrary: () => ({
      library: [], collections: [], quickInject: [], recentPrompts: [],
      expandedVersionId: null, diffVersionIdx: null,
      setCollections: fn(), deleteCollection: fn(), exportLib: fn(), importLib: fn(), clearLibrary: fn(),
      setShareId: fn(), closeVersionHistory: fn(), setDiffVersionIdx: fn(), restoreVersion: fn(), bumpUse: fn(),
      pinGoldenResponse: fn(), clearGoldenResponse: fn(), setGoldenThreshold: fn(),
    }),
    useABTest: () => ({ loadVariant: fn() }),
    useEditorState: () => ({
      raw: '', setRaw: fn(), enhanced: '', setEnhanced: fn(), variants: [], notes: '',
      enhMode: 'balanced', setEnhMode: fn(), showNotes: false, setShowNotes: fn(),
      editorLayout: 'editor', setEditorLayout: fn(), composerBlocks: [], setComposerBlocks: fn(),
      cursor: { start: 0, end: 0 }, updateCursor: fn(), lintIssues: [], lintOpen: false, setLintOpen: fn(),
      handleLintFix: fn(), hasSavablePrompt: true, clearEditorState: fn(),
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
    useExecutionFlow: () => ({
      loading: false, error: null, streamPreview: '', streaming: false, optimisticSaveVisible: false,
      batchProgress: { active: false, completed: 0, total: 0, currentLabel: '' },
      piiWarning: null, piiSendAnyway: fn(), piiRedactAndSend: fn(), piiCancel: fn(),
      evalRuns: [], showEvalHistory: false, setShowEvalHistory: fn(),
      testCasesByPrompt: {}, runningCases: false, runSingleCase: fn(), runAllCases: fn(),
      enhance: fn(), enhanceWithMode: fn(), openOptions: fn(), copy: fn(), cancelEnhance: fn(),
      refreshEvalRuns: fn(), clearExecutionState: fn(),
    }),
    useNavigation: () => ({
      activeSection: 'create', openCreateView: fn(), openSection: fn(), openRunsView: fn(),
    }),
  };
  const mocks = Object.fromEntries(Object.entries(defaults).map(([name, factory]) => [name, vi.fn(factory)]));
  return { ...mocks, defaults };
});

vi.mock('../hooks/useUiState.js', () => ({ default: mocks.useUiState }));
vi.mock('../hooks/usePromptLibrary.js', () => ({ default: mocks.useLibrary }));
vi.mock('../hooks/useABTest.js', () => ({ default: mocks.useABTest }));
vi.mock('../hooks/useEditorState.js', () => ({ default: mocks.useEditorState }));
vi.mock('../hooks/usePersistenceFlow.js', () => ({ default: mocks.usePersistenceFlow }));
vi.mock('../hooks/useExecutionFlow.js', () => ({ default: mocks.useExecutionFlow }));
vi.mock('../hooks/useNavigation.js', () => ({ default: mocks.useNavigation }));
vi.mock('../lib/platform.js', () => ({ isExtension: false }));
vi.mock('../lib/navigationRegistry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveRouteState: vi.fn(() => null),
  stateToRoute: vi.fn(() => '/'),
}));
vi.mock('../theme/ThemeProvider.jsx', () => ({ ThemeProvider: ({ children }) => <>{children}</> }));
vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../AppHeader.jsx', () => ({ default: () => <div data-testid="app-header" /> }));
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
vi.mock('../modals/BillingModal.jsx', () => ({ default: () => null }));

import App from '../App.jsx';

function seedNoteText(content) {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({ pads: [{ id: 'note', name: 'Research', content, timestamp: Date.now() }], activePadId: 'note' }));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '4');
}

function seedNote() {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({
    pads: [{ id: 'note', name: 'Research', content: ' plus my notes', timestamp: Date.now() }],
    activePadId: 'note',
  }));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '4');
}

function arrange(overrides = {}) {
  for (const [name, patch] of Object.entries(overrides)) {
    mocks[name].mockImplementation(() => ({ ...mocks.defaults[name](), ...patch }));
  }
  return render(<MemoryRouter><App /></MemoryRouter>);
}

const panel = () => screen.queryByRole('complementary', { name: 'Scratch notes beside Write' });

describe('Scratch beside Write', () => {
  beforeEach(() => {
    localStorage.clear();
    seedNote();
    for (const [name, factory] of Object.entries(mocks.defaults)) mocks[name].mockImplementation(factory);
  });
  afterEach(() => cleanup());

  it('opens beside the editor from the editing context and inserts the note at the cursor', () => {
    const setRaw = vi.fn();
    const updateCursor = vi.fn();
    arrange({ useEditorState: { raw: 'Draft prompt', setRaw, cursor: { start: 5, end: 5 }, updateCursor } });
    expect(panel()).toBeNull();

    const button = screen.getByRole('button', { name: 'Scratch' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(panel()).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize Scratch panel' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Scratch note text' })).toHaveValue(' plus my notes');

    fireEvent.click(screen.getByRole('button', { name: 'Insert note into prompt' }));
    expect(setRaw).toHaveBeenCalledWith('Draft plus my notes prompt');
    expect(updateCursor).toHaveBeenCalledWith(19);
  });

  it('starts the note on a new paragraph when inserting at the end of the prompt', () => {
    seedNoteText('Three bullets.');
    const setRaw = vi.fn();
    arrange({ useEditorState: { raw: 'Summarize the report.', setRaw, cursor: { start: 21, end: 21 }, updateCursor: vi.fn() } });
    fireEvent.click(screen.getByRole('button', { name: 'Scratch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insert note into prompt' }));
    expect(setRaw).toHaveBeenCalledWith('Summarize the report.\n\nThree bullets.');
  });

  it('toggles with Cmd or Ctrl plus backslash and remembers that it is open', () => {
    arrange();
    act(() => { fireEvent.keyDown(window, { key: '\\', ctrlKey: true }); });
    expect(panel()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('pl2-write-scratch-open'))).toBe(true);
    act(() => { fireEvent.keyDown(window, { key: '\\', metaKey: true }); });
    expect(panel()).toBeNull();
  });

  it('floats over the editor below 1100 px instead of taking a column', () => {
    localStorage.setItem('pl2-write-scratch-open', 'true');
    const narrow = mocks.defaults.useUiState();
    arrange({ useUiState: { ...narrow, viewportWidth: 900 } });
    expect(panel()).toHaveClass('is-overlay');
    expect(screen.queryByRole('separator', { name: 'Resize Scratch panel' })).toBeNull();
  });

  it('returns to the toggle when the panel closes', async () => {
    localStorage.setItem('pl2-write-scratch-open', 'true');
    arrange();
    fireEvent.click(screen.getByRole('button', { name: 'Close Scratch panel' }));
    expect(panel()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('button', { name: 'Scratch' })).toHaveFocus();
  });
});
