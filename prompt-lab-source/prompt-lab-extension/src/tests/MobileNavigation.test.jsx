import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MobileNavigation from '../MobileNavigation.jsx';

// V-14: the compact tab bar used "Dual" while the desktop tabs, shortcuts and
// command palette say "Dual Pane". One name everywhere.
describe('MobileNavigation labels', () => {
  it('names the split workspace "Dual Pane", matching the desktop tabs', () => {
    render(
      <MobileNavigation
        primaryView="create"
        workspaceView="split"
        openCreateView={vi.fn()}
        openSection={vi.fn()}
        setPrimaryView={vi.fn()}
      />,
    );
    const dual = screen.getByRole('button', { name: 'Dual Pane' });
    expect(dual).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'Dual' })).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(['Write', 'Library', 'Compose', 'Dual Pane', 'Evaluate', 'Scratch']);
  });
});
