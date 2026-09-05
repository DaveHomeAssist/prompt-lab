import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import useABTest from '../hooks/useABTest.js';
import { callModel } from '../api.js';
import { listExperiments } from '../experimentStore.js';
import { retryPendingWrites } from '../lib/writeRecovery.js';

vi.mock('../api.js', () => ({ callModel: vi.fn() }));

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await retryPendingWrites();
});

it('preserves a completed Arena response and retries history without another provider call', async () => {
  const notify = vi.fn();
  callModel.mockResolvedValue({ content: [{ text: 'Completed response' }], provider: 'anthropic', model: 'fixture' });
  const { result } = renderHook(() => useABTest({ notify }));
  act(() => result.current.setVariant('a', (state) => ({ ...state, prompt: 'Source prompt' })));
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => { await result.current.runAB('a'); });
  expect(result.current.abA).toMatchObject({ response: 'Completed response', loading: false, error: false });
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('run history was not saved'));
  storage.mockRestore();
  await act(async () => { await retryPendingWrites(); });
  await waitFor(() => expect(result.current.evalRuns).toHaveLength(1));
  expect(result.current.evalRuns[0]).toMatchObject({ input: 'Source prompt', output: 'Completed response' });
  expect(callModel).toHaveBeenCalledTimes(1);
});

it('does not duplicate an experiment when winner save is retried', async () => {
  const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
  act(() => result.current.setVariant('a', (state) => ({ ...state, prompt: 'Source prompt', response: 'Response' })));
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => { await result.current.pickWinner('A'); });
  storage.mockRestore();
  await act(async () => { await retryPendingWrites(); });
  await act(async () => { await result.current.pickWinner('A'); });
  expect(await listExperiments()).toHaveLength(1);
  expect(callModel).not.toHaveBeenCalled();
});
