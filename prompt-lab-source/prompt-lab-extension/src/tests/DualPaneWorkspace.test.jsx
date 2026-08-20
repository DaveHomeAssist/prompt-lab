import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DualPaneWorkspace from '../DualPaneWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const library = [
  {
    id: 'one',
    title: 'Source prompt',
    enhanced: 'LIBRARY CONTENT',
    tags: ['ops'],
    collection: 'Work',
    useCount: 3,
  },
  {
    id: 'two',
    title: 'Second prompt',
    enhanced: 'SECOND CONTENT\nWITH A FULL SECOND LINE',
    tags: ['writing'],
    collection: '',
  },
];

function Harness(props) {
  const [raw, setRaw] = useState('Draft text');
  return (
    <DualPaneWorkspace
      library={library}
      raw={raw}
      setRaw={setRaw}
      notify={vi.fn()}
      openEntry={vi.fn()}
      {...props}
    />
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DualPaneWorkspace', () => {
  it('inserts at the cursor, replaces the whole draft with undo, and appends', () => {
    render(<Harness />);
    const editor = screen.getByLabelText('Dual pane prompt editor');

    editor.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Insert at cursor' }));
    expect(editor).toHaveValue('DraftLIBRARY CONTENT text');

    editor.setSelectionRange(3, 10);
    fireEvent.click(screen.getByRole('button', { name: 'Replace draft' }));
    expect(editor).toHaveValue('LIBRARY CONTENT');
    expect(screen.getByRole('button', { name: 'Undo replace' })).toBeEnabled();
    expect(screen.getByText(/Undo is available/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo replace' }));
    expect(editor).toHaveValue('DraftLIBRARY CONTENT text');

    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    expect(editor.value.endsWith('\n\nLIBRARY CONTENT')).toBe(true);
  });

  it('uses a searchable listbox, keyboard selection, full preview, copy, and open actions', async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const openEntry = vi.fn();
    render(<Harness copy={copy} openEntry={openEntry} />);

    const listbox = screen.getByRole('listbox', { name: 'Library prompts' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);
    expect(within(listbox).getByRole('option', { name: /Source prompt/ })).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(within(listbox).getByRole('option', { name: /Source prompt/ }), { key: 'ArrowDown' });
    expect(within(listbox).getByRole('option', { name: /Second prompt/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByTestId('dual-selected-preview')).getByText(/WITH A FULL SECOND LINE/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => {});
    expect(copy).toHaveBeenCalledWith('SECOND CONTENT\nWITH A FULL SECOND LINE', 'Copied Second prompt.');

    fireEvent.click(screen.getByRole('button', { name: 'Open full' }));
    expect(openEntry).toHaveBeenCalledWith(expect.objectContaining({ id: 'two' }));

    fireEvent.change(screen.getByPlaceholderText('Find a prompt…'), { target: { value: 'Source' } });
    expect(within(listbox).getByRole('option', { name: /Source prompt/ })).toBeInTheDocument();
    expect(within(listbox).queryByRole('option', { name: /Second prompt/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Find a prompt…'), { target: { value: 'missing' } });
    expect(within(listbox).getByRole('status')).toHaveTextContent('No prompts match this search.');
  });

  it('supports keyboard resizing plus swap and reset layout controls', () => {
    render(<Harness />);
    const separator = screen.getByRole('separator', { name: 'Resize dual panes' });
    expect(separator).toHaveAttribute('aria-valuemin', '28');
    expect(separator).toHaveAttribute('aria-valuemax', '72');
    expect(separator).toHaveAttribute('aria-valuenow', '50');

    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '54');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '72');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '28');

    fireEvent.click(screen.getByRole('button', { name: 'Swap panes' }));
    expect(separator.closest('.pl-dual-grid')).toHaveClass('is-swapped');
    expect(separator).toHaveAttribute('aria-valuenow', '72');

    fireEvent.click(screen.getByRole('button', { name: 'Reset 50/50' }));
    expect(separator).toHaveAttribute('aria-valuenow', '50');
  });

  it('edits a controlled title, exposes dirty status, and invokes draft actions with context', () => {
    const onDraftTitleChange = vi.fn();
    const onEnhance = vi.fn();
    const onSave = vi.fn();
    const onSaveVersion = vi.fn();
    render(
      <Harness
        draftTitle="Release prompt"
        onDraftTitleChange={onDraftTitleChange}
        dirty
        autosaveStatus="saving"
        onEnhance={onEnhance}
        onSave={onSave}
        onSaveVersion={onSaveVersion}
      />,
    );

    expect(screen.getByText('Saving…')).toHaveAttribute('aria-live', 'polite');
    fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Updated title' } });
    expect(onDraftTitleChange).toHaveBeenCalledWith('Updated title');

    fireEvent.click(screen.getByRole('button', { name: 'Enhance draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as new prompt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save new version' }));

    const context = { raw: 'Draft text', title: 'Release prompt', selectedEntry: expect.objectContaining({ id: 'one' }) };
    expect(onEnhance).toHaveBeenCalledWith(context);
    expect(onSave).toHaveBeenCalledWith(context);
    expect(onSaveVersion).toHaveBeenCalledWith(context);
  });

  it('autosaves changes, reports acknowledgement failures, and retains the draft', async () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn().mockResolvedValue({ ok: false });
    render(<Harness onAutosave={onAutosave} />);
    const editor = screen.getByLabelText('Dual pane prompt editor');

    fireEvent.change(editor, { target: { value: 'Keep this unsaved draft' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(onAutosave).toHaveBeenCalledWith({ raw: 'Keep this unsaved draft', title: 'Untitled prompt' });
    expect(editor).toHaveValue('Keep this unsaved draft');
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('announces a successfully acknowledged autosave', async () => {
    vi.useFakeTimers();
    const onAutosave = vi.fn().mockResolvedValue({ ok: true });
    render(<Harness onAutosave={onAutosave} />);

    fireEvent.change(screen.getByLabelText('Draft title'), { target: { value: 'Autosaved title' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(onAutosave).toHaveBeenCalledWith({ raw: 'Draft text', title: 'Autosaved title' });
    expect(screen.getByText('Saved')).toHaveAttribute('aria-live', 'polite');
  });

  it('supports controlled compact pane routing and arrow-key tab navigation', () => {
    function ControlledHarness() {
      const [raw, setRaw] = useState('Draft text');
      const [mobilePane, setMobilePane] = useState('library');
      return (
        <DualPaneWorkspace
          library={library}
          raw={raw}
          setRaw={setRaw}
          mobilePane={mobilePane}
          onMobilePaneChange={setMobilePane}
        />
      );
    }

    render(<ControlledHarness />);
    const tablist = screen.getByRole('tablist', { name: 'Dual pane mobile view' });
    const libraryTab = screen.getByRole('tab', { name: 'Library' });
    const writeTab = screen.getByRole('tab', { name: 'Write' });
    expect(libraryTab).toHaveAttribute('aria-selected', 'true');
    expect(libraryTab).toHaveAttribute('aria-controls', 'dual-library-panel');
    expect(writeTab).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    expect(writeTab).toHaveAttribute('aria-selected', 'true');
    expect(writeTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'Write' })).toHaveClass('is-mobile-active');

    fireEvent.keyDown(tablist, { key: 'Home' });
    expect(libraryTab).toHaveAttribute('aria-selected', 'true');
  });
});
