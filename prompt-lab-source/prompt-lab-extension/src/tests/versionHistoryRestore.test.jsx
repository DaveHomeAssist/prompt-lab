import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VersionDiffModal from '../VersionDiffModal.jsx';

const theme = {
  modalBg: 'bg', modal: 'modal', border: 'border', text: 'text', textMuted: 'muted', textAlt: 'alt',
  textSub: 'sub', textBody: 'body', btn: 'btn', surface: 'surface', codeBlock: 'code',
  diffAdd: 'add', diffDel: 'del', diffEq: 'eq',
};

const entry = {
  id: 'prompt-1',
  title: 'Launch prompt',
  original: 'Original current',
  enhanced: 'Enhanced current text',
  notes: '',
  versions: [{
    id: 'version-1',
    savedAt: '2026-11-01T15:04:00.000Z',
    original: 'Original old',
    enhanced: 'Enhanced old text',
    notes: '',
  }],
};

describe('version history', () => {
  it('shows a timestamped side-by-side diff and restores the selected snapshot', () => {
    const onRestore = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <VersionDiffModal
        entry={entry}
        selectedIndex={0}
        onSelectIndex={vi.fn()}
        onClose={vi.fn()}
        onRestore={onRestore}
        m={theme}
      />,
    );
    const diff = screen.getByTestId('version-side-by-side-diff');
    expect(diff).toHaveTextContent('Selected version');
    expect(diff).toHaveTextContent('Current prompt');
    expect(diff).toHaveTextContent('Enhanced old text');
    expect(diff).toHaveTextContent('Enhanced current text');
    expect(document.querySelectorAll('time[datetime="2026-11-01T15:04:00.000Z"]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Restore This Version' }));
    expect(onRestore).toHaveBeenCalledWith(entry.versions[0]);
    window.confirm.mockRestore();
  });
});
