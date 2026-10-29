import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PromptsSidePanel from '../PromptsSidePanel.jsx';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const DAY = 24 * 60 * 60 * 1000;
const at = (days) => new Date(Date.UTC(2026, 9, 1) + days * DAY).toISOString();

// Updated, created and last-opened times differ so each view orders the
// prompts differently.
const library = [
  { id: 'alpha', title: 'Alpha brief', enhanced: 'Alpha text', original: 'Alpha draft', favorite: true, collection: 'Ops', tags: [], useCount: 2, createdAt: at(1), updatedAt: at(3), lastAccessedAt: at(9), metadata: {} },
  { id: 'bravo', title: 'Bravo summary', enhanced: '', original: 'Bravo draft', favorite: false, collection: '', tags: [], useCount: 5, createdAt: at(2), updatedAt: at(8), metadata: {} },
  { id: 'charlie', title: 'Charlie outline', enhanced: 'Charlie text', original: '', favorite: true, collection: 'Writing', tags: [], useCount: 0, createdAt: at(3), updatedAt: at(5), lastAccessedAt: at(6), metadata: {} },
  { id: 'delta', title: 'Delta checklist', enhanced: 'Delta text', original: '', favorite: false, collection: '', tags: [], useCount: 1, createdAt: at(4), updatedAt: at(4), lastAccessedAt: at(10), metadata: {} },
  { id: 'echo', title: 'Echo email', enhanced: 'Echo text', original: '', favorite: true, collection: '', tags: [], useCount: 3, createdAt: at(5), updatedAt: at(7), metadata: {} },
];

function makeLib(sortBy) {
  return {
    library, trash: [], filtered: library, collections: ['Ops', 'Writing'], allLibTags: [],
    search: '', setSearch: vi.fn(), sortBy, setSortBy: vi.fn(),
    activeCollection: null, setActiveCollection: vi.fn(), activeTag: null, setActiveTag: vi.fn(),
    exportLib: vi.fn(), importLib: vi.fn(), updateEntries: vi.fn(), moveEntriesToCollection: vi.fn(),
    addTagToEntries: vi.fn(), deleteEntries: vi.fn(), restoreDeleted: vi.fn(), permanentlyDelete: vi.fn(),
    setFavorite: vi.fn(), duplicateEntry: vi.fn(), del: vi.fn(), restoreVersion: vi.fn(), trackRecentAccess: vi.fn(),
    saveFolders: vi.fn(),
  };
}

function renderPanel(props = {}) {
  const handlers = { onViewChange: vi.fn(), onOpen: vi.fn(), onInsert: vi.fn(), onToggleFavorite: vi.fn() };
  const view = render(<PromptsSidePanel m={{}} library={library} sortBy="newest" view="all" {...handlers} {...props} />);
  return { ...view, ...handlers };
}

const panelTitles = (scope = screen) => scope.getAllByRole('button', { name: /^Open .* in Write$/ })
  .map((button) => button.getAttribute('aria-label').replace(/^Open /, '').replace(/ in Write$/, ''));

afterEach(() => { cleanup(); localStorage.clear(); });

describe('PromptsSidePanel', () => {
  it('lists the same prompts in the same order as the Library for All, Recent and Favorites', () => {
    for (const sortBy of ['newest', 'a-z', 'most-used']) {
      const { container: libraryRoot } = render(<LibraryWorkspace m={{}} lib={makeLib(sortBy)} loadEntry={vi.fn()} copy={vi.fn()} />);
      for (const [view, viewButton] of [['all', /^All prompts/], ['recent', /^Recent/], ['favorites', /^Favorites/]]) {
        fireEvent.click(within(within(libraryRoot).getByRole('navigation', { name: 'Smart views' })).getByRole('button', { name: viewButton }));
        const libraryTitles = within(within(libraryRoot).getByRole('list', { name: 'Saved prompts' })).getAllByRole('button', { name: /^Inspect / })
          .map((button) => button.getAttribute('aria-label').replace(/^Inspect /, ''));
        const { container: sideRoot, unmount } = render(<PromptsSidePanel m={{}} library={library} sortBy={sortBy} view={view} />);
        expect(panelTitles(within(sideRoot)), `${view} sorted ${sortBy}`).toEqual(libraryTitles);
        unmount();
      }
      cleanup();
    }
  });

  it('orders Recent by last opened, then last updated', () => {
    renderPanel({ view: 'recent' });
    expect(panelTitles()).toEqual(['Delta checklist', 'Alpha brief', 'Bravo summary', 'Echo email', 'Charlie outline']);
    expect(screen.getByRole('button', { name: 'Open Delta checklist in Write' })).toHaveTextContent(/Opened/);
  });

  it('shows only favorites in Favorites and switches views', () => {
    const { onViewChange } = renderPanel({ view: 'favorites' });
    // Newest first, as in the Library.
    expect(panelTitles()).toEqual(['Echo email', 'Charlie outline', 'Alpha brief']);
    expect(screen.getByText('3 prompts')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Prompt list' });
    expect(within(group).getByRole('button', { name: 'Favorites' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Recent' }));
    expect(onViewChange).toHaveBeenCalledWith('recent');
  });

  it('opens, inserts and favorites a prompt from its row', () => {
    const { onOpen, onInsert, onToggleFavorite } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bravo summary in Write' }));
    expect(onOpen).toHaveBeenCalledWith(library[1]);
    // Inserts the improved text when there is one, otherwise the original.
    fireEvent.click(screen.getByRole('button', { name: 'Insert Bravo summary into prompt' }));
    expect(onInsert).toHaveBeenCalledWith('Bravo draft', library[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Insert Alpha brief into prompt' }));
    expect(onInsert).toHaveBeenLastCalledWith('Alpha text', library[0]);
    const star = screen.getByRole('button', { name: 'Favorite Bravo summary' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(onToggleFavorite).toHaveBeenCalledWith(library[1]);
    expect(screen.getByRole('button', { name: 'Unfavorite Alpha brief' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains empty views', () => {
    renderPanel({ library: library.map((entry) => ({ ...entry, favorite: false })), view: 'favorites' });
    expect(screen.getByText(/No favorites yet/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    cleanup();
    renderPanel({ library: [], view: 'all' });
    expect(screen.getByText(/No saved prompts yet/)).toBeInTheDocument();
    expect(screen.getByText('0 prompts')).toBeInTheDocument();
  });
});

 it('searches title, body, collection and tags within the selected view without changing order', () => {
  const tagged = library.map(entry => ({ ...entry, tags: entry.id === 'alpha' ? ['launch'] : [] }));
  const { rerender } = renderPanel({ library: tagged });
  const search = screen.getByRole('searchbox', { name: 'Search prompts beside Write' });
  for (const [query, titles] of [['ALPHA', ['Alpha brief']], ['Bravo draft', ['Bravo summary']], ['Ops launch', ['Alpha brief']], ['outline', ['Charlie outline']]]) {
    fireEvent.change(search, { target: { value: query } }); expect(panelTitles()).toEqual(titles);
  }
  fireEvent.change(search, { target: { value: 'draft' } });
  expect(panelTitles()).toEqual(['Bravo summary', 'Alpha brief']);
  rerender(<PromptsSidePanel library={tagged} view="favorites" />);
  expect(panelTitles()).toEqual(['Alpha brief']);
  fireEvent.change(search, { target: { value: 'missing' } });
  expect(screen.getByText('No prompts match this search in the selected view.')).toBeInTheDocument();
  fireEvent.keyDown(search, { key: 'Escape' }); expect(search).toHaveValue('');
  expect(panelTitles()).toEqual(['Echo email', 'Charlie outline', 'Alpha brief']);
  fireEvent.change(search, { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(search).toHaveValue('');
});
