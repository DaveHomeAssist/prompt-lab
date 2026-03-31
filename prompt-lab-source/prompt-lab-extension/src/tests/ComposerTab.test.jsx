import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ComposerTab from '../ComposerTab.jsx';

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

const theme = {
  text: 'text-slate-100',
  textMuted: 'text-slate-400',
  textSub: 'text-slate-300',
  textAlt: 'text-slate-100',
  textBody: 'text-slate-100',
  border: 'border-slate-700',
  codeBlock: 'bg-slate-800',
  input: 'bg-slate-950 text-slate-100 border-slate-700',
  btn: 'bg-slate-800',
  dangerBtn: 'bg-red-900 text-red-100',
  draggable: 'bg-slate-900',
  dropOver: 'border-violet-500 bg-violet-500/10',
  dropZone: 'border-slate-700 bg-slate-900',
  composedBlock: 'bg-slate-800',
};

function renderComposer(overrides = {}) {
  const addToComposer = vi.fn();
  const library = [
    {
      id: 'popular',
      title: 'Fast PR Summary',
      enhanced: 'Summarize a pull request for a reviewer.',
      collection: 'Research',
      tags: ['Analysis'],
      useCount: 5,
    },
    {
      id: 'starter',
      title: 'Writing Outline',
      enhanced: 'Draft a structured outline before writing.',
      collection: 'Writing',
      tags: ['Writing'],
      useCount: 1,
    },
    {
      id: 'specialist',
      title: 'Migration Checklist',
      enhanced: 'Generate a migration checklist for a legacy service.',
      collection: 'Operations',
      tags: ['Infra'],
      useCount: 0,
    },
  ];

  render(
    <ComposerTab
      m={theme}
      library={library}
      composerBlocks={[]}
      setComposerBlocks={vi.fn()}
      addToComposer={addToComposer}
      notify={vi.fn()}
      copy={vi.fn()}
      setRaw={vi.fn()}
      setTab={vi.fn()}
      compact={false}
      pageScroll={false}
      {...overrides}
    />
  );

  return { addToComposer, library };
}

describe('ComposerTab', () => {
  it('surfaces starter and specialized groupings with differentiated add buttons', () => {
    const { addToComposer, library } = renderComposer();
    const popularButtons = screen.getAllByRole('button', { name: 'Add Popular' });
    const starterButtons = screen.getAllByRole('button', { name: 'Add Starter' });
    const blockButtons = screen.getAllByRole('button', { name: 'Add Block' });

    expect(screen.getAllByText('Start Here').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Specialized Library').length).toBeGreaterThan(0);
    expect(popularButtons.length).toBeGreaterThan(0);
    expect(starterButtons.length).toBeGreaterThan(0);
    expect(blockButtons.length).toBeGreaterThan(0);

    fireEvent.click(popularButtons[0]);

    expect(addToComposer).toHaveBeenCalledWith(library[0]);
  });
});
