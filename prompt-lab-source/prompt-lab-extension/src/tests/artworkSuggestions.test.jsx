import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestArtwork } from '../lib/artworkSuggestions.js';
import { ARTWORK_ICONS, safeArtwork, safeEmoji } from '../lib/libraryPresentation.js';
import { ArtworkControls } from '../ArtworkPicker.jsx';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

describe('local artwork suggestions', () => {
  it('ranks title and tag themes above body words and pairs emoji with a bundled icon', () => {
    const choices = suggestArtwork({ title: 'Refactor the API client', text: 'Summarize the review findings first.', tags: ['code'] });
    expect(choices.slice(0, 2)).toEqual([{ icon: '', image: '', emoji: '💻' }, { icon: 'Braces', image: '' }]);
    expect(choices[2]).toEqual({ icon: '', image: '', emoji: '🔍' });
    choices.forEach((choice) => {
      expect(safeArtwork(choice)).toEqual(choice.emoji ? { icon: '', image: '', emoji: choice.emoji } : choice);
      if (choice.icon) expect(ARTWORK_ICONS).toContain(choice.icon);
      if (choice.emoji) expect(safeEmoji(choice.emoji)).toBe(choice.emoji);
    });
  });

  it('returns nothing for empty or theme-less prompts and respects the limit', () => {
    expect(suggestArtwork({})).toEqual([]);
    expect(suggestArtwork({ title: 'Untitled Prompt', text: 'Hello there.' })).toEqual([]);
    expect(suggestArtwork({ title: 'Write and test the deploy script for the data table' }, { limit: 3 })).toHaveLength(3);
  });

  it('leaves out the artwork already chosen', () => {
    const choices = suggestArtwork({ title: 'Draft a launch email' }, { current: { emoji: '✍️' } });
    expect(choices.some((choice) => choice.emoji === '✍️')).toBe(false);
    expect(choices.some((choice) => choice.icon === 'FileText')).toBe(true);
  });
});

describe('suggestions in the artwork controls', () => {
  it('applies a suggestion only when picked and hides the row when there are none', () => {
    function Controls({ suggestions }) {
      const [value, setValue] = useState({ icon: 'Star' });
      return <><ArtworkControls value={value} onChange={setValue} label="Prompt artwork" suggestions={suggestions} /><output>{JSON.stringify(value)}</output></>;
    }
    const { unmount } = render(<Controls suggestions={suggestArtwork({ title: 'Debug the regex' })} />);
    const group = screen.getByRole('group', { name: 'Prompt artwork suggestions' });
    expect(screen.getByText('Suggested for this prompt')).toBeInTheDocument();
    expect(document.querySelector('output').textContent).toBe('{"icon":"Star"}');
    fireEvent.click(within(group).getByRole('button', { name: 'Use suggested Braces' }));
    expect(JSON.parse(document.querySelector('output').textContent)).toEqual({ icon: 'Braces', image: '' });
    unmount();
    render(<Controls suggestions={[]} />);
    expect(screen.queryByText('Suggested for this prompt')).not.toBeInTheDocument();
  });
});

describe('suggestions in the Library card popover', () => {
  const entry = { id: 'one', title: 'Handoff', original: 'Write a handoff email.', enhanced: '', tags: [], collection: '', metadata: { artwork: { icon: 'Star' } }, versions: [] };
  let save;
  function Harness() {
    const [library, setLibrary] = useState([entry]);
    const lib = {
      library, trash: [], filtered: library, collections: [], allLibTags: [],
      search: '', setSearch: vi.fn(), sortBy: 'newest', setSortBy: vi.fn(),
      activeCollection: null, setActiveCollection: vi.fn(), activeTag: null, setActiveTag: vi.fn(),
      exportLib: vi.fn(), importLib: vi.fn(), setFavorite: vi.fn(), trackRecentAccess: vi.fn(),
      saveEntryDetails: async (id, update) => {
        const result = await save(id, update);
        if (result) setLibrary((current) => current.map((row) => (row.id === id ? update(row) : row)));
        return result;
      },
    };
    return <><LibraryWorkspace m={{}} lib={lib} loadEntry={vi.fn()} copy={vi.fn()} /><output data-testid="library">{JSON.stringify(library)}</output></>;
  }
  beforeEach(() => {
    save = vi.fn().mockResolvedValue(true);
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  });

  it('offers prompt-based artwork and saves the picked suggestion through Apply only', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Change artwork for Handoff' }));
    const dialog = screen.getByRole('dialog', { name: 'Artwork for Handoff' });
    const group = within(dialog).getByRole('group', { name: 'Prompt artwork suggestions' });
    fireEvent.click(within(group).getByRole('button', { name: 'Use suggested ✍️' }));
    expect(save).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('button', { name: 'Use suggested ✍️' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Artwork for Handoff' })).not.toBeInTheDocument());
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(screen.getByTestId('library').textContent)[0].metadata.artwork).toMatchObject({ emoji: '✍️' });
  });
});
