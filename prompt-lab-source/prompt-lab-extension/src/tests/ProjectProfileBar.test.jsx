import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProjectProfileBar from '../ProjectProfileBar.jsx';

function profileState(overrides = {}) {
  return {
    profiles: [],
    active: null,
    pickerOpen: true,
    previewOpen: false,
    managerOpen: false,
    runDisabled: false,
    preamble: '',
    error: '',
    setPickerOpen: vi.fn(),
    closePicker: vi.fn(),
    openManager: vi.fn(),
    setPreviewOpen: vi.fn(),
    setRunDisabled: vi.fn(),
    select: vi.fn(),
    ...overrides,
  };
}

describe('ProjectProfileBar', () => {
  it('keeps the picker inside the themed shell and offers Create a profile when empty', () => {
    const state = profileState();
    render(
      <div className="pl-app-shell" data-theme="light">
        <ProjectProfileBar state={state} />
      </div>,
    );
    const menu = screen.getByRole('listbox', { name: 'Project profiles' });
    expect(menu.closest('.pl-app-shell[data-theme="light"]')).not.toBeNull();
    expect(menu).toHaveClass('pl-profile-menu');
    fireEvent.click(screen.getByRole('button', { name: 'Create a profile' }));
    expect(state.openManager).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option', { name: 'None' })).not.toBeInTheDocument();
  });

  it('lists saved profiles in the dark shell without the empty-state button', () => {
    const profile = { id: 'p1', name: 'Notes', emoji: '', color: '', instructions: '', example: false };
    render(
      <div className="pl-app-shell" data-theme="dark">
        <ProjectProfileBar state={profileState({ profiles: [profile], active: profile })} />
      </div>,
    );
    const menu = screen.getByRole('listbox', { name: 'Project profiles' });
    expect(menu.closest('.pl-app-shell[data-theme="dark"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Create a profile' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  });
});
