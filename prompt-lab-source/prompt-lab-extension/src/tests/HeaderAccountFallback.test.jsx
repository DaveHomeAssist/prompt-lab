import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from '../AppHeader.jsx';
import SettingsModal from '../modals/SettingsModal.jsx';
import { buildCommandActions, filterCommands } from '../lib/navigationRegistry.js';

vi.mock('../icons.jsx', () => ({ default: () => null }));
vi.mock('../constants.js', () => ({ APP_VERSION: '1.8.0-test' }));

const m = { header: '', textMuted: '', btn: '', textAlt: '', textSub: '', modalBg: '', modal: '', text: '', textBody: '', border: '' };

function renderHeader(overrides = {}) {
  const noop = vi.fn();
  return render(
    <AppHeader m={m} compact libraryCount={1} colorMode="dark" setColorMode={noop}
      activeSection="create" openSection={noop} openCreateView={noop} openRunsView={noop}
      primaryView="create" setPrimaryView={noop} workspaceView="editor" runsView="history"
      effectiveEditorLayout="editor" setEditorLayout={noop} createLayoutOptions={[]}
      setShowCmdPalette={noop} setCmdQuery={noop} setShowShortcuts={noop} setShowSettings={noop}
      renderMobileNavigation={false} {...overrides} />,
  );
}

describe('phone header account fallback (V-01)', () => {
  it('offers the secondary controls and account actions from the More menu', () => {
    const manageAccount = vi.fn();
    const signOut = vi.fn();
    const setShowShortcuts = vi.fn();
    renderHeader({ accountActions: { manageAccount, signOut }, setShowShortcuts, clerkUserButton: <button type="button">avatar</button> });
    const more = screen.getByRole('button', { name: 'More actions' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'More actions' });
    expect(panel).toHaveTextContent('Report a problem');
    fireEvent.click([...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Keyboard shortcuts'));
    expect(setShowShortcuts).toHaveBeenCalledWith(true);
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('button', { name: 'Manage account' }));
    expect(manageAccount).toHaveBeenCalledTimes(1);
  });

  it('closes the More menu with Escape', () => {
    renderHeader();
    const more = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(more);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'More actions' })).toBeNull();
  });

  it('keeps Manage account and Sign out in Settings', () => {
    const signOut = vi.fn();
    const onClose = vi.fn();
    render(<SettingsModal m={m} showNotes={false} setShowNotes={vi.fn()} density="comfortable" setDensity={vi.fn()}
      collections={[]} deleteCollection={vi.fn()} exportLib={vi.fn()} importLib={vi.fn()} clearLibrary={vi.fn()}
      openOptions={vi.fn()} onClose={onClose} account={{ manageAccount: vi.fn(), signOut }} />);
    expect(screen.getByRole('button', { name: 'Manage account' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the Settings account section when there is no signed-in account', () => {
    render(<SettingsModal m={m} showNotes={false} setShowNotes={vi.fn()} density="comfortable" setDensity={vi.fn()}
      collections={[]} deleteCollection={vi.fn()} exportLib={vi.fn()} importLib={vi.fn()} clearLibrary={vi.fn()}
      openOptions={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('settings-account')).toBeNull();
  });

  it('lists Sign Out and Manage Account in the command palette only when provided', () => {
    expect(filterCommands(buildCommandActions({}), 'sign out')).toHaveLength(0);
    const actions = buildCommandActions({ signOut: vi.fn(), manageAccount: vi.fn() });
    expect(filterCommands(actions, 'sign out').map((a) => a.label)).toEqual(['Sign Out']);
    expect(filterCommands(actions, 'account').map((a) => a.label)).toEqual(['Manage Account']);
  });
});
