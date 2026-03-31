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
  default: ({ onClose }) => (
    <div data-testid="preset-import-panel">
      <button type="button" onClick={onClose}>Close Import</button>
    </div>
  ),
}));

function makeEntry() {
  return {
    id: 'entry-1',
    title: 'Prompt Alpha',
    original: 'Original prompt',
    enhanced: 'Enhanced prompt',
    notes: 'Library note',
    tags: ['ops'],
    collection: 'Launch',
    createdAt: '2026-03-18T00:00:00.000Z',
    useCount: 1,
    versions: [],
    variants: [],
  };
}

function makeProps(overrides = {}) {
  const entry = makeEntry();
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
      sortBy: 'newest',
      setSortBy: vi.fn(),
      exportLib: vi.fn(),
      setLibrary: vi.fn(),
      setCollections: vi.fn(),
      collections: [],
      allLibTags: [],
      activeCollection: null,
      setActiveCollection: vi.fn(),
      activeTag: null,
      setActiveTag: vi.fn(),
      filtered: [entry],
      library: [entry],
      shareId: null,
      setShareId: vi.fn(),
      expandedId: entry.id,
      setExpandedId: vi.fn(),
      draggingLibraryId: null,
      dragOverLibraryId: null,
      setDraggingLibraryId: vi.fn(),
      setDragOverLibraryId: vi.fn(),
      moveLibraryEntry: vi.fn(),
      renamingId: null,
      renameValue: '',
      setRenameValue: vi.fn(),
      renameEntry: vi.fn(),
      setRenamingId: vi.fn(),
      openVersionHistory: vi.fn(),
      del: vi.fn(),
      starterLibraries: [],
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
    ...overrides,
  };
}

describe('LibraryPanel actions', () => {
  it('edit details opens the save panel without loading the prompt into the editor', () => {
    const props = makeProps();

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));

    expect(props.openSavePanel).toHaveBeenCalledWith(props.lib.filtered[0]);
    expect(props.loadEntry).not.toHaveBeenCalled();
  });

  it('routes library prompts into the requested A/B variant', () => {
    const props = makeProps();

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /A\/B A/i }));
    fireEvent.click(screen.getByRole('button', { name: /A\/B B/i }));

    expect(props.sendToABTest).toHaveBeenNthCalledWith(1, props.lib.filtered[0], 'a');
    expect(props.sendToABTest).toHaveBeenNthCalledWith(2, props.lib.filtered[0], 'b');
  });

  it('toggles the preset import panel from the toolbar', () => {
    const props = makeProps({ lib: { ...makeProps().lib, expandedId: null } });

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: /Import preset pack/i }));
    expect(screen.getByTestId('preset-import-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Import' }));
    expect(screen.queryByTestId('preset-import-panel')).not.toBeInTheDocument();
  });

  it('offers a starter-pack CTA when the library is empty', () => {
    const loadStarterPack = vi.fn();
    const props = makeProps({
      lib: {
        ...makeProps().lib,
        filtered: [],
        library: [],
        expandedId: null,
        loadStarterPack,
        starterLibraries: [
          { id: 'pack-1', name: 'Ops Pack', description: 'Starter prompts', icon: 'A', promptCount: 3, loaded: false },
        ],
      },
    });

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load Ops Pack' }));

    expect(loadStarterPack).toHaveBeenCalledWith('pack-1');
  });

  it('clears search and facet filters from the no-results state', () => {
    const setSearch = vi.fn();
    const setActiveTag = vi.fn();
    const setActiveCollection = vi.fn();
    const props = makeProps({
      lib: {
        ...makeProps().lib,
        search: 'ops',
        activeTag: 'ops',
        activeCollection: 'Launch',
        setSearch,
        setActiveTag,
        setActiveCollection,
        filtered: [],
        library: [makeEntry()],
        expandedId: null,
      },
    });

    render(<LibraryPanel {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));

    expect(setSearch).toHaveBeenCalledWith('');
    expect(setActiveTag).toHaveBeenCalledWith(null);
    expect(setActiveCollection).toHaveBeenCalledWith(null);
  });
});
