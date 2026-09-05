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
    model: 'claude-sonnet-4-6',
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
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'Prompt A' }],
    }, { signal: expect.any(AbortSignal) });
    expect(callModel).toHaveBeenNthCalledWith(2, {
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: 'Prompt B' }],
    }, { signal: expect.any(AbortSignal) });
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
      model: 'claude-sonnet-4-6',
      latencyMs: expect.any(Number),
    }));
    expect(saveEvalRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      promptTitle: 'A/B Variant B',
      mode: 'ab',
      variantLabel: 'Variant B',
      input: 'Prompt B',
      output: 'Response for B',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
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
  it('blocks every sensitive Run All variant and sends only its reviewed redaction', async () => {
    callModel.mockResolvedValue(anthropicResponse('Safe response'));
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => {
      result.current.loadVariant('a', 'Contact person@example.com');
      result.current.loadVariant('b', 'Contact second@example.com');
    });
    await act(async () => result.current.runAll());
    expect(callModel).not.toHaveBeenCalled();
    expect(result.current.piiWarning.scope).toBe('a');
    await act(async () => result.current.piiRedactAndSend());
    expect(callModel).toHaveBeenCalledTimes(1);
    expect(callModel.mock.calls[0][0].messages[0].content).not.toContain('person@example.com');
    expect(saveEvalRun.mock.calls[0][0].input).toBe(callModel.mock.calls[0][0].messages[0].content);
    expect(result.current.piiWarning.scope).toBe('b');
    act(() => result.current.piiCancel());
    expect(callModel).toHaveBeenCalledTimes(1);
  });

  it.each(['edit', 'provider', 'remove', 'reset', 'unmount'])('aborts and rejects late results after %s', async (change) => {
    const pending = deferred();
    callModel.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => result.current.addVariant());
    act(() => result.current.loadVariant('c', 'Old input', { entryId: 'old', title: 'Old title' }));
    let oldRun;
    act(() => { oldRun = result.current.runAB('c'); });
    const signal = callModel.mock.calls[0][1].signal;
    act(() => {
      if (change === 'edit') result.current.setVariant('c', prev => ({ ...prev, prompt: 'New input' }));
      if (change === 'provider') result.current.setSideProvider('c', { provider: 'openai', model: 'different' });
      if (change === 'remove') result.current.removeVariant('c');
      if (change === 'reset') result.current.resetAB();
      if (change === 'unmount') unmount();
    });
    expect(signal.aborted).toBe(true);
    if (change === 'remove') {
      act(() => result.current.addVariant());
      act(() => result.current.loadVariant('c', 'New input', { entryId: 'new' }));
      callModel.mockResolvedValueOnce(anthropicResponse('New response'));
      await act(async () => result.current.runAB('c'));
    }
    await act(async () => { pending.resolve(anthropicResponse('Old response')); await oldRun; });
    expect(saveEvalRun.mock.calls.some(([run]) => run.input === 'Old input')).toBe(false);
    if (change === 'remove') expect(result.current.variants.find(v => v.id === 'c').response).toBe('New response');
  });

  it('invalidates a reviewed Arena payload when its provider changes', async () => {
    const { result } = renderHook(() => useABTest({ notify: vi.fn() }));
    act(() => result.current.loadVariant('a', 'Contact person@example.com'));
    await act(async () => result.current.runAB('a'));
    const send = result.current.piiSendAnyway;
    act(() => result.current.setSideProvider('a', { provider: 'openai', model: 'other' }));
    await act(async () => send());
    expect(callModel).not.toHaveBeenCalled();
  });

});
