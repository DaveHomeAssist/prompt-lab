import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const entries = [
  {
    id: 'favorite', title: 'Favorite prompt', enhanced: 'Reusable favorite content', original: '', favorite: true,
    collection: 'Ops', tags: ['template'], useCount: 4, updatedAt: '2026-08-20T00:00:00Z', createdAt: '2026-08-20T00:00:00Z',
    metadata: { purpose: 'Handoff', status: 'active' }, versions: [], inputs: [{ key: 'topic' }],
  },
  {
    id: 'incomplete', title: 'Incomplete prompt', enhanced: 'Draft content', original: '', favorite: false,
    collection: '', tags: [], useCount: 0, updatedAt: '2026-08-19T00:00:00Z', createdAt: '2026-08-19T00:00:00Z',
    metadata: { purpose: '', status: '' }, versions: [], inputs: [],
  },
];

function makeLib() {
  return {
    library: entries,
    trash: [{ ...entries[1], id: 'trash', title: 'Deleted prompt', deletedAt: '2026-08-20T00:00:00Z' }],
    filtered: entries,
    collections: ['Ops'],
    allLibTags: ['template'],
    search: '', setSearch: vi.fn(),
    sortBy: 'newest', setSortBy: vi.fn(),
    activeCollection: null, setActiveCollection: vi.fn(),
    activeTag: null, setActiveTag: vi.fn(),
    exportLib: vi.fn(), importLib: vi.fn(),
    updateEntries: vi.fn(), moveEntriesToCollection: vi.fn(), addTagToEntries: vi.fn(), deleteEntries: vi.fn(),
    restoreDeleted: vi.fn(), permanentlyDelete: vi.fn(), setFavorite: vi.fn(), duplicateEntry: vi.fn(), del: vi.fn(), restoreVersion: vi.fn(),
  };
}

describe('LibraryWorkspace', () => {
  it('supports smart views, tile layout, and a persistent inspector', () => {
    const lib = makeLib();
    render(<LibraryWorkspace lib={lib} loadEntry={vi.fn()} copy={vi.fn()} addToComposer={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Favorites/ }));
    expect(screen.getByText('Favorite prompt')).toBeInTheDocument();
    expect(screen.queryByText('Incomplete prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Tile view'));
    fireEvent.click(screen.getByText('Favorite prompt'));
    expect(screen.getByRole('complementary', { name: 'Prompt inspector' })).toHaveTextContent('Handoff');
    expect(screen.getByRole('button', { name: 'Open in Write' })).toBeInTheDocument();
  });

  it('exposes Recently Deleted as a restore and permanent-delete workflow', () => {
    const lib = makeLib();
    render(<LibraryWorkspace lib={lib} loadEntry={vi.fn()} copy={vi.fn()} addToComposer={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Recently Deleted/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(lib.restoreDeleted).toHaveBeenCalledWith('trash');
    fireEvent.click(screen.getByLabelText('Permanently delete Deleted prompt'));
    expect(lib.permanentlyDelete).toHaveBeenCalledWith('trash');
  });
});
