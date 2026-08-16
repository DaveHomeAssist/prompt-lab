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
});
