import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsModal from '../modals/SettingsModal.jsx';

describe('SettingsModal', () => {
  it('provides an accessible close command', () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        m={{
          modalBg: 'bg-black',
          modal: 'bg-white',
          text: 'text-black',
          textSub: 'text-gray-700',
          textBody: 'text-gray-800',
          textAlt: 'text-gray-700',
          textMuted: 'text-gray-500',
          surface: 'bg-white',
          border: 'border-gray-200',
          btn: 'bg-gray-100',
        }}
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
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
