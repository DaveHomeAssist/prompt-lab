import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from '../AppHeader.jsx';

vi.mock('../icons.jsx', () => ({
  default: () => null,
}));

vi.mock('../constants.js', () => ({
  APP_VERSION: '1.7.0-test',
}));

function renderHeader(overrides = {}) {
  const noop = vi.fn();

  return render(
    <AppHeader
      m={{
        header: 'bg-slate-900',
        textMuted: 'text-slate-400',
        btn: 'bg-slate-800',
        textAlt: 'text-slate-100',
        textSub: 'text-slate-300',
      }}
      compact={false}
      libraryCount={3}
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
      effectiveEditorLayout="editor"
      setEditorLayout={noop}
      createLayoutOptions={[]}
      setShowCmdPalette={noop}
      setCmdQuery={noop}
      setShowShortcuts={noop}
      setShowSettings={noop}
      {...overrides}
    />
  );
}

describe('AppHeader', () => {
  it('names every icon-only header control and gives each a visible tooltip', () => {
    renderHeader();
    for (const [name, title] of [
      ['Command palette ⌘K', 'Command palette (⌘K)'],
      ['Switch to light mode', 'Switch to light mode'],
      ['Keyboard shortcuts', 'Keyboard shortcuts'],
      ['Settings', 'Settings'],
    ]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('title', title);
    }
  });

  it('shows one unified set of workspace destinations', () => {
    renderHeader();

    expect(screen.getAllByRole('tablist')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Write' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Evaluate' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Scratch' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Experiments' })).not.toBeInTheDocument();
  });

  it('shows every Create sub-mode from the redesign', () => {
    renderHeader();

    expect(screen.getByRole('tab', { name: 'Write' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Compose' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dual Pane' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Build' })).not.toBeInTheDocument();
  });

  it('shows Compare and History sub-tabs when Evaluate is active', () => {
    renderHeader({ activeSection: 'evaluate', primaryView: 'runs', runsView: 'compare' });

    expect(screen.getByRole('tab', { name: 'Compare' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
  });

  it('shows a workbench-oriented utility label instead of the old create workbench copy', () => {
    renderHeader();

    expect(screen.getByText('Prompt engineering workbench')).toBeInTheDocument();
    expect(screen.queryByText('Create workbench')).not.toBeInTheDocument();
  });

  it('uses the shared ember accent for active shell controls', () => {
    renderHeader();

    expect(screen.getByRole('tab', { name: 'Write' })).toHaveClass(
      'border',
      'border-orange-300/55',
      'bg-orange-400/15',
      'text-orange-100'
    );
    expect(screen.getByRole('tab', { name: 'Write' })).toHaveClass(
      'border',
      'border-orange-300/55',
      'bg-orange-400/15',
      'text-orange-100'
    );
    expect(screen.getByRole('button', { name: 'Upgrade' })).toHaveClass(
      'bg-orange-500/90',
      'hover:bg-orange-400'
    );
  });
});


it.each([false, true])('keeps New Prompt in the shared header (compact %s)', compact => {
  const onNewPrompt = vi.fn();
  const view = renderHeader({ compact, onNewPrompt });
  const button = screen.getByRole('button', { name: 'New Prompt', exact: true });
  expect(button.closest('header')).not.toBeNull();
  fireEvent.click(button);
  expect(onNewPrompt).toHaveBeenCalledTimes(1);
  view.unmount();
  renderHeader({ compact, onNewPrompt, newPromptDisabled: true });
  expect(screen.getByRole('button', { name: 'New Prompt', exact: true })).toBeDisabled();
});

it('marks the active workspace with aria-current inside a labelled navigation landmark (V-13)', () => {
  renderHeader({ workspaceView: 'library' });
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
  const active = screen.getByRole('tab', { name: 'Library' });
  expect(nav).toContainElement(active);
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Write' })).not.toHaveAttribute('aria-current');
});
