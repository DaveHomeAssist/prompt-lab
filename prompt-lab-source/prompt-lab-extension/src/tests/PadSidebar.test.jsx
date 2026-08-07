import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PadSidebar from '../pad/PadSidebar.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const m = { border: 'border', text: 'text', textAlt: 'text-alt', textMuted: 'text-muted', btn: 'button', input: 'input' };
const payload = {
  activePadId: 'pad-1',
  pads: [{ id: 'pad-1', name: 'Show Notes', plainText: 'Cue list', updatedAt: '2026-08-05T12:00:00.000Z' }],
};

function renderSidebar(overrides = {}) {
  return render(
    <PadSidebar
      payload={payload}
      m={m}
      renamingId={null}
      renameValue=""
      onRenameValue={vi.fn()}
      onStartRename={vi.fn()}
      onCommitRename={vi.fn()}
      onCancelRename={vi.fn()}
      onSelect={vi.fn()}
      onCreate={vi.fn()}
      {...overrides}
    />,
  );
}

describe('PadSidebar inline rename', () => {
  it('starts rename on double click without changing the pad name', () => {
    const onStartRename = vi.fn();
    renderSidebar({ onStartRename });

    fireEvent.doubleClick(screen.getByRole('button', { name: /Show Notes/ }));

    expect(onStartRename).toHaveBeenCalledWith(payload.pads[0]);
  });

  it('commits with Enter or blur and cancels with Escape', () => {
    const onCommitRename = vi.fn();
    const onCancelRename = vi.fn();
    const { rerender } = render(
      <PadSidebar payload={payload} m={m} renamingId="pad-1" renameValue="Updated" onRenameValue={vi.fn()} onStartRename={vi.fn()} onCommitRename={onCommitRename} onCancelRename={onCancelRename} onSelect={vi.fn()} onCreate={vi.fn()} />,
    );
    const input = screen.getByRole('textbox', { name: 'Rename Show Notes' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommitRename).toHaveBeenCalledTimes(2);

    rerender(<PadSidebar payload={payload} m={m} renamingId="pad-1" renameValue="Updated" onRenameValue={vi.fn()} onStartRename={vi.fn()} onCommitRename={onCommitRename} onCancelRename={onCancelRename} onSelect={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename Show Notes' }), { key: 'Escape' });
    expect(onCancelRename).toHaveBeenCalledTimes(1);
  });
});
