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
