import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PendingWritesNotice from '../PendingWritesNotice.jsx';
import { listEvalRuns, saveEvalRun } from '../experimentStore.js';
import { retryPendingWrites } from '../lib/writeRecovery.js';

beforeEach(() => localStorage.clear());
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await retryPendingWrites();
});

it('shows an unsaved record until a storage-only retry succeeds', async () => {
  render(<PendingWritesNotice m={{}} />);
  expect(screen.queryByRole('alert')).toBeNull();
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => {
    await expect(saveEvalRun({ id: 'run', output: 'completed response' })).rejects.toThrow();
  });
  expect(screen.getByRole('alert')).toHaveTextContent('1 local record has not been saved');
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving records' })); });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  spy.mockRestore();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry saving records' })); });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(await listEvalRuns()).toHaveLength(1);
  const afterSave = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(afterSave);
  expect(afterSave.defaultPrevented).toBe(false);
});
