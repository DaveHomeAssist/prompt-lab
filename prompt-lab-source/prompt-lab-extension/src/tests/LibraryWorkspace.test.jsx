import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../PackStudioPanel.jsx', () => ({ default: () => <div>Pack Studio loaded</div> }));

const entries = [
  {
    id: 'favorite',
    title: 'Favorite prompt',
    original: 'Draft a brief about {{topic}}',
    enhanced: 'Create a reusable brief about {{topic}} in JSON.',
    favorite: true,
    collection: 'Ops',
    tags: ['template'],
    useCount: 4,
    updatedAt: '2026-08-20T00:00:00Z',
    createdAt: '2026-08-18T00:00:00Z',
    sourceNoteId: 'note-7',
    metadata: {
      purpose: 'Handoff', owner: 'Dave', status: 'active', riskLevel: 'low', compatibility: ['Claude'],
      suite: { verdict: 'pass', passed: 1, total: 1 },
    },
    versions: [{
      id: 'v1', enhanced: 'Create an earlier brief about {{topic}}.', original: 'Draft a brief.',
      variants: [], notes: '', savedAt: '2026-08-19T00:00:00Z', changeNote: 'Initial save',
    }],
    inputs: [{ key: 'topic', label: 'Topic', type: 'text', required: true }],
    variants: [{ label: 'Tighter', content: 'Briefly explain {{topic}}.' }],
    notes: 'Keep this concise.',
    testCases: [{ id: 'case-1', name: 'JSON contract', input: 'AI safety', expectedTraits: ['valid JSON'], exclusions: ['preamble'] }],
    goldenResponse: { text: '{"brief":"example"}' },
    goldenThreshold: 0.8,
  },
  {
    id: 'incomplete', title: 'Incomplete prompt', enhanced: 'Draft content', original: '', favorite: false,
    collection: '', tags: [], useCount: 0, updatedAt: '2026-08-19T00:00:00Z', createdAt: '2026-08-19T00:00:00Z',
    metadata: { purpose: '', status: '', compatibility: [] }, versions: [], inputs: [], variants: [], testCases: [],
  },
];

function makeLib(overrides = {}) {
  return {
    library: entries,
    trash: [{ ...entries[1], id: 'trash', title: 'Deleted prompt', deletedAt: new Date().toISOString() }],
    filtered: entries,
    collections: ['Ops'], setCollections: vi.fn(), deleteCollection: vi.fn(),
    allLibTags: ['template'],
    search: '', setSearch: vi.fn(),
    sortBy: 'newest', setSortBy: vi.fn(),
    activeCollection: null, setActiveCollection: vi.fn(),
    activeTag: null, setActiveTag: vi.fn(),
    exportLib: vi.fn(), importLib: vi.fn(),
    updateEntries: vi.fn(), moveEntriesToCollection: vi.fn(), addTagToEntries: vi.fn(), deleteEntries: vi.fn(),
    restoreDeleted: vi.fn(), permanentlyDelete: vi.fn(), setFavorite: vi.fn(), duplicateEntry: vi.fn(),
    del: vi.fn(() => true), restoreVersion: vi.fn(), trackRecentAccess: vi.fn(),
    ...overrides,
  };
}

function renderLibrary(options = {}) {
  const callbacks = {
    loadEntry: vi.fn(), copy: vi.fn(), addToComposer: vi.fn(), sendToABTest: vi.fn(),
    onNewPrompt: vi.fn(), onOpenScratchSource: vi.fn(), openBilling: vi.fn(),
    ...options.callbacks,
  };
  const lib = options.lib || makeLib();
  const view = render(<LibraryWorkspace lib={lib} {...callbacks} {...options.props} />);
  return { ...view, lib, callbacks };
}

describe('LibraryWorkspace', () => {
  it('provides every smart view, tile/list density, and non-nested keyboard-selectable cards', () => {
    renderLibrary();

    for (const name of ['All prompts', 'Recent', 'Frequently used', 'Favorites', 'Templates', 'Incomplete']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}\\d+$`) })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /Favorites/ }));
    expect(screen.getByText('Favorite prompt')).toBeInTheDocument();
    expect(screen.queryByText('Incomplete prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Tile view'));
    const inspectButton = screen.getByRole('button', { name: 'Inspect Favorite prompt' });
    expect(within(inspectButton).queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(inspectButton);
    expect(inspectButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('complementary', { name: 'Favorite prompt' })).toHaveTextContent('Handoff');
  });

  it('offers search, status filtering, visible filter chips, sort, and one clear action', () => {
    const { lib } = renderLibrary();

    fireEvent.change(screen.getByTestId('library-search'), { target: { value: 'Draft content' } });
    expect(lib.setSearch).toHaveBeenCalledWith('Draft content');
    expect(screen.getByText('Search: Draft content')).toBeInTheDocument();
    expect(screen.getByText('Incomplete prompt')).toBeInTheDocument();
    expect(screen.queryByText('Favorite prompt')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'draft' } });
    expect(screen.getByText('Status: draft')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sort prompts'), { target: { value: 'a-z' } });
    expect(lib.setSortBy).toHaveBeenCalledWith('a-z');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(lib.setSearch).toHaveBeenLastCalledWith('');
    expect(lib.setActiveTag).toHaveBeenLastCalledWith(null);
    expect(lib.setActiveCollection).toHaveBeenLastCalledWith(null);
  });

  it('supports complete normal and trash bulk workflows', () => {
    const { lib, callbacks } = renderLibrary();

    fireEvent.click(screen.getByLabelText('Select Favorite prompt'));
    fireEvent.click(screen.getByLabelText('Select Incomplete prompt'));
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(lib.updateEntries).toHaveBeenCalledWith(['favorite', 'incomplete'], expect.any(Function));

    fireEvent.click(screen.getByLabelText('Select Favorite prompt'));
    fireEvent.change(screen.getByLabelText('Move selected prompts to collection'), { target: { value: 'Ops' } });
    expect(lib.moveEntriesToCollection).toHaveBeenCalledWith(['favorite'], 'Ops');

    fireEvent.click(screen.getByLabelText('Select Favorite prompt'));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Copy' }));
    expect(callbacks.copy).toHaveBeenCalledWith(expect.stringContaining('Create a reusable brief'));

    fireEvent.click(screen.getByRole('button', { name: /Recently Deleted/ }));
    fireEvent.click(screen.getByLabelText('Select Deleted prompt'));
    fireEvent.click(within(screen.getByRole('toolbar', { name: 'Bulk actions' })).getByRole('button', { name: 'Restore' }));
    expect(lib.restoreDeleted).toHaveBeenCalledWith('trash');
  });

  it('edits full metadata and exposes content, variable, variant, note, test, and version inspectors', () => {
    const { lib } = renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Favorite prompt' }));

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Prompt Team' } });
    fireEvent.change(screen.getByLabelText('Risk'), { target: { value: 'medium' } });
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'template, reviewed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));
    expect(lib.updateEntries).toHaveBeenCalledWith(['favorite'], expect.any(Function));
    const updater = lib.updateEntries.mock.calls.at(-1)[1];
    const updated = updater(entries[0]);
    expect(updated.metadata).toMatchObject({ owner: 'Prompt Team', riskLevel: 'medium' });
    expect(updated.tags).toEqual(['template', 'reviewed']);

    const detailsTab = screen.getByRole('tab', { name: 'Details' });
    fireEvent.keyDown(detailsTab.closest('[role="tablist"]'), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Content' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', { name: 'Variables' }));
    expect(screen.getByText('{{topic}}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Variants' }));
    expect(screen.getByText('Tighter')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(screen.getByText('Keep this concise.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Tests' }));
    expect(screen.getByText('JSON contract')).toBeInTheDocument();
    expect(screen.getByText('Golden response')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Version history' }));
    expect(screen.getByLabelText('Word-level changes')).toBeInTheDocument();
    expect(screen.getByText(/Restoring is nondestructive/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore as current' }));
    expect(lib.restoreVersion).toHaveBeenCalledWith('favorite', expect.objectContaining({ id: 'v1' }));
  });

  it('routes all item destinations, source links, compact back, and New Prompt', () => {
    const { callbacks, container, lib } = renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Favorite prompt' }));
    expect(container.firstChild).toHaveClass('has-inspector-selection');

    fireEvent.click(screen.getByRole('button', { name: 'Open source in Scratch' }));
    expect(callbacks.onOpenScratchSource).toHaveBeenCalledWith('note-7', entries[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Open in Editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Composer' }));
    fireEvent.click(screen.getByRole('button', { name: 'A/B test' }));
    expect(callbacks.loadEntry).toHaveBeenCalledWith(entries[0]);
    expect(callbacks.addToComposer).toHaveBeenCalledWith(entries[0]);
    expect(callbacks.sendToABTest).toHaveBeenCalledWith(entries[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Unfavorite prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate prompt' }));
    expect(lib.setFavorite).toHaveBeenCalledWith('favorite');
    expect(lib.duplicateEntry).toHaveBeenCalledWith('favorite');

    fireEvent.click(screen.getByRole('button', { name: 'Back to prompts' }));
    expect(container.firstChild).not.toHaveClass('has-inspector-selection');
    fireEvent.click(screen.getAllByRole('button', { name: 'New Prompt' })[0]);
    expect(callbacks.onNewPrompt).toHaveBeenCalledTimes(1);
  });

  it('manages collections without prompt dialogs and keeps import, export, and packs connected', () => {
    const { lib } = renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'Manage collections' }));
    fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(lib.setCollections).toHaveBeenCalledWith(expect.any(Function));
    expect(lib.setCollections.mock.calls[0][0](['Ops'])).toEqual(['Ops', 'Research']);

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Rename Ops'), { target: { value: 'Operations' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(lib.updateEntries).toHaveBeenCalledWith(['favorite'], expect.any(Function));
    fireEvent.click(screen.getByLabelText('Delete collection Ops'));
    expect(lib.deleteCollection).toHaveBeenCalledWith('Ops');

    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(lib.exportLib).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Open pack studio' }));
    expect(screen.getByText('Pack Studio loaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByLabelText('Import Prompt Lab workspace'), { target: { files: [new File(['{}'], 'library.json', { type: 'application/json' })] } });
    expect(lib.importLib).toHaveBeenCalledTimes(1);
  });

  it('routes locked export, import, packs, and collections through entitlement controls', () => {
    const { callbacks } = renderLibrary({
      props: { canUseCollections: false, canExportLibrary: false, canImportLibrary: false, canUsePacks: false },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock pack studio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import Pro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlock collections' }));
    expect(callbacks.openBilling.mock.calls.map(([feature]) => feature)).toEqual(['export', 'packs', 'import', 'collections']);
  });

  it('keeps Recently Deleted recoverable and shows the 30-day retention contract', () => {
    const { lib } = renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: /Recently Deleted/ }));
    expect(screen.getByText('Items are permanently removed after 30 days.')).toBeInTheDocument();
    expect(screen.getByText(/days left|Removed today/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(lib.restoreDeleted).toHaveBeenCalledWith('trash');
    fireEvent.click(screen.getByLabelText('Permanently delete Deleted prompt'));
    expect(lib.permanentlyDelete).toHaveBeenCalledWith('trash');
  });
});

// DHA-20: the layout toggle shipped with the workspace redesign, but the choice
// was held in plain useState and reset on every remount. These cover the
// persistence contract and that tile cards keep their affordances.
describe('LibraryWorkspace layout preference', () => {
  const KEY = 'pl2-library-layout';

  beforeEach(() => {
    localStorage.clear();
  });

  function resultsList() {
    return screen.getByRole('list', { name: 'Saved prompts' });
  }

  it('defaults to list view', () => {
    renderLibrary();
    expect(resultsList().className).toContain('is-list');
    expect(screen.getByLabelText('List view')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Tile view')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches to tiles and records the choice', () => {
    renderLibrary();
    fireEvent.click(screen.getByLabelText('Tile view'));

    expect(resultsList().className).toContain('is-tiles');
    expect(screen.getByLabelText('Tile view')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem(KEY))).toBe('tiles');
  });

  it('restores the chosen layout on a fresh mount', () => {
    const first = renderLibrary();
    fireEvent.click(screen.getByLabelText('Tile view'));
    first.unmount();

    // A remount stands in for navigating away and back, or reloading.
    renderLibrary();
    expect(resultsList().className).toContain('is-tiles');
    expect(screen.getByLabelText('Tile view')).toHaveAttribute('aria-pressed', 'true');
  });

  it('falls back to list when the stored value is unusable', () => {
    localStorage.setItem(KEY, JSON.stringify('mosaic'));
    renderLibrary();
    expect(resultsList().className).toContain('is-list');

    localStorage.setItem(KEY, 'not json');
    renderLibrary();
    expect(screen.getAllByRole('list', { name: 'Saved prompts' })[1].className).toContain('is-list');
  });

  it('keeps card actions and identifying metadata in tile view', () => {
    renderLibrary();
    fireEvent.click(screen.getByLabelText('Tile view'));

    const [tile] = within(resultsList()).getAllByRole('listitem');

    // Identification and organisation survive the denser layout.
    expect(within(tile).getByText('Favorite prompt')).toBeInTheDocument();
    expect(within(tile).getByText('Ops')).toBeInTheDocument();
    expect(within(tile).getByText('#template')).toBeInTheDocument();
    expect(within(tile).getByText('4 uses')).toBeInTheDocument();

    // And so do the actions needed to select and open a prompt.
    expect(within(tile).getByLabelText('Select Favorite prompt')).toBeInTheDocument();
    expect(within(tile).getByLabelText('Inspect Favorite prompt')).toBeInTheDocument();
  });
});
