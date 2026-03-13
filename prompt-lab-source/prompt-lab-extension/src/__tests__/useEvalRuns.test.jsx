import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useEvalRuns from '../hooks/useEvalRuns.js';

const { listEvalRuns } = vi.hoisted(() => ({
  listEvalRuns: vi.fn(),
}));

vi.mock('../experimentStore', () => ({
  listEvalRuns,
}));

describe('useEvalRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvalRuns.mockResolvedValue([]);
  });

  it('refreshEvalRuns calls listEvalRuns with promptId filter', async () => {
    const { result } = renderHook(() => useEvalRuns({ editingId: 'prompt-1', tab: 'library' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenCalledWith({ limit: 12, promptId: 'prompt-1' });
  });

  it('refreshEvalRuns without promptId uses mode:\'enhance\' filter', async () => {
    const { result } = renderHook(() => useEvalRuns({ editingId: null, tab: 'library' }));

    await act(async () => {
      await result.current.refreshEvalRuns();
    });

    expect(listEvalRuns).toHaveBeenCalledWith({ limit: 12, mode: 'enhance' });
  });

  it('effect triggers refresh when tab is editor', async () => {
    renderHook(() => useEvalRuns({ editingId: 'prompt-9', tab: 'editor' }));

    await waitFor(() => {
      expect(listEvalRuns).toHaveBeenCalledWith({ limit: 12, promptId: 'prompt-9' });
    });
  });
});
