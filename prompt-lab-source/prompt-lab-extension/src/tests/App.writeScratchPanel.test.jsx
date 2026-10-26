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
    expect(screen.getByRole('separator', { name: 'Resize side panel' })).toBeInTheDocument();
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
    expect(screen.queryByRole('separator', { name: 'Resize side panel' })).toBeNull();
  });

  it('shows saved prompts in a Prompts tab and remembers the chosen list', async () => {
    const library = [
      { id: 'p1', title: 'Older favorite', original: 'Older text', enhanced: '', favorite: true, updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z' },
      { id: 'p2', title: 'Newer prompt', original: 'Newer text', enhanced: 'Improved newer text', favorite: false, updatedAt: '2026-10-05T00:00:00Z', createdAt: '2026-10-05T00:00:00Z' },
    ];
    const setFavorite = vi.fn();
    const trackRecentAccess = vi.fn();
    const loadEntry = vi.fn();
    const setRaw = vi.fn();
    arrange({
      useLibrary: { library, sortBy: 'newest', setFavorite, trackRecentAccess },
      usePersistenceFlow: { loadEntry },
      useEditorState: { raw: 'Draft', setRaw, cursor: { start: 5, end: 5 }, updateCursor: vi.fn() },
    });

    const toggle = screen.getByRole('button', { name: 'Prompts' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('complementary', { name: 'Prompts beside Write' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Scratch' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('tab', { name: 'Prompts' })).toHaveAttribute('aria-selected', 'true');
    const titles = () => screen.getAllByRole('button', { name: /^Open .* in Write$/ }).map((button) => button.getAttribute('aria-label').slice(5, -9));
    expect(titles()).toEqual(['Newer prompt', 'Older favorite']);

    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(titles()).toEqual(['Older favorite']);
    expect(JSON.parse(localStorage.getItem('pl2-write-side-view'))).toBe('favorites');

    fireEvent.click(screen.getByRole('button', { name: 'Unfavorite Older favorite' }));
    expect(setFavorite).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByRole('button', { name: 'Insert Older favorite into prompt' }));
    expect(setRaw).toHaveBeenCalledWith('Draft\n\nOlder text');
    fireEvent.click(screen.getByRole('button', { name: 'Open Older favorite in Write' }));
    expect(trackRecentAccess).toHaveBeenCalledWith('p1');
    await act(async () => {});
    expect(loadEntry).toHaveBeenCalledWith(library[0]);

    // The Scratch tab saves notes as before, and Prompts comes back on Favorites.
    fireEvent.click(screen.getByRole('tab', { name: 'Scratch' }));
    expect(screen.getByRole('textbox', { name: 'Scratch note text' })).toHaveValue(' plus my notes');
    expect(JSON.parse(localStorage.getItem('pl2-write-side-view'))).toBe('scratch');
    fireEvent.click(screen.getByRole('tab', { name: 'Prompts' }));
    expect(screen.getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');

    // The pressed toggle closes the panel and keeps focus on itself.
    fireEvent.click(toggle);
    expect(screen.queryByRole('complementary', { name: 'Prompts beside Write' })).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toggle).toHaveFocus();
  });

  it('switches an open panel to the other tab from the context bar instead of closing it', () => {
    localStorage.setItem('pl2-write-scratch-open', 'true');
    localStorage.setItem('pl2-write-side-view', JSON.stringify('recent'));
    arrange();
    expect(screen.getByRole('complementary', { name: 'Prompts beside Write' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Scratch' }));
    expect(panel()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scratch' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores an unknown stored view', () => {
    localStorage.setItem('pl2-write-scratch-open', 'true');
    localStorage.setItem('pl2-write-side-view', JSON.stringify('trash'));
    arrange();
    expect(panel()).toBeInTheDocument();
  });

  it('returns to the toggle when the panel closes', async () => {
    localStorage.setItem('pl2-write-scratch-open', 'true');
    arrange();
    fireEvent.click(screen.getByRole('button', { name: 'Close side panel' }));
    expect(panel()).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole('button', { name: 'Scratch' })).toHaveFocus();
  });
});
