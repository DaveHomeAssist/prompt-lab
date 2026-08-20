import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PadTab from '../PadTab.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div data-testid="scratch-preview">{text}</div> }));

const theme = new Proxy({}, { get: () => '' });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Scratch workspace metadata and promotion', () => {
  it('migrates pads to schema v3 and persists pin, status, and tags', async () => {
    render(<PadTab m={theme} notify={vi.fn()} />);
    await waitFor(() => expect(localStorage.getItem('pl2-pads-schema-version')).toBe('3'));

    fireEvent.click(screen.getByTitle('Pin pad'));
    fireEvent.change(screen.getByLabelText('Scratch status'), { target: { value: 'ready' } });
    const tagInput = screen.getByPlaceholderText('Add tag + Enter');
    fireEvent.change(tagInput, { target: { value: 'research' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    const saved = JSON.parse(localStorage.getItem('pl2-pads')).pads[0];
    expect(saved).toMatchObject({ pinned: true, status: 'ready', tags: ['research'] });
  });

  it('previews markdown and promotes only the current selection with a source link', async () => {
    vi.useFakeTimers();
    const promote = vi.fn();
    render(<PadTab m={theme} notify={vi.fn()} onPromoteToLibrary={promote} />);
    const editor = screen.getByLabelText('Scratchpad');
    fireEvent.change(editor, { target: { value: '# Heading\nSelected prompt text' } });
    act(() => vi.advanceTimersByTime(700));

    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(screen.getByTestId('scratch-preview')).toHaveTextContent('Selected prompt text');
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }));

    const liveEditor = screen.getByLabelText('Scratchpad');
    liveEditor.setSelectionRange(10, 30);
    fireEvent.click(screen.getByRole('button', { name: 'Selection' }));
    expect(promote).toHaveBeenCalledWith('Scratchpad', 'Selected prompt text', expect.objectContaining({
      sourceNoteId: 'default',
      selectionOnly: true,
    }));
  });
});
