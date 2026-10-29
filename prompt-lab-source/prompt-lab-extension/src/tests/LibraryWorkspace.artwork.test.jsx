import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibraryWorkspace from '../LibraryWorkspace.jsx';

const original = { id: 'one', title: 'Handoff', original: 'Write a handoff.', enhanced: '', tags: [], collection: '', metadata: { artwork: { icon: 'Star' }, owner: 'Original owner', purpose: 'Preserve me' }, versions: [] };
let save;
function Harness() {
  const [library, setLibrary] = useState([original]);
  const lib = {
    library, trash: [{ ...original, id: 'deleted', title: 'Deleted handoff', deletedAt: new Date().toISOString() }], filtered: library, collections: [], allLibTags: [],
    search: '', setSearch: vi.fn(), sortBy: 'newest', setSortBy: vi.fn(),
    activeCollection: null, setActiveCollection: vi.fn(), activeTag: null, setActiveTag: vi.fn(),
    exportLib: vi.fn(), importLib: vi.fn(), setFavorite: vi.fn(), trackRecentAccess: vi.fn(),
    saveEntryDetails: async (id, update) => {
      const result = await save(id, update);
      if (result) setLibrary(current => current.map(entry => entry.id === id ? update(entry) : entry));
      return result;
    },
  };
  return <><LibraryWorkspace m={{}} lib={lib} loadEntry={vi.fn()} copy={vi.fn()} /><output data-testid="library">{JSON.stringify(library)}</output></>;
}
beforeEach(() => {
  localStorage.clear(); save = vi.fn().mockResolvedValue(true);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const open = () => { fireEvent.click(screen.getByRole('button', { name: 'Change artwork for Handoff' })); return screen.getByRole('dialog', { name: 'Artwork for Handoff' }); };

describe('card artwork persistence', () => {
  it('closes on Escape without forwarding app shortcuts', () => {
    render(<Harness />); const dialog = open();
    const outer = vi.fn(); window.addEventListener('keydown', outer);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Artwork for Handoff' })).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });
  it('keeps deleted prompts read-only', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /Recently Deleted/ }));
    expect(screen.getByRole('button', { name: 'Change artwork for Deleted handoff' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add image for Deleted handoff' })).not.toBeInTheDocument();
  });
  it('does not apply an invalid emoji or acknowledge a pending save', async () => {
    render(<Harness />); const dialog = open();
    fireEvent.change(within(dialog).getByLabelText('Prompt artwork emoji'), { target: { value: 'two words' } });
    expect(within(dialog).getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Prompt artwork emoji'), { target: { value: '🧪' } });
    let resolve; save.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByTestId('library')).not.toHaveTextContent('🧪');
    resolve(true);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Artwork for Handoff' })).not.toBeInTheDocument());
    expect(screen.getByTestId('library')).toHaveTextContent('🧪');
  });
  it.each(['List view', 'Tile view', 'Compact view', 'Gallery view'])('opens independently in %s and Cancel discards the draft', view => {
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: view }));
    const dialog = open();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prompt artwork: Clock', exact: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Save details', exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('library')).toHaveTextContent('Star');
  });
  it('keeps failed artwork for retry and rebases the inspector without saving its pending fields', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Handoff' }));
    const owner = screen.getByLabelText('Owner'); fireEvent.change(owner, { target: { value: 'Pending owner' } });
    save.mockResolvedValueOnce(false).mockResolvedValue(true);
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText('Prompt artwork emoji'), { target: { value: '👩🏽‍💻' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('not saved'));
    expect(screen.getByTestId('library')).toHaveTextContent('Original owner');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Artwork for Handoff' })).not.toBeInTheDocument());
    expect(owner).toHaveValue('Pending owner');
    expect(screen.getByTestId('library')).toHaveTextContent('Original owner');
    expect(screen.getByTestId('library')).toHaveTextContent('👩🏽‍💻');
    fireEvent.click(screen.getByRole('button', { name: 'Save details', exact: true }));
    await waitFor(() => expect(screen.getByTestId('library')).toHaveTextContent('Pending owner'));
    expect(screen.getByTestId('library')).toHaveTextContent('👩🏽‍💻');
    expect(screen.getByTestId('library')).toHaveTextContent('Preserve me');
  });
});
