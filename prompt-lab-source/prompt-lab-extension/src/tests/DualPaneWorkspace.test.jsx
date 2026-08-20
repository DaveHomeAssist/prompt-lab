import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DualPaneWorkspace from '../DualPaneWorkspace.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const library = [
  { id: 'one', title: 'Source prompt', enhanced: 'LIBRARY CONTENT', tags: ['ops'], collection: 'Work' },
  { id: 'two', title: 'Second prompt', enhanced: 'SECOND CONTENT', tags: [], collection: '' },
];

function Harness() {
  const [raw, setRaw] = useState('Draft text');
  return <DualPaneWorkspace library={library} raw={raw} setRaw={setRaw} notify={vi.fn()} openEntry={vi.fn()} />;
}

describe('DualPaneWorkspace', () => {
  it('inserts, replaces, and appends the selected prompt into the live editor', () => {
    render(<Harness />);
    const editor = screen.getByLabelText('Dual pane prompt editor');

    editor.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(editor).toHaveValue('DraftLIBRARY CONTENT text');

    editor.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Replace selection' }));
    expect(editor.value.startsWith('LIBRARY CONTENT')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Append' }));
    expect(editor.value.endsWith('\n\nLIBRARY CONTENT')).toBe(true);
  });

  it('filters the source list and exposes compact pane switching', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('Find a prompt…'), { target: { value: 'Second' } });
    expect(screen.getByRole('button', { name: /Second prompt/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Source prompt/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Write' }));
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveAttribute('aria-selected', 'true');
  });
});
