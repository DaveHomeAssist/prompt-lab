import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestTitleFromText } from '../lib/promptSchema.js';

// Regression for "Failed enhance runs become the draft title and golden
// comparison text". useExecutionFlow records failed, canceled and blocked runs
// with the error message as `output`. When the editor has no enhanced result,
// App.jsx falls back to the newest eval run for the golden comparison and the
// suggested draft title, so that fallback must skip runs that did not succeed.
//
// The fallback must also use only the current prompt's runs. For a new, unsaved
// draft the run history lists recent runs from every prompt, so the draft may
// use only its own latest run (resultMeta.runId); a saved prompt may use only
// runs tagged with its id. Otherwise another prompt's output becomes the title.
//
// This mounts the real App and the real CreateContextBar (the Create
// breadcrumb that showed "New unsaved prompt <error message>"). Hook mocks follow
// App.shellLayout.test.jsx.

const state = vi.hoisted(() => ({ editorPaneProps: null }));

const RAW = 'Draft the quarterly outage summary for the board.';
const ERROR_TEXT = 'Hosted quota reached. Try again in a few minutes.';
const SUCCESS_TEXT = 'Summarize the quarterly outage report for the board in five bullet points.';

const runs = {
  error: { id: 'run-error', mode: 'enhance', status: 'error', output: ERROR_TEXT, createdAt: '2026-10-26T10:03:00Z' },
  canceled: { id: 'run-canceled', mode: 'enhance', status: 'canceled', output: 'Enhance cancelled before completion.', createdAt: '2026-10-26T10:02:00Z' },
  blocked: { id: 'run-blocked', mode: 'enhance', status: 'blocked', output: 'Prompt blocked before send due to sensitive data detection.', createdAt: '2026-10-26T10:01:00Z' },
  success: { id: 'run-success', mode: 'enhance', status: 'success', output: SUCCESS_TEXT, createdAt: '2026-10-26T10:00:00Z' },
};

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
// Pass the editor pane through so App's props for it can be read directly.
vi.mock('../MainWorkspace.jsx', () => ({ default: ({ editorPane }) => <div data-testid="main-workspace">{editorPane}</div> }));
vi.mock('../CreateEditorPane.jsx', () => ({
  default: (props) => {
    state.editorPaneProps = props;
    return <div data-testid="create-editor-pane" />;
  },
}));
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

function arrange(overrides = {}) {
  for (const [name, patch] of Object.entries(overrides)) {
    mocks[name].mockImplementation(() => ({ ...mocks.defaults[name](), ...patch }));
  }
  render(<MemoryRouter><App /></MemoryRouter>);
  return state.editorPaneProps;
}

function breadcrumbText() {
  return screen.getByRole('region', { name: 'Editing context' }).textContent;
}

describe('App comparison fallback after a failed enhance', () => {
  beforeEach(() => {
    state.editorPaneProps = null;
    for (const [name, factory] of Object.entries(mocks.defaults)) mocks[name].mockImplementation(factory);
  });

  it('skips a newer failed run and uses the latest successful run', () => {
    const props = arrange({
      useEditorState: { raw: RAW, resultMeta: { runId: runs.success.id } },
      useExecutionFlow: { evalRuns: [runs.error, runs.canceled, runs.blocked, runs.success] },
    });

    expect(props.comparisonText).toBe(SUCCESS_TEXT);
    expect(props.suggestedSaveTitle).toBe(suggestTitleFromText(SUCCESS_TEXT));
    expect(breadcrumbText()).toContain(suggestTitleFromText(SUCCESS_TEXT));
    expect(breadcrumbText()).not.toContain('Hosted quota');
  });

  it('falls back to the draft when no run has succeeded', () => {
    const props = arrange({
      useEditorState: { raw: RAW },
      useExecutionFlow: { evalRuns: [runs.error, runs.canceled, runs.blocked] },
    });

    expect(props.comparisonText).toBe('');
    expect(props.suggestedSaveTitle).toBe(suggestTitleFromText(RAW));
    expect(breadcrumbText()).toContain(suggestTitleFromText(RAW));
    expect(breadcrumbText()).not.toContain('Hosted quota');
  });

  it('never scores a golden response against a failed run', () => {
    const entry = {
      id: 'alpha', title: 'Outage summary', original: RAW, enhanced: '', tags: [], collection: '',
      goldenResponse: { text: SUCCESS_TEXT, pinnedAt: '2026-10-25T00:00:00Z' }, goldenThreshold: 0.7,
    };
    const props = arrange({
      useEditorState: { raw: RAW },
      useLibrary: { library: [entry] },
      usePersistenceFlow: { editingId: 'alpha' },
      useExecutionFlow: { evalRuns: [runs.error] },
    });

    expect(props.comparisonText).toBe('');
    expect(props.goldenVerdict).toBeNull();
    expect(props.goldenSimilarity).toBe(0);
  });

  it('still treats legacy runs without a status as successful', () => {
    const legacy = { id: 'run-legacy', promptId: 'alpha', mode: 'enhance', output: SUCCESS_TEXT, createdAt: '2026-09-01T00:00:00Z' };
    const entry = { id: 'alpha', title: 'Outage summary', original: RAW, enhanced: '', tags: [], collection: '' };
    const props = arrange({
      useEditorState: { raw: RAW },
      useLibrary: { library: [entry] },
      usePersistenceFlow: { editingId: 'alpha' },
      useExecutionFlow: { evalRuns: [{ ...runs.error, promptId: 'alpha' }, legacy] },
    });

    expect(props.comparisonText).toBe(SUCCESS_TEXT);
  });
});

describe('App comparison fallback uses only the current prompt runs', () => {
  const OTHER_TEXT = 'You are a web design specialist.\n\nAn image has been provided. Work through it step by step.';
  const otherRun = { id: 'run-other', promptId: null, mode: 'enhance', status: 'success', output: OTHER_TEXT, createdAt: '2026-10-26T08:22:50Z' };

  beforeEach(() => {
    state.editorPaneProps = null;
    for (const [name, factory] of Object.entries(mocks.defaults)) mocks[name].mockImplementation(factory);
  });

  it('does not give a new draft the title or comparison of another prompt run', () => {
    const props = arrange({
      useEditorState: { raw: RAW },
      useExecutionFlow: { evalRuns: [otherRun, { ...otherRun, id: 'run-saved-other', promptId: 'other' }] },
    });

    expect(props.comparisonText).toBe('');
    expect(props.suggestedSaveTitle).toBe(suggestTitleFromText(RAW));
    expect(breadcrumbText()).toContain(suggestTitleFromText(RAW));
    expect(breadcrumbText()).not.toContain(suggestTitleFromText(OTHER_TEXT));
  });

  it('ignores a stale run from the previous prompt after switching to a saved prompt', () => {
    const entry = { id: 'alpha', title: 'Outage summary', original: RAW, enhanced: '', tags: [], collection: '' };
    const props = arrange({
      useEditorState: { raw: RAW },
      useLibrary: { library: [entry] },
      usePersistenceFlow: { editingId: 'alpha' },
      useExecutionFlow: { evalRuns: [{ ...otherRun, promptId: 'other' }, { ...runs.success, promptId: 'alpha' }] },
    });

    expect(props.comparisonText).toBe(SUCCESS_TEXT);
  });
});
