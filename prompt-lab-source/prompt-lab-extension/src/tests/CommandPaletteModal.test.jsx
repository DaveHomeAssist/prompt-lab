import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CommandPaletteModal from '../modals/CommandPaletteModal.jsx';

const theme = { modalBg: 'bg', modal: 'modal', border: 'border', text: 'text', textSub: 'sub', textBody: 'body', textMuted: 'muted', pill: 'pill' };

function Harness({ items }) {
  const [query, setQuery] = useState('');
  const shown = items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()) || !query);
  return (
    <CommandPaletteModal m={theme} cmdQuery={query} setCmdQuery={setQuery} filteredCmds={shown} onClose={vi.fn()} />
  );
}

describe('CommandPaletteModal', () => {
  it('moves with the arrow keys and runs the highlighted result on Enter', () => {
    const openPrompt = vi.fn();
    const openSetting = vi.fn();
    render(
      <Harness items={[
        { kind: 'prompt', label: 'Quarterly briefing', detail: 'Customer note', action: openPrompt },
        { kind: 'setting', label: 'Setting: Density', action: openSetting },
      ]}
      />,
    );
    const search = screen.getByRole('combobox', { name: 'Search prompts, actions, and settings' });
    expect(screen.getByRole('region', { name: 'Prompts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(openSetting).toHaveBeenCalledTimes(1);
    expect(openPrompt).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: 'brief' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(openPrompt).toHaveBeenCalledTimes(1);
  });
});
