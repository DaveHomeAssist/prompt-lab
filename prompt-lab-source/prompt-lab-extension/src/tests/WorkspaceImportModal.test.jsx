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

it('names the page holding an unresolved conflict and jumps to it from any page', () => {
  const entry = (id, title) => ({ id, title, enhanced: `${title} body` });
  const rows = Array.from({ length: 22 }, (_, index) => ({ entry: entry(`p${index}`, `Prompt ${index}`), kind: 'new', conflicts: [], choice: { action: 'keep' } }));
  rows[3] = { entry: entry('p3', 'Shared title'), kind: 'conflict', conflicts: [{ id: 'old', title: 'Shared title', targetSource: 'existing' }], choice: null };
  const plan = { importedCount: 21, replacedCount: 0, skippedCount: 0, runs: [], testCases: [], trash: [], warnings: [] };
  render(<WorkspaceImportModal m={{}} applying={false} onChoice={vi.fn()} onApply={vi.fn()} onClose={vi.fn()}
    preview={{ fileName: 'backup.json', rows, unresolved: 1, plan, error: '' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Next prompts' }));
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 conflict choice required on page 1.');
  expect(screen.getByRole('button', { name: 'Apply import' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Jump to unresolved' }));
  expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: 'Conflict action for Shared title' });
  expect(select).toHaveFocus();
  expect(screen.getByText('Title or ID conflict · choice required')).toBeInTheDocument();
});
