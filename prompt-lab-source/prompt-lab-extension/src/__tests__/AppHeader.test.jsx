import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from '../AppHeader.jsx';

const noop = () => {};
const theme = {
  header: 'header',
  btn: 'button',
  textAlt: 'text-alt',
  textMuted: 'text-muted',
};

function renderHeader(overrides = {}) {
  const openBilling = vi.fn();
  render(
    <AppHeader
      m={theme}
      compact={false}
      libraryCount={0}
      colorMode="dark"
      setColorMode={noop}
      activeSection="create"
      openSection={noop}
      openCreateView={noop}
      openRunsView={noop}
      primaryView="create"
      setPrimaryView={noop}
      workspaceView="editor"
      runsView="history"
      effectiveEditorLayout="balanced"
      setEditorLayout={noop}
      createLayoutOptions={[]}
      setShowCmdPalette={noop}
      setCmdQuery={noop}
      setShowShortcuts={noop}
      setShowSettings={noop}
      billingPlan="free"
      billingLabel="Free"
      billingDisabled
      openBilling={openBilling}
      {...overrides}
    />,
  );
  return { openBilling };
}

describe('AppHeader billing presentation', () => {
  it('shows open prelaunch access instead of Upgrade for Free billing-disabled accounts', () => {
    const { openBilling } = renderHeader();

    const trigger = screen.getByTestId('billing-trigger');
    expect(trigger).toHaveTextContent('All Features Open');
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(openBilling).toHaveBeenCalledTimes(1);
  });

  it('keeps Upgrade available when billing is enabled', () => {
    renderHeader({ billingDisabled: false });

    expect(screen.getByTestId('billing-trigger')).toHaveTextContent('Upgrade');
  });

  it('hides the plan chip and Upgrade when billing UI is off (extension builds)', () => {
    const { openBilling } = renderHeader({ billingDisabled: false, billingUiEnabled: false });

    expect(screen.queryByTestId('billing-trigger')).not.toBeInTheDocument();
    expect(screen.queryByTestId('billing-plan-chip')).not.toBeInTheDocument();
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
    expect(openBilling).not.toHaveBeenCalled();
  });
});

describe('AppHeader Pro badges (product call 3)', () => {
  it('marks a locked Evaluate view with an accessible Pro badge', () => {
    renderHeader({ primaryView: 'runs', activeSection: 'evaluate', lockedRunsViews: { compare: true } });
    const compare = screen.getByRole('tab', { name: 'Compare Pro feature' });
    const badge = compare.querySelector('[data-testid="pro-badge"]');
    expect(badge).not.toBeNull();
    expect(badge).toHaveTextContent('Pro');
    expect(badge).toHaveAttribute('title', 'Pro feature');
    expect(screen.getByRole('tab', { name: 'History' }).querySelector('[data-testid="pro-badge"]')).toBeNull();
  });

  it('shows no badge when the view is unlocked (Pro, or a build without gates)', () => {
    renderHeader({ primaryView: 'runs', activeSection: 'evaluate', billingPlan: 'pro', lockedRunsViews: { compare: false } });
    expect(screen.getByRole('tab', { name: 'Compare' })).toBeInTheDocument();
    expect(screen.queryByTestId('pro-badge')).not.toBeInTheDocument();
  });
});
