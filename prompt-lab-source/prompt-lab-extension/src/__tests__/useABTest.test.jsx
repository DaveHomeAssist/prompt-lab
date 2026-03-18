import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useABTest from '../hooks/useABTest.js';

const {
  callModel,
  listEvalRuns,
  listExperiments,
  saveEvalRun,
  saveExperiment,
} = vi.hoisted(() => ({
  callModel: vi.fn(),
  listEvalRuns: vi.fn(),
  listExperiments: vi.fn(),
  saveEvalRun: vi.fn(),
  saveExperiment: vi.fn(),
}));

vi.mock('../api.js', () => ({
  callModel,
}));

vi.mock('../experimentStore.js', () => ({
  listEvalRuns,
  listExperiments,
  saveEvalRun,
  saveExperiment,
}));

function anthropicResponse(text, extra = {}) {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    content: [{ text }],
    ...extra,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useABTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEvalRuns.mockResolvedValue([]);
    listExperiments.mockResolvedValue([]);
    saveEvalRun.mockResolvedValue({});
    saveExperiment.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads recent A/B runs and experiment history on mount', async () => {
    renderHook(() => useABTest({ notify: vi.fn() }));

    await waitFor(() => {
      expect(listExperiments).toHaveBeenCalledTimes(1);
      expect(listEvalRuns).toHaveBeenCalledWith({ mode: 'ab', limit: 12 });
    });
  });

  it('runs both variants as isolated user messages and stores side-by-side results', async () => {
    callModel
      .mockResolvedValueOnce(anthropicResponse('Response for A'))
      .mockResolvedValueOnce(anthropicResponse('Response for B'));

    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      result.current.setAbA((prev) => ({ ...prev, prompt: 'Prompt A' }));
      result.current.setAbB((prev) => ({ ...prev, prompt: 'Prompt B' }));
    });

    await act(async () => {
      await Promise.all([
        result.current.runAB('a'),
        result.current.runAB('b'),
      ]);
    });

    expect(callModel).toHaveBeenNthCalledWith(1, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'Prompt A' }],
    });
    expect(callModel).toHaveBeenNthCalledWith(2, {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'Prompt B' }],
    });
    expect(result.current.abA.response).toBe('Response for A');
    expect(result.current.abB.response).toBe('Response for B');
    expect(saveEvalRun).toHaveBeenCalledTimes(2);
    expect(saveEvalRun).toHaveBeenNthCalledWith(1, expect.objectContaining({
      promptTitle: 'A/B Variant A',
      mode: 'ab',
      variantLabel: 'Variant A',
      input: 'Prompt A',
      output: 'Response for A',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      latencyMs: expect.any(Number),
    }));
    expect(saveEvalRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      promptTitle: 'A/B Variant B',
      mode: 'ab',
      variantLabel: 'Variant B',
      input: 'Prompt B',
      output: 'Response for B',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      latencyMs: expect.any(Number),
    }));
  });

  it('skips API calls for blank variants', async () => {
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      await result.current.runAB('a');
    });

    expect(callModel).not.toHaveBeenCalled();
    expect(saveEvalRun).not.toHaveBeenCalled();
    expect(result.current.abA.loading).toBe(false);
    expect(result.current.abA.response).toBe('');
  });

  it('retries one transient failure before succeeding', async () => {
    vi.useFakeTimers();
    callModel
      .mockRejectedValueOnce(new Error('429 rate limited'))
      .mockResolvedValueOnce(anthropicResponse('Recovered response'));

    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      result.current.setAbA((prev) => ({ ...prev, prompt: 'Retry me' }));
    });

    await act(async () => {
      const runPromise = result.current.runAB('a');
      await vi.advanceTimersByTimeAsync(400);
      await runPromise;
    });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result.current.abA.error).toBe(false);
    expect(result.current.abA.response).toBe('Recovered response');
    expect(saveEvalRun).toHaveBeenCalledTimes(1);
  });

  it('ignores stale responses when a newer request for the same side wins', async () => {
    const first = deferred();
    const second = deferred();
    callModel
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      result.current.setAbA((prev) => ({ ...prev, prompt: 'First prompt' }));
    });
    let firstRun;
    act(() => {
      firstRun = result.current.runAB('a');
    });

    await act(async () => {
      result.current.setAbA((prev) => ({ ...prev, prompt: 'Second prompt' }));
    });
    let secondRun;
    act(() => {
      secondRun = result.current.runAB('a');
    });

    first.resolve(anthropicResponse('Old response'));
    await act(async () => {
      await firstRun;
    });

    expect(result.current.abA.response).toBe('');
    expect(result.current.abA.loading).toBe(true);
    expect(saveEvalRun).not.toHaveBeenCalled();

    second.resolve(anthropicResponse('Fresh response'));
    await act(async () => {
      await secondRun;
    });

    expect(result.current.abA.response).toBe('Fresh response');
    expect(result.current.abA.loading).toBe(false);
    expect(saveEvalRun).toHaveBeenCalledTimes(1);
    expect(saveEvalRun).toHaveBeenCalledWith(expect.objectContaining({
      input: 'Second prompt',
      output: 'Fresh response',
      variantLabel: 'Variant A',
    }));
  });

  it('persists the picked winner with both variants in experiment history', async () => {
    const notify = vi.fn();
    const savedHistory = [{
      id: 'exp-1',
      label: 'A/B: Prompt A',
      createdAt: '2026-03-14T00:00:00.000Z',
      outcome: { winnerVariantId: 'A' },
    }];
    listExperiments
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(savedHistory);

    const { result } = renderHook(() => useABTest({ notify }));

    await act(async () => {
      result.current.setAbA({ prompt: 'Prompt A', response: 'Answer A', loading: false, error: false });
      result.current.setAbB({ prompt: 'Prompt B', response: 'Answer B', loading: false, error: false });
    });

    await act(async () => {
      await result.current.pickWinner('A');
    });

    expect(result.current.abWinner).toBe('Variant A');
    expect(saveExperiment).toHaveBeenCalledTimes(1);
    expect(saveExperiment).toHaveBeenCalledWith(expect.objectContaining({
      label: 'A/B: Prompt A',
      variants: [
        expect.objectContaining({ id: 'A', prompt: 'Prompt A', response: 'Answer A' }),
        expect.objectContaining({ id: 'B', prompt: 'Prompt B', response: 'Answer B' }),
      ],
      outcome: { winnerVariantId: 'A' },
    }));
    expect(result.current.history).toEqual(savedHistory);
    expect(notify).toHaveBeenCalledWith('Experiment saved');
  });

  it('resetAB clears both sides and the current winner', async () => {
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      result.current.setAbA({ prompt: 'Prompt A', response: 'Answer A', loading: false, error: false });
      result.current.setAbB({ prompt: 'Prompt B', response: 'Answer B', loading: false, error: false });
    });
    await act(async () => {
      await result.current.pickWinner('B');
    });

    act(() => {
      result.current.resetAB();
    });

    expect(result.current.abA).toEqual({ prompt: '', response: '', loading: false, error: false });
    expect(result.current.abB).toEqual({ prompt: '', response: '', loading: false, error: false });
    expect(result.current.abWinner).toBe(null);
  });

  it('loadVariant seeds one side, clears stale output, and resets winner state', async () => {
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));

    await act(async () => {
      result.current.setAbA({ prompt: 'Old A', response: 'Old response', loading: false, error: false });
      result.current.setAbB({ prompt: 'Old B', response: 'Other response', loading: false, error: false });
    });

    await act(async () => {
      await result.current.pickWinner('B');
    });

    act(() => {
      result.current.loadVariant('a', 'Fresh prompt from library');
    });

    expect(result.current.abA).toEqual({
      prompt: 'Fresh prompt from library',
      response: '',
      loading: false,
      error: false,
    });
    expect(result.current.abB).toEqual({
      prompt: 'Old B',
      response: 'Other response',
      loading: false,
      error: false,
    });
    expect(result.current.abWinner).toBe(null);
    expect(result.current.activeSide).toBe('A');
  });
});
