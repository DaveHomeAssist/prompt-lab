import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PadTab from '../PadTab.jsx';
import { PADS_KEY, PADS_SCHEMA_VERSION_KEY } from '../lib/padSchema.js';

vi.mock('../icons.jsx', () => ({ default: ({ n }) => <span>{n}</span> }));

const m = {
  border: 'border',
  text: 'text',
  textAlt: 'text-alt',
  textMuted: 'text-muted',
  btn: 'button',
  input: 'input',
};

function seedV2(name = 'Scratchpad', content = 'Legacy notes') {
  localStorage.setItem(PADS_SCHEMA_VERSION_KEY, '2');
  localStorage.setItem(PADS_KEY, JSON.stringify({
    pads: [{ id: 'default', name, content, timestamp: Date.now() }],
    activePadId: 'default',
  }));
}

describe('PadTab', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renames inline on double click and restores the previous name for an empty edit', async () => {
    seedV2('Show Notes');
    render(<PadTab m={m} notify={vi.fn()} />);

    fireEvent.doubleClick(screen.getByRole('button', { name: /Show Notes.*Legacy notes/ }));
    const input = screen.getByRole('textbox', { name: 'Rename Show Notes' });
    fireEvent.change(input, { target: { value: 'Updated Notes' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(JSON.parse(localStorage.getItem(PADS_KEY)).pads[0].name).toBe('Updated Notes'));

    fireEvent.doubleClick(screen.getByRole('button', { name: /Updated Notes.*Legacy notes/ }));
    const emptyInput = screen.getByRole('textbox', { name: 'Rename Updated Notes' });
    fireEvent.change(emptyInput, { target: { value: '   ' } });
    fireEvent.keyDown(emptyInput, { key: 'Enter' });

    expect(JSON.parse(localStorage.getItem(PADS_KEY)).pads[0].name).toBe('Updated Notes');
  });

  it('promotes and exports the portable plain-text projection', async () => {
    seedV2('Cue Notes', 'Camera one\nCamera two');
    const onPromoteToLibrary = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:pad'),
      revokeObjectURL: vi.fn(),
    });
    render(<PadTab m={m} notify={vi.fn()} onPromoteToLibrary={onPromoteToLibrary} />);

    fireEvent.click(screen.getByRole('button', { name: /Library/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Export plain text' }));

    expect(onPromoteToLibrary).toHaveBeenCalledWith('Cue Notes', 'Camera one\nCamera two');
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/plain;charset=utf-8' }));
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('uses a stacked, horizontally scrollable pad navigator at narrow widths', () => {
    seedV2();
    const { container } = render(<PadTab m={m} notify={vi.fn()} />);

    expect(container.firstChild).toHaveClass('flex-col', 'sm:flex-row');
    expect(container.querySelector('aside')).toHaveClass('w-full', 'sm:w-[210px]');
    expect(container.querySelector('aside > div:last-child')).toHaveClass('overflow-x-auto', 'sm:overflow-y-auto');
  });
});
