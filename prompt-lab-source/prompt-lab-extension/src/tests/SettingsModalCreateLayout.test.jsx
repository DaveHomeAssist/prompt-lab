import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsModal from '../modals/SettingsModal.jsx';

vi.mock('../icons.jsx', () => ({ default: () => null }));

const m = { modalBg: 'bg-black/50', modal: 'bg-slate-900', text: 'text-white', textBody: 'text-slate-100', textSub: 'text-slate-300', textMuted: 'text-slate-500', btn: 'bg-slate-800', textAlt: 'text-slate-200', surface: 'bg-slate-950', border: 'border-slate-800' };

function renderSettings(overrides = {}) {
  return render(
    <SettingsModal
      m={m}
      showNotes={false}
      setShowNotes={vi.fn()}
      density="comfortable"
      setDensity={vi.fn()}
      collections={[]}
      deleteCollection={vi.fn()}
      exportLib={vi.fn()}
      importLib={vi.fn()}
      clearLibrary={vi.fn()}
      openOptions={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

describe('SettingsModal two-pane Create toggle', () => {
  it('is absent when the surface does not offer the two-pane workspace', () => {
    renderSettings();
    expect(screen.queryByTestId('create-layout-toggle')).toBeNull();
  });

  it('switches the persisted layout between stacked and split', () => {
    const setCreateLayout = vi.fn();
    const { rerender } = renderSettings({ createLayout: 'stacked', setCreateLayout });
    const toggle = screen.getByRole('checkbox', { name: /Two-pane Create workspace/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(setCreateLayout).toHaveBeenCalledWith('split');

    rerender(
      <SettingsModal
        m={m}
        showNotes={false}
        setShowNotes={vi.fn()}
        density="comfortable"
        setDensity={vi.fn()}
        collections={[]}
        deleteCollection={vi.fn()}
        exportLib={vi.fn()}
        importLib={vi.fn()}
        clearLibrary={vi.fn()}
        openOptions={vi.fn()}
        onClose={vi.fn()}
        createLayout="split"
        setCreateLayout={setCreateLayout}
      />,
    );
    const checked = screen.getByRole('checkbox', { name: /Two-pane Create workspace/ });
    expect(checked).toBeChecked();
    fireEvent.click(checked);
    expect(setCreateLayout).toHaveBeenLastCalledWith('stacked');
  });
});
