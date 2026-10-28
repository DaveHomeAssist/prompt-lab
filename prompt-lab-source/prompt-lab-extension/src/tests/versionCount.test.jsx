import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createPromptEntry, getVersionCount, updatePromptEntry } from '../lib/promptSchema.js';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../PackStudioPanel.jsx', () => ({ default: () => null }));

// V-08: versions[] holds only snapshots of earlier content. The save toast
// counted the current content (length + 1) while the Library card and the
// inspector showed the snapshot count, so a first save read "version 1" in
// the toast and "0 ver" on the card.
describe('version count', () => {
  it('counts the current content as a version', () => {
    expect(getVersionCount(undefined)).toBe(1);
    expect(getVersionCount({})).toBe(1);
    expect(getVersionCount({ versions: [] })).toBe(1);
    expect(getVersionCount({ versions: [{}, {}] })).toBe(3);
  });

  it('matches the save sequence: first save is version 1, a changed save is version 2', () => {
    const first = createPromptEntry({ title: 'Count me', original: 'a', enhanced: 'first' });
    expect(getVersionCount(first)).toBe(1);
    const second = updatePromptEntry(first, { enhanced: 'second' });
    expect(second.versions).toHaveLength(1);
    expect(getVersionCount(second)).toBe(2);
    const unchanged = updatePromptEntry(second, { title: 'Renamed only' });
    expect(getVersionCount(unchanged)).toBe(2);
  });

  it('shows the same total on the Library card and in the inspector', () => {
    const now = '2026-10-27T12:00:00.000Z';
    const entry = {
      id: 'counted', title: 'Counted prompt', original: 'o', enhanced: 'current', tags: [], collection: '', useCount: 0,
      createdAt: now, updatedAt: now, metadata: {}, variants: [], testCases: [], inputs: [],
      versions: [{ id: 'v1', original: 'o', enhanced: 'earlier', savedAt: now }],
    };
    const lib = {
      library: [entry], trash: [], filtered: [entry], collections: [], saveFolders: vi.fn(), setCollections: vi.fn(), deleteCollection: vi.fn(),
      allLibTags: [], search: '', setSearch: vi.fn(), sortBy: 'newest', setSortBy: vi.fn(), activeCollection: null, setActiveCollection: vi.fn(),
      activeTag: null, setActiveTag: vi.fn(), exportLib: vi.fn(), importLib: vi.fn(), updateEntries: vi.fn(), moveEntriesToCollection: vi.fn(),
      addTagToEntries: vi.fn(), deleteEntries: vi.fn(), restoreDeleted: vi.fn(), permanentlyDelete: vi.fn(), setFavorite: vi.fn(),
      duplicateEntry: vi.fn(), del: vi.fn(), restoreVersion: vi.fn(), trackRecentAccess: vi.fn(),
    };
    render(<LibraryWorkspace lib={lib} loadEntry={vi.fn()} copy={vi.fn()} addToComposer={vi.fn()} sendToABTest={vi.fn()} onNewPrompt={vi.fn()} openBilling={vi.fn()} />);
    expect(screen.getByText('2 ver')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Counted prompt' }));
    const term = screen.getByText('Versions', { selector: 'dt' });
    expect(term.nextElementSibling).toHaveTextContent('2');
  });
});
