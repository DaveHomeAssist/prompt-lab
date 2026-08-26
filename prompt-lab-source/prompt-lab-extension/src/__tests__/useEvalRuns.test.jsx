import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useEvalRuns from '../hooks/useEvalRuns.js';

const { listEvalRuns, patchEvalRun } = vi.hoisted(() => ({
  listEvalRuns: vi.fn(),
  patchEvalRun: vi.fn(),
}));

vi.mock('../experimentStore', () => ({
  EVAL_RUN_SIGNAL_KEY: 'pl2-eval-run-signal',
  listEvalRuns,
  patchEvalRun,
}));

describe('useEvalRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvalRuns.mockResolvedValue([]);
    patchEvalRun.mockResolvedValue(null);
  });

  it('refreshEvalRuns calls listEvalRuns with promptId filter', async () => {
    const { result } = renderHook(() => useEvalRuns({ editingId: 'prompt-1', tab: 'library' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenCalledWith({ limit: 200, promptId: 'prompt-1' });
  });

  it('refreshEvalRuns without promptId uses mode:\'enhance\' filter', async () => {
    const { result } = renderHook(() => useEvalRuns({ editingId: null, tab: 'library' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenCalledWith({ limit: 200, mode: 'enhance' });
  });

  it('effect triggers refresh when tab is editor', async () => {
    renderHook(() => useEvalRuns({ editingId: 'prompt-9', tab: 'editor' }));

    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenCalledWith({ limit: 200, promptId: 'prompt-9' });
    });
  });

  it('forwards the full Evaluate filter set into listEvalRuns', async () => {
    const { result } = renderHook(() => useEvalRuns({
      promptId: null,
      tab: 'history',
      mode: 'ab',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'error',
      verdict: 'fail',
      regression: true,
      search: 'regression',
      dateRange: '7d',
    }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({
      limit: 200,
      mode: 'ab',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'error',
      verdict: 'fail',
      regression: true,
      search: 'regression',
      dateRange: '7d',
    });
  });

  it('leaves an explicit All-modes timeline query unscoped instead of forcing enhance', async () => {
    const { result } = renderHook(() => useEvalRuns({ promptId: null, tab: 'history', mode: '' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200 });
  });

  it('supports pagination with loadMore and reports hasMore from total rows', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      id: `run-${index}`,
      output: `output-${index}`,
    }));
    listEvalRuns.mockResolvedValue(rows);

    const { result } = renderHook(() => useEvalRuns({ promptId: 'prompt-2', tab: 'history', limit: 12 }));

    await waitFor(() => {
      expect(result.current.evalRuns).toHaveLength(12);
    });
    expect(result.current.totalRuns).toBe(30);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.evalRuns).toHaveLength(30);
    expect(result.current.hasMore).toBe(false);
  });

  it('merges run patches through updateRun and refreshes the timeline', async () => {
    listEvalRuns.mockResolvedValue([{ id: 'run-1', notes: '' }]);
    patchEvalRun.mockResolvedValue({ id: 'run-1', notes: 'keep', verdict: 'pass' });

    const { result } = renderHook(() => useEvalRuns({ promptId: 'prompt-7', tab: 'history' }));

    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenCalled();
    });
    listEvalRuns.mockClear();

    let updated = false;
    await act(async () => {
      updated = await result.current.updateRun('run-1', { notes: 'keep', verdict: 'pass' });
    });

    expect(updated).toBe(true);
    expect(patchEvalRun).toHaveBeenCalledWith('run-1', { notes: 'keep', verdict: 'pass' });
    expect(listEvalRuns).toHaveBeenCalledTimes(1);
  });

  it('returns false when updateRun cannot find the requested row', async () => {
    const { result } = renderHook(() => useEvalRuns({ promptId: 'prompt-7', tab: 'history' }));

    let updated = true;
    await act(async () => {
      updated = await result.current.updateRun('missing-run', { verdict: 'fail' });
    });

    expect(updated).toBe(false);
    expect(patchEvalRun).toHaveBeenCalledWith('missing-run', { verdict: 'fail' });
  });
});
