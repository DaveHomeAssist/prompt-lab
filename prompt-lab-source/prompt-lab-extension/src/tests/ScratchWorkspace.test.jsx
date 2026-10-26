import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ScratchWorkspace from '../ScratchWorkspace.jsx';
import { SCRATCH_KEY, SCRATCH_SCHEMA_VERSION_KEY } from '../lib/scratchSchema.js';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('keeps the readable note visible during failed migration and retries saving it', () => {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({
    pads: [{ id: 'note', name: 'Research', content: 'Recover this note', timestamp: 10 }],
    activePadId: 'note',
  }));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '3');
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  render(<ScratchWorkspace m={{}} notify={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Focus note' }));
  expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue('Recover this note');
  expect(screen.getByText(/Save failed/)).toBeInTheDocument();
  spy.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
  expect(screen.queryByText(/Save failed/)).toBeNull();
  expect(JSON.parse(localStorage.getItem(SCRATCH_KEY)).pads[0]).toMatchObject({ id: 'note', content: 'Recover this note' });
  expect(localStorage.getItem(SCRATCH_SCHEMA_VERSION_KEY)).toBe('4');
});

it('does not overwrite unreadable stored notes and offers loading retry', () => {
  localStorage.setItem(SCRATCH_KEY, '{broken');
  render(<ScratchWorkspace m={{}} notify={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveAttribute('readonly');
  expect(localStorage.getItem(SCRATCH_KEY)).toBe('{broken');
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({ pads: [{ id: 'fixed', content: 'Recovered' }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue('Recovered');
  expect(screen.getByRole('textbox', { name: 'Scratchpad' })).not.toHaveAttribute('readonly');
});

function seedTwoNotes() {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({
    pads: [
      { id: 'one', name: 'Alpha note', content: 'Alpha body text', timestamp: Date.now() - 60_000 },
      { id: 'two', name: 'Beta note', content: 'Beta body text', timestamp: Date.now() - 120_000 },
    ],
    activePadId: 'one',
  }));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '4');
}

it('lists notes as one-line rows by default and remembers the Detailed choice', () => {
  seedTwoNotes();
  render(<ScratchWorkspace m={{}} notify={vi.fn()} />);
  const index = screen.getByRole('complementary', { name: 'Scratch note index' });
  const row = () => index.querySelector('button[data-density]');
  expect(row()).toHaveAttribute('data-density', 'compact');
  expect(index).not.toHaveTextContent('Beta body text');

  fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
  expect(row()).toHaveAttribute('data-density', 'detailed');
  expect(index).toHaveTextContent('Beta body text');
  expect(JSON.parse(localStorage.getItem('pl2-scratch-list-density'))).toBe('detailed');
});

it('resizes the note index by keyboard and remembers the width', () => {
  seedTwoNotes();
  render(<ScratchWorkspace m={{}} notify={vi.fn()} />);
  const index = screen.getByRole('complementary', { name: 'Scratch note index' });
  const handle = screen.getByRole('separator', { name: 'Resize note list' });
  expect(index).toHaveStyle({ width: '240px' });
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(index).toHaveStyle({ width: '264px' });
  expect(JSON.parse(localStorage.getItem('pl2-scratch-index-width'))).toBe(264);
});

it('opens a requested note in Focus when asked', () => {
  seedTwoNotes();
  const { container } = render(<ScratchWorkspace m={{}} notify={vi.fn()} openNoteId="two" focusOpenedNote />);
  expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue('Beta body text');
  expect(container.querySelector('[data-note-focused]')).toHaveAttribute('data-note-focused', 'true');
});

it('opens a requested note without Focus by default', () => {
  seedTwoNotes();
  const { container } = render(<ScratchWorkspace m={{}} notify={vi.fn()} openNoteId="two" />);
  expect(container.querySelector('[data-note-focused]')).toHaveAttribute('data-note-focused', 'false');
});
