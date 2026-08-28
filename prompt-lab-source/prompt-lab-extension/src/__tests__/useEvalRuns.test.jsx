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

  // M-2: without a prompt selected the hook used to pin mode:'enhance' on its
  // own, so the Evaluate timeline's "All modes" option silently hid A/B and
  // test-case runs. The pin is now opt-in via defaultMode; a caller that does
  // not ask for it gets exactly the filters it declared.
  it('refreshEvalRuns without promptId or defaultMode queries all modes', async () => {
    const { result } = renderHook(() => useEvalRuns({ editingId: null, tab: 'library' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenCalledWith({ limit: 200 });
  });

  it('applies defaultMode only while no prompt is selected', async () => {
    const { result } = renderHook(() => useEvalRuns({
      editingId: null,
      tab: 'library',
      defaultMode: 'enhance',
    }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200, mode: 'enhance' });

    await act(async () => {
      await result.current.refreshEvalRuns('prompt-7');
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200, promptId: 'prompt-7' });
  });

  it('lets an explicit mode filter override defaultMode', async () => {
    const { result } = renderHook(() => useEvalRuns({
      promptId: null,
      tab: 'history',
      defaultMode: 'enhance',
      mode: 'ab',
    }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200, mode: 'ab' });
  });

  it('effect triggers refresh when tab is editor', async () => {
    renderHook(() => useEvalRuns({ editingId: 'prompt-9', tab: 'editor' }));

    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenCalledWith({ limit: 200, promptId: 'prompt-9' });
    });
  });

  // M-2: this used to claim the "full" filter set while omitting verdict and
  // regression, so the two filters the Evaluate panel could not apply were
  // also the two this test did not cover.
  it('forwards the full Evaluate filter set into listEvalRuns', async () => {
    const { result } = renderHook(() => useEvalRuns({
      promptId: null,
      tab: 'history',
      mode: 'ab',
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'error',
      verdict: 'pass',
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
      verdict: 'pass',
      regression: true,
      search: 'regression',
      dateRange: '7d',
    });
  });

  it('omits verdict and regression when they are unset', async () => {
    const { result } = renderHook(() => useEvalRuns({
      promptId: null,
      tab: 'history',
      mode: 'ab',
      verdict: '',
      regression: false,
    }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200, mode: 'ab' });
  });

  it('re-queries when the verdict or regression filter changes', async () => {
    const { rerender } = renderHook((props) => useEvalRuns(props), {
      initialProps: { promptId: null, tab: 'history', verdict: '', regression: false },
    });

    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200 });
    });

    rerender({ promptId: null, tab: 'history', verdict: 'fail', regression: false });
    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenLastCalledWith({ limit: 200, verdict: 'fail' });
    });

    rerender({ promptId: null, tab: 'history', verdict: 'fail', regression: true });
    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenLastCalledWith({
        limit: 200,
        verdict: 'fail',
        regression: true,
      });
    });
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
