import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryPanel from '../LibraryPanel.jsx';

vi.mock('../icons', () => ({
  default: ({ n }) => <span>{n}</span>,
}));

vi.mock('../TagChip', () => ({
  default: ({ tag }) => <span>{tag}</span>,
}));

vi.mock('../TestCasesPanel', () => ({
  default: () => <div data-testid="test-cases-panel" />,
}));

vi.mock('../MarkdownPreview', () => ({
  default: ({ text }) => <div>{text}</div>,
}));

vi.mock('../DraftBadge.jsx', () => ({
  default: ({ children }) => <span>{children}</span>,
}));

vi.mock('../PresetImportPanel.jsx', () => ({
  default: () => <div data-testid="preset-import-panel" />,
}));

function makeEntry(overrides = {}) {
  return {
    id: overrides.id || 'entry-1',
    title: overrides.title || 'Prompt Entry',
    original: overrides.original || 'Original body',
    enhanced: overrides.enhanced || 'Enhanced body',
    notes: overrides.notes || '',
    tags: overrides.tags || [],
    collection: overrides.collection || '',
    createdAt: overrides.createdAt || '2026-03-20T00:00:00.000Z',
    useCount: overrides.useCount || 0,
    versions: overrides.versions || [],
    variants: overrides.variants || [],
  };
}

function makeProps(libOverrides = {}) {
  const first = makeEntry({ id: 'entry-1', title: 'Alpha', collection: 'Alpha Group' });
  const second = makeEntry({ id: 'entry-2', title: 'Beta', collection: 'Beta Group', createdAt: '2026-03-21T00:00:00.000Z' });
  const filtered = [first, second];

  return {
    m: {
      surface: 'surface',
      border: 'border',
      borderHov: 'border-hov',
      text: 'text',
      textAlt: 'text-alt',
      textBody: 'text-body',
      textMuted: 'text-muted',
      textSub: 'text-sub',
      notesText: 'notes-text',
      codeBlock: 'code-block',
      btn: 'btn',
      input: 'input',
    },
    lib: {
      search: '',
      setSearch: vi.fn(),
      sortBy: 'manual',
      setSortBy: vi.fn(),
      exportLib: vi.fn(),
      collections: [],
      allLibTags: [],
      activeCollection: null,
      setActiveCollection: vi.fn(),
      activeTag: null,
      setActiveTag: vi.fn(),
      filtered,
      library: filtered,
      shareId: null,
      setShareId: vi.fn(),
      expandedId: null,
      setExpandedId: vi.fn(),
      draggingLibraryId: null,
      dragOverLibraryId: null,
      setDraggingLibraryId: vi.fn(),
      setDragOverLibraryId: vi.fn(),
      moveLibraryEntry: vi.fn(),
      moveLibraryEntryByOffset: vi.fn(),
      renamingId: null,
      renameValue: '',
      setRenameValue: vi.fn(),
      renameEntry: vi.fn(),
      setRenamingId: vi.fn(),
      openVersionHistory: vi.fn(),
      del: vi.fn(),
      starterLibraries: [],
      ...libOverrides,
    },
    compact: false,
    isWeb: false,
    showEditorPane: true,
    effectiveEditorLayout: 'editor',
    setEditorLayout: vi.fn(),
    editingId: null,
    setSaveTitle: vi.fn(),
    testCasesByPrompt: {},
    evalRuns: [],
    editingCaseId: null,
    caseFormPromptId: null,
    caseTitle: '',
    setCaseTitle: vi.fn(),
    caseInput: '',
    setCaseInput: vi.fn(),
    caseTraits: '',
    setCaseTraits: vi.fn(),
    caseExclusions: '',
    setCaseExclusions: vi.fn(),
    caseNotes: '',
    setCaseNotes: vi.fn(),
    openCaseForm: vi.fn(),
    resetCaseForm: vi.fn(),
    saveCaseForPrompt: vi.fn(),
    loadCaseIntoEditor: vi.fn(),
    runSingleCase: vi.fn(),
    removeCase: vi.fn(),
    loadEntry: vi.fn(),
    addToComposer: vi.fn(),
    openSavePanel: vi.fn(),
    sendToABTest: vi.fn(),
    copy: vi.fn(),
  };
}

describe('LibraryPanel organizing', () => {
  it('moves entries by visible filtered order in manual mode', () => {
    const props = makeProps();

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByLabelText('Move Alpha down'));

    expect(props.lib.moveLibraryEntryByOffset).toHaveBeenCalledWith('entry-1', 1, props.lib.filtered);
  }, 20000);

  it('renders collection headers in grouped mode', () => {
    const groupedEntries = [
      makeEntry({ id: 'entry-1', title: 'Alpha', collection: 'Alpha Group' }),
      makeEntry({ id: 'entry-2', title: 'Beta', collection: 'Beta Group' }),
    ];
    const props = makeProps({
      sortBy: 'group',
      filtered: groupedEntries,
      library: groupedEntries,
    });

    render(<LibraryPanel {...props} />);

    expect(screen.getAllByText('Alpha Group').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Beta Group').length).toBeGreaterThan(0);
  });
});
