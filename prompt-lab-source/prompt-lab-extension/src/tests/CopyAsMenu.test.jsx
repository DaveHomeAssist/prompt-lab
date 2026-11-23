import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CopyAsMenu from '../CopyAsMenu.jsx';

vi.mock('../RunCostEstimate.jsx', () => ({
  readActiveModel: vi.fn(async () => ({ model: '', provider: '' })),
}));

describe('CopyAsMenu', () => {
  it('opens upward inside the pinned Write footer', () => {
    render(
      <div className="pl-write-column is-pinned-actions">
        <CopyAsMenu text="Hello" onCopy={vi.fn()} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Copy as/ }));
    const menu = screen.getByRole('menu', { name: 'Copy as' });
    expect(menu).toHaveClass('bottom-full');
    expect(menu).not.toHaveClass('top-full');
    expect(screen.getByRole('menuitem', { name: 'Plain text' })).toBeInTheDocument();
  });

  it('opens downward outside the pinned footer', () => {
    render(<CopyAsMenu text="Hello" onCopy={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Copy as/ }));
    expect(screen.getByRole('menu', { name: 'Copy as' })).toHaveClass('top-full');
  });
});
