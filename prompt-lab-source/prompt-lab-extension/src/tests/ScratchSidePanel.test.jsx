import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScratchSidePanel from '../ScratchSidePanel.jsx';
import { SCRATCH_KEY, SCRATCH_SCHEMA_VERSION_KEY } from '../lib/scratchSchema.js';
import { clearUnsavedScratchDraft } from '../lib/scratchUnsavedDraft.js';

const NOW = Date.now();

function seed() {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify({
    pads: [
      { id: 'a', name: 'Ideas', content: 'First idea', updatedAt: NOW - 60_000, timestamp: NOW - 60_000 },
      { id: 'b', name: 'Pinned plan', content: 'Plan text', pinned: true, updatedAt: NOW - 120_000, timestamp: NOW - 120_000 },
    ],
    activePadId: 'a',
    revision: 1,
  }));
  localStorage.setItem(SCRATCH_SCHEMA_VERSION_KEY, '4');
}

const stored = () => JSON.parse(localStorage.getItem(SCRATCH_KEY));
const storedPad = (id) => stored().pads.find((pad) => pad.id === id);
const editor = () => screen.getByRole('textbox', { name: 'Scratch note text' });
const list = () => screen.getByRole('navigation', { name: 'Scratch notes' });

function renderPanel(props = {}) {
  const handlers = { onInsert: vi.fn(), onOpenInScratch: vi.fn(), onClose: vi.fn(), notify: vi.fn() };
  const view = render(<ScratchSidePanel m={{}} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

// Another tab writes Scratch storage, then this tab hears about it.
function writeFromOtherTab(next) {
  localStorage.setItem(SCRATCH_KEY, JSON.stringify(next));
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: SCRATCH_KEY, newValue: JSON.stringify(next) }));
  });
}

// Every storage write fails, as when localStorage is full.
const failWrites = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
  throw new Error('QuotaExceededError');
});

beforeEach(() => { localStorage.clear(); seed(); clearUnsavedScratchDraft(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('ScratchSidePanel', () => {
  it('shows the active note and one-line rows with pinned notes first', () => {
    renderPanel();
    expect(editor()).toHaveValue('First idea');
    const rows = within(list()).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Pinned plan'),
      expect.stringContaining('Ideas'),
    ]);
    rows.forEach((row) => expect(row).toHaveAttribute('data-density', 'compact'));
    expect(within(list()).getByRole('button', { name: /Ideas/ })).toHaveAttribute('aria-current', 'page');
  });

  it('autosaves typing to Scratch storage', () => {
    vi.useFakeTimers();
    renderPanel();
    fireEvent.change(editor(), { target: { value: 'First idea, expanded' } });
    expect(storedPad('a').content).toBe('First idea');
    act(() => { vi.advanceTimersByTime(600); });
    expect(storedPad('a').content).toBe('First idea, expanded');
  });

  it('saves pending text before switching notes and remembers the active note', () => {
    renderPanel();
    fireEvent.change(editor(), { target: { value: 'Unsaved edit' } });
    fireEvent.click(within(list()).getByRole('button', { name: /Pinned plan/ }));
    expect(storedPad('a').content).toBe('Unsaved edit');
    expect(stored().activePadId).toBe('b');
    expect(editor()).toHaveValue('Plan text');
  });

  it('creates and activates a new empty note', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New Scratch note' }));
    expect(stored().pads).toHaveLength(3);
    expect(stored().activePadId).not.toMatch(/^[ab]$/);
    expect(editor()).toHaveValue('');
  });

  it('inserts the whole note, or only the selection, into the prompt', () => {
    const { onInsert } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Insert note into prompt' }));
    expect(onInsert).toHaveBeenLastCalledWith('First idea');

    editor().setSelectionRange(0, 5);
    fireEvent.select(editor());
    fireEvent.click(screen.getByRole('button', { name: 'Insert selection into prompt' }));
    expect(onInsert).toHaveBeenLastCalledWith('First');
  });

  it('saves before opening the note in the full Scratch destination', () => {
    const { onOpenInScratch } = renderPanel();
    fireEvent.change(editor(), { target: { value: 'Carry this over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open this note in Scratch' }));
    expect(storedPad('a').content).toBe('Carry this over');
    expect(onOpenInScratch).toHaveBeenCalledWith('a');
  });

  it('saves pending text when it closes or unmounts', () => {
    const { onClose, unmount } = renderPanel();
    fireEvent.change(editor(), { target: { value: 'Closing edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close Scratch panel' }));
    expect(onClose).toHaveBeenCalled();
    expect(storedPad('a').content).toBe('Closing edit');

    fireEvent.change(editor(), { target: { value: 'Unmount edit' } });
    unmount();
    expect(storedPad('a').content).toBe('Unmount edit');
  });

  it('does not overwrite unreadable notes and can retry loading', () => {
    localStorage.setItem(SCRATCH_KEY, '{broken');
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Notes could not be read');
    expect(editor()).toHaveAttribute('readonly');
    fireEvent.change(editor(), { target: { value: 'ignored' } });
    expect(localStorage.getItem(SCRATCH_KEY)).toBe('{broken');

    seed();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading notes' }));
    expect(editor()).toHaveValue('First idea');
    expect(editor()).not.toHaveAttribute('readonly');
  });

  it('closes on Escape only when it floats over the editor', () => {
    const first = renderPanel();
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(first.onClose).not.toHaveBeenCalled();
    cleanup();

    const overlay = renderPanel({ overlay: true });
    fireEvent.keyDown(editor(), { key: 'Escape' });
    expect(overlay.onClose).toHaveBeenCalled();
  });

  it('shows a change made in another tab when nothing is pending here', () => {
    renderPanel();
    const next = { ...stored(), revision: 5, pads: stored().pads.map((pad) => (pad.id === 'a' ? { ...pad, content: 'From the other tab' } : pad)) };
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SCRATCH_KEY, newValue: JSON.stringify(next) }));
    });
    expect(editor()).toHaveValue('From the other tab');
  });

  it('keeps its own note when another tab selects a different one', () => {
    renderPanel();
    writeFromOtherTab({ ...stored(), revision: 5, activePadId: 'b' });
    expect(editor()).toHaveValue('First idea');
    fireEvent.blur(editor());
    expect(storedPad('b').content).toBe('Plan text');

    fireEvent.change(editor(), { target: { value: 'Still my note' } });
    fireEvent.blur(editor());
    expect(storedPad('a').content).toBe('Still my note');
    expect(storedPad('b').content).toBe('Plan text');
  });

  it('moves to the other tab\'s note when its own note was removed there', () => {
    renderPanel();
    writeFromOtherTab({ ...stored(), revision: 5, activePadId: 'b', pads: stored().pads.filter((pad) => pad.id !== 'a') });
    expect(editor()).toHaveValue('Plan text');
    fireEvent.change(editor(), { target: { value: 'Plan, revised' } });
    fireEvent.blur(editor());
    expect(storedPad('b').content).toBe('Plan, revised');
  });

  it('keeps text that fails to save on close and brings it back on reopen', () => {
    const first = renderPanel();
    fireEvent.change(editor(), { target: { value: 'Unsaved while full' } });
    const writes = failWrites();
    fireEvent.click(screen.getByRole('button', { name: 'Close Scratch panel' }));
    expect(first.onClose).toHaveBeenCalled();
    first.unmount();
    expect(first.notify).toHaveBeenCalledTimes(1);
    expect(first.notify).toHaveBeenCalledWith(expect.stringContaining('comes back when you reopen'));
    expect(storedPad('a').content).toBe('First idea');

    writes.mockRestore();
    renderPanel();
    expect(editor()).toHaveValue('Unsaved while full');
    expect(storedPad('a').content).toBe('Unsaved while full');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('keeps unsaved text when something outside the panel closes it', () => {
    const first = renderPanel();
    fireEvent.change(editor(), { target: { value: 'Closed from the context bar' } });
    const writes = failWrites();
    first.unmount();
    expect(first.notify).toHaveBeenCalledWith(expect.stringContaining('comes back when you reopen'));
    writes.mockRestore();

    // Another tab removes the note meanwhile; reopening restores it with the text.
    localStorage.setItem(SCRATCH_KEY, JSON.stringify({ ...stored(), revision: 7, activePadId: 'b', pads: stored().pads.filter((pad) => pad.id !== 'a') }));
    renderPanel();
    expect(editor()).toHaveValue('Closed from the context bar');
    expect(storedPad('a').content).toBe('Closed from the context bar');
    expect(storedPad('b').content).toBe('Plan text');
  });
});

describe('ScratchSidePanel placement', () => {
  beforeEach(() => { localStorage.clear(); seed(); });
  afterEach(() => cleanup());

  it('sits above the phone navigation bar only when it floats', () => {
    const { rerender } = render(<ScratchSidePanel m={{}} overlay aboveMobileNav />);
    const panel = screen.getByRole('complementary', { name: 'Scratch notes beside Write' });
    expect(panel).toHaveClass('is-overlay', 'is-above-mobile-nav');
    rerender(<ScratchSidePanel m={{}} aboveMobileNav />);
    expect(panel).not.toHaveClass('is-above-mobile-nav');
  });
});
