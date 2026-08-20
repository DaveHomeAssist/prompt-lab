import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PadTab from '../PadTab.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../MarkdownPreview.jsx', () => ({ default: ({ text }) => <div data-testid="scratch-preview">{text}</div> }));

const theme = new Proxy({}, { get: () => '' });

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1024 });
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Scratch workspace v4', () => {
  it('migrates v3 notes without field loss and persists richer metadata', async () => {
    localStorage.setItem('pl2-pads-schema-version', '3');
    localStorage.setItem('pl2-pads', JSON.stringify({
      pads: [{
        id: 'legacy-note',
        name: 'Legacy research',
        content: 'Keep this content',
        timestamp: 1234,
        pinned: false,
        status: 'working',
        tags: ['legacy'],
        linkedPromptId: 'prompt-old',
      }],
      activePadId: 'legacy-note',
      revision: 2,
    }));

    render(<PadTab m={theme} notify={vi.fn()} />);
    await waitFor(() => expect(localStorage.getItem('pl2-pads-schema-version')).toBe('4'));

    expect(screen.getByLabelText('Scratchpad')).toHaveValue('Keep this content');
    fireEvent.click(screen.getByLabelText('Pin note'));
    fireEvent.change(screen.getByLabelText('Scratch status'), { target: { value: 'ready' } });
    fireEvent.change(screen.getByLabelText('Scratch color'), { target: { value: 'green' } });
    const tagInput = screen.getByPlaceholderText('Add tag + Enter');
    fireEvent.change(tagInput, { target: { value: 'research' } });
    fireEvent.keyDown(tagInput, { key: 'Enter' });

    const saved = JSON.parse(localStorage.getItem('pl2-pads')).pads[0];
    expect(saved).toMatchObject({
      id: 'legacy-note',
      content: 'Keep this content',
      pinned: true,
      status: 'ready',
      color: 'green',
      tags: ['legacy', 'research'],
      linkedPromptId: 'prompt-old',
      createdAt: 1234,
      updatedAt: expect.any(Number),
    });
    expect(saved.linkedPrompts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'prompt-old' })]));
  });

  it('supports search, explicit groups, duplicate, pin, and accessible delete confirmation', async () => {
    render(<PadTab m={theme} notify={vi.fn()} />);
    expect(screen.getByRole('heading', { name: /Pinned 0/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Recent 1/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(screen.getByRole('heading', { name: /Recent 2/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scratchpad copy' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Pin note'));
    expect(screen.getByRole('heading', { name: /Pinned 1/ })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search notes, text, tags'), { target: { value: 'copy' } });
    expect(screen.getByRole('button', { name: /Scratchpad copy/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Scratchpad Empty/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Delete note'));
    const dialog = screen.getByRole('dialog', { name: /Delete “Scratchpad copy”/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('pl2-pads')).pads).toHaveLength(1));
    expect(Object.keys(JSON.parse(localStorage.getItem('pl2-pads')).tombstones)).toHaveLength(1);
  });

  it('continues Markdown lists, supports keyboard formatting, and renders split preview', async () => {
    vi.useFakeTimers();
    render(<PadTab m={theme} notify={vi.fn()} />);
    const editor = screen.getByLabelText('Scratchpad');
    fireEvent.change(editor, { target: { value: '- first item' } });
    editor.setSelectionRange(12, 12);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(editor).toHaveValue('- first item\n- ');

    editor.setSelectionRange(2, 12);
    fireEvent.select(editor);
    fireEvent.keyDown(editor, { key: 'b', ctrlKey: true });
    expect(editor.value).toContain('**first item**');

    fireEvent.click(screen.getByRole('tab', { name: 'Split' }));
    expect(screen.getByLabelText('Live Markdown preview')).toBeInTheDocument();
    expect(screen.getByTestId('scratch-preview')).toHaveTextContent('first item');
    act(() => vi.advanceTimersByTime(700));
    expect(JSON.parse(localStorage.getItem('pl2-pads')).pads[0].content).toContain('**first item**');
  });

  it('promotes a selection with type, collection, tags, and a durable returned link while preserving the source', async () => {
    const promote = vi.fn().mockResolvedValue({ id: 'prompt-new', title: 'Saved prompt' });
    render(<PadTab m={theme} notify={vi.fn()} onPromoteToLibrary={promote} collections={['Research']} />);
    const editor = screen.getByLabelText('Scratchpad');
    fireEvent.change(editor, { target: { value: '# Heading\nSelected prompt text' } });
    editor.setSelectionRange(10, 30);
    fireEvent.select(editor);

    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Prompt Library' });
    expect(within(dialog).getByRole('radio', { name: 'Selection' })).toBeChecked();
    fireEvent.change(within(dialog).getByLabelText('Save as'), { target: { value: 'template' } });
    fireEvent.change(within(dialog).getByLabelText('Collection'), { target: { value: 'Research' } });
    fireEvent.change(within(dialog).getByLabelText('Tags'), { target: { value: 'selected, reusable' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue to save' }));

    await waitFor(() => expect(promote).toHaveBeenCalledWith('Scratchpad', 'Selected prompt text', expect.objectContaining({
      sourceNoteId: 'default',
      selectionOnly: true,
      kind: 'template',
      collection: 'Research',
      tags: ['selected', 'reusable'],
      preserveSource: true,
      onLinked: expect.any(Function),
    })));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Promote to Prompt Library' })).not.toBeInTheDocument());
    const saved = JSON.parse(localStorage.getItem('pl2-pads')).pads[0];
    expect(saved.content).toBe('# Heading\nSelected prompt text');
    expect(saved.linkedPromptId).toBe('prompt-new');
    expect(saved.linkedPrompts).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'prompt-new', selectionOnly: true, kind: 'template',
    })]));
  });

  it('keeps a failed promotion open with the note and selection intact', async () => {
    const promote = vi.fn().mockResolvedValue(null);
    render(<PadTab m={theme} notify={vi.fn()} onPromoteToLibrary={promote} />);
    const editor = screen.getByLabelText('Scratchpad');
    fireEvent.change(editor, { target: { value: 'Keep this working prompt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    const dialog = screen.getByRole('dialog', { name: 'Promote to Prompt Library' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue to save' }));

    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not save this prompt. The note and selection are still here.'));
    expect(dialog).toBeInTheDocument();
    expect(editor).toHaveValue('Keep this working prompt');
  });

  it('fills the compact viewport with the Scratch note index', () => {
    window.innerWidth = 400;
    render(<PadTab m={theme} notify={vi.fn()} />);
    expect(screen.getByRole('complementary', { name: 'Scratch note index' })).toHaveClass('w-full');
  });

  it('accepts a delayed onLinked handshake from a save panel', async () => {
    let acknowledgeLink;
    const promote = vi.fn((_title, _content, options) => {
      acknowledgeLink = options.onLinked;
      return undefined;
    });
    render(<PadTab m={theme} notify={vi.fn()} onPromoteToLibrary={promote} />);
    fireEvent.change(screen.getByLabelText('Scratchpad'), { target: { value: 'Save me later' } });
    fireEvent.click(screen.getByRole('button', { name: 'Promote' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Promote to Prompt Library' })).getByRole('button', { name: 'Continue to save' }));

    await waitFor(() => expect(acknowledgeLink).toEqual(expect.any(Function)));
    act(() => acknowledgeLink({ id: 'later-id', title: 'Later prompt' }));
    const saved = JSON.parse(localStorage.getItem('pl2-pads')).pads[0];
    expect(saved.linkedPromptId).toBe('later-id');
    expect(saved.linkedPromptTitle).toBe('Later prompt');
    expect(saved.content).toBe('Save me later');
  });

  it('sends either the current selection or whole note to each destination', async () => {
    const editorSend = vi.fn();
    const composerSend = vi.fn();
    const abSend = vi.fn();
    render(<PadTab m={theme} notify={vi.fn()} onSendToEditor={editorSend} onSendToComposer={composerSend} onSendToABTest={abSend} />);
    const editor = screen.getByLabelText('Scratchpad');
    fireEvent.change(editor, { target: { value: 'Prefix selected text suffix' } });
    editor.setSelectionRange(7, 20);
    fireEvent.select(editor);
    fireEvent.change(screen.getByLabelText('Send scope'), { target: { value: 'selection' } });

    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Composer' }));
    fireEvent.click(screen.getByRole('button', { name: 'A/B' }));
    await waitFor(() => expect(editorSend).toHaveBeenCalled());
    [editorSend, composerSend, abSend].forEach((callback) => expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      content: 'selected text',
      selectionOnly: true,
      sourceNoteId: 'default',
    })));
  });

  it('uses an index-to-editor compact flow at 400px', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 400 });
    render(<PadTab m={theme} notify={vi.fn()} />);
    const index = screen.getByLabelText('Scratch note index');
    const workspace = screen.getByLabelText('Scratch note workspace');
    expect(index).toHaveClass('flex');
    expect(workspace).toHaveClass('hidden');

    fireEvent.click(screen.getByRole('button', { name: /Scratchpad.*Empty note/ }));
    expect(index).toHaveClass('hidden');
    expect(workspace).toHaveClass('flex');
    fireEvent.click(screen.getByLabelText('Back to scratch notes'));
    expect(index).toHaveClass('flex');
  });

  it('opens an exact Library-linked source note without changing either note body', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 400 });
    localStorage.setItem('pl2-pads-schema-version', '4');
    localStorage.setItem('pl2-pads', JSON.stringify({
      pads: [
        { id: 'one', name: 'One', content: 'first body', timestamp: 10 },
        { id: 'two', name: 'Two', content: 'second body', timestamp: 20 },
      ],
      activePadId: 'one',
      revision: 1,
      tombstones: {},
    }));

    const { rerender } = render(<PadTab m={theme} notify={vi.fn()} openNoteId="one" />);
    rerender(<PadTab m={theme} notify={vi.fn()} openNoteId="two" />);

    await waitFor(() => expect(screen.getByLabelText('Scratchpad')).toHaveValue('second body'));
    expect(screen.getByLabelText('Scratch note workspace')).toHaveClass('flex');
    const stored = JSON.parse(localStorage.getItem('pl2-pads'));
    expect(stored.activePadId).toBe('two');
    expect(stored.pads.map((pad) => pad.content)).toEqual(['first body', 'second body']);
  });
});
