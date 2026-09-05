import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import WorkspaceImportModal from '../modals/WorkspaceImportModal.jsx';

afterEach(cleanup);

it('offers Close instead of an executable retry for an invalidated partial import', () => {
  const onRetry = vi.fn();
  const onClose = vi.fn();
  render(<WorkspaceImportModal m={{}} applying={false} onRetry={onRetry} onClose={onClose}
    preview={{ fileName: 'backup.json', partial: true, invalidated: true, completedStages: ['Library'], error: 'Destination cleared.' }} />);
  const retry = screen.getByRole('button', { name: 'Retry remaining stages' });
  expect(retry).toBeDisabled();
  fireEvent.click(retry);
  expect(onRetry).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('previously saved records are not undone');
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  expect(onClose).toHaveBeenCalledOnce();
});
