import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EvaluateViewTabs from '../EvaluateViewTabs.jsx';

describe('EvaluateViewTabs', () => {
  it('uses an underline tablist instead of a second pill row', () => {
    const openRunsView = vi.fn();
    const { container } = render(
      <EvaluateViewTabs runsView="history" openRunsView={openRunsView} lockedRunsViews={{ compare: true }} />,
    );
    const list = screen.getByRole('tablist', { name: 'Evaluate views' });
    expect(list).toHaveClass('pl-subtabs');
    expect(list.className).not.toContain('pl-scroll-row');
    expect(container.querySelector('.pl-tab-btn')).toBeNull();
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    const compare = screen.getByRole('tab', { name: 'Compare Pro feature' });
    expect(compare).toHaveAttribute('aria-selected', 'false');
    expect(compare).toHaveAttribute('aria-controls', 'evaluate-panel-compare');
    fireEvent.click(compare);
    expect(openRunsView).toHaveBeenCalledWith('compare');
  });

  it('omits the Pro badge when Compare is unlocked', () => {
    render(<EvaluateViewTabs runsView="compare" openRunsView={vi.fn()} lockedRunsViews={{ compare: false }} />);
    expect(screen.getByRole('tab', { name: 'Compare' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('pro-badge')).not.toBeInTheDocument();
  });
});
