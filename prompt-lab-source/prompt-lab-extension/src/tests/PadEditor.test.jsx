import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import PadEditor from '../pad/PadEditor.jsx';
import PadToolbar from '../pad/PadToolbar.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const m = { border: 'border', text: 'text', textAlt: 'text-alt', btn: 'button', input: 'input' };
const activePad = {
  id: 'pad-1',
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Format me' }] }] },
};

function Harness({ onChange = vi.fn(), onReady = vi.fn() }) {
  const [editor, setEditor] = useState(null);
  return (
    <>
      <PadToolbar editor={editor} m={m} />
      <PadEditor activePad={activePad} onDocumentChange={onChange} onEditorReady={(value) => { setEditor(value); onReady(value); }} m={m} />
    </>
  );
}

describe('PadEditor formatting', () => {
  it('applies bold, italics, underline, heading, lists, task lists, and color through the toolbar', async () => {
    let editor;
    render(<Harness onReady={(value) => { if (value) editor = value; }} />);
    await waitFor(() => expect(editor).toBeTruthy());

    act(() => editor.commands.selectAll());
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Text color #22c55e' }));
    fireEvent.change(screen.getByLabelText('Text style'), { target: { value: 'h1' } });

    let json = editor.getJSON();
    expect(json.content[0].type).toBe('heading');
    expect(json.content[0].content[0].marks.map((mark) => mark.type)).toEqual(expect.arrayContaining(['bold', 'italic', 'underline', 'textStyle']));

    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    expect(editor.getJSON().content[0].type).toBe('bulletList');
    fireEvent.click(screen.getByRole('button', { name: 'Bullet list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    expect(editor.getJSON().content[0].type).toBe('orderedList');
    fireEvent.click(screen.getByRole('button', { name: 'Numbered list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle list' }));
    expect(editor.getJSON().content[0].type).toBe('taskList');
  });
});
