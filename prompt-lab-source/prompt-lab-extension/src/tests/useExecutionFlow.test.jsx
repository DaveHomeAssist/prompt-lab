import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useExecutionFlow from '../hooks/useExecutionFlow.js';
import { normalizeEvalRunRecord } from '../lib/evalSchema.js';

const {
  callModel,
  saveEvalRun,
  openSettings,
  scanSensitiveData,
  redactPayload,
  extractTextFromAnthropic,
  parseEnhancedPayload,
  suggestTitleFromText,
  isTransientError,
  ngramSimilarity,
  checkTraits,
} = vi.hoisted(() => ({
  callModel: vi.fn(),
  saveEvalRun: vi.fn(),
  openSettings: vi.fn(),
  scanSensitiveData: vi.fn(),
  redactPayload: vi.fn((payload) => payload),
  extractTextFromAnthropic: vi.fn((data) => data?.text || data?.content?.[0]?.text || ''),
  parseEnhancedPayload: vi.fn((text) => ({
    enhanced: text,
    variants: [],
    notes: '',
    assumptions: [],
    tags: [],
  })),
  suggestTitleFromText: vi.fn(() => 'Suggested Prompt'),
  isTransientError: vi.fn((error) => /429|rate/i.test(error?.message || '')),
  ngramSimilarity: vi.fn(() => 0.82),
  checkTraits: vi.fn(() => ({ passedTraits: [], failedTraits: [], excludedHits: [], verdict: null })),
}));

const refreshEvalRuns = vi.fn(() => Promise.resolve());
const setShowEvalHistory = vi.fn();

vi.mock('../api.js', () => ({
  callModel,
}));

vi.mock('../experimentStore.js', () => ({
  saveEvalRun,
}));

vi.mock('../piiScanner.js', () => ({
  scanSensitiveData,
  redactPayload,
}));

vi.mock('../promptUtils', () => ({
  extractTextFromAnthropic,
  parseEnhancedPayload,
  suggestTitleFromText,
  isTransientError,
  ngramSimilarity,
  checkTraits,
}));

vi.mock('../lib/platform.js', () => ({
  openSettings,
}));

vi.mock('../hooks/useEvalRuns.js', () => ({
  default: () => ({
    evalRuns: [],
    showEvalHistory: false,
    setShowEvalHistory,
    refreshEvalRuns,
  }),
}));

vi.mock('../hooks/useTestCases.js', () => ({
  default: () => ({
    testCasesByPrompt: {},
    caseFormPromptId: null,
    editingCaseId: null,
    caseTitle: '',
    setCaseTitle: vi.fn(),
    caseInput: '',
    setCaseInput: vi.fn(),
    caseTraits: '',
    setCaseTraits: vi.fn(),
    caseExclusions: '',
    setCaseExclusions: vi.fn(),
    caseNotes: '',
    setCaseNotes: vi.fn(),
    runningCases: false,
    setRunningCases: vi.fn(),
    openCaseForm: vi.fn(),
    resetCaseForm: vi.fn(),
    saveCaseForPrompt: vi.fn(),
    removeCase: vi.fn(),
  }),
}));

function renderExecutionFlow({
  raw = 'Draft prompt',
  enhanced = 'Prior enhanced output',
  notes = '',
  editingId = 'entry-1',
  saveTitle = 'Existing Prompt',
  library = [{ id: 'entry-1', goldenResponse: { text: 'Golden baseline' } }],
} = {}) {
  const notify = vi.fn();
  const setTab = vi.fn();

  const hook = renderHook(() => {
    const [rawState, setRaw] = useState(raw);
    const [enhancedState, setEnhanced] = useState(enhanced);
    const [variants, setVariants] = useState([]);
    const [notesState, setNotes] = useState(notes);
    const [saveTitleState, setSaveTitle] = useState(saveTitle);
    const [saveTags, setSaveTags] = useState([]);
    const [showSave, setShowSave] = useState(false);
    const [showDiff, setShowDiff] = useState(false);
    const [cursor, setCursor] = useState({ start: 4, end: 4 });

    const flow = useExecutionFlow({
      ui: { notify, setTab, tab: 'editor' },
      lib: { library },
      editor: {
        raw: rawState,
        enhanced: enhancedState,
        variants,
        notes: notesState,
        enhMode: 'balanced',
        setRaw,
        setEnhanced,
        setVariants,
        setNotes,
      },
      persistence: {
        editingId,
        saveTitle: saveTitleState,
        setSaveTitle,
        setSaveTags,
        setShowSave,
        setShowDiff,
      },
    });

    return {
      ...flow,
      raw: rawState,
      setRaw,
      enhanced: enhancedState,
      variants,
      notes: notesState,
      saveTitle: saveTitleState,
      saveTags,
      showSave,
      showDiff,
      cursor,
      setCursor,
    };
  });

  return { ...hook, notify, setTab };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useExecutionFlow', () => {
  let savedRuns;
  let idCounter;

  beforeEach(() => {
    vi.clearAllMocks();
    parseEnhancedPayload.mockImplementation((text) => ({
      enhanced: text,
      variants: [],
      notes: '',
      assumptions: [],
      tags: [],
    }));
    savedRuns = [];
    idCounter = 0;
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        randomUUID: vi.fn(() => `run-${++idCounter}`),
      },
      configurable: true,
    });
    saveEvalRun.mockImplementation(async (record) => {
      const normalized = normalizeEvalRunRecord(record);
      savedRuns.push(normalized);
      return normalized;
    });
    callModel.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      text: 'Enhanced output',
    });
    scanSensitiveData.mockReturnValue({ matches: [], settings: {} });
  });

  it('enhance_success_creates_eval_run', async () => {
    const { result } = renderExecutionFlow();

    await act(async () => {
      await result.current.enhance();
    });

    await waitFor(() => {
      expect(savedRuns).toHaveLength(1);
    });

    expect(savedRuns[0]).toEqual(expect.objectContaining({
      promptId: 'entry-1',
      mode: 'enhance',
      status: 'success',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      output: 'Enhanced output',
      goldenScore: 0.82,
    }));
    // Verify schema-level fields survive normalization
    expect(savedRuns[0].id).toEqual(expect.any(String));
    expect(savedRuns[0].createdAt).toEqual(expect.any(String));
    expect(result.current.showSave).toBe(false);
  });

  it('enhance_error_does_not_corrupt_editor_state', async () => {
    callModel.mockRejectedValueOnce(new Error('Provider unavailable'));
    const { result } = renderExecutionFlow({ raw: 'Keep this input intact' });

    act(() => {
      result.current.setCursor({ start: 9, end: 9 });
    });

    await act(async () => {
      await result.current.enhance();
    });

    expect(result.current.raw).toBe('Keep this input intact');
    expect(result.current.cursor).toEqual({ start: 9, end: 9 });
    expect(result.current.error).toBeTruthy();
    // normalizeError classifies unknown errors → AppError with category 'unknown'
    expect(result.current.error.name).toBe('AppError');
    expect(result.current.error.category).toBe('unknown');
    // Loading must reset even on failure
    expect(result.current.loading).toBe(false);
    // Failed attempts are part of the running enhancement record.
    await waitFor(() => {
      expect(savedRuns).toHaveLength(1);
    });
    expect(savedRuns[0]).toEqual(expect.objectContaining({
      mode: 'enhance',
      status: 'error',
      input: 'Keep this input intact',
    }));
  });

  it('keeps partial streamed failure visible and records one failed attempt without automatic retry', async () => {
    isTransientError.mockReturnValue(true);
    callModel.mockImplementationOnce(async (_payload, options) => {
      options.onChunk('Partial fixture', 'Partial fixture');
      throw Object.assign(new Error('Provider stream terminated'), { partialText: 'Partial fixture' });
    });
    const { result } = renderExecutionFlow();
    await act(async () => { await result.current.enhance(); });
    expect(callModel).toHaveBeenCalledOnce();
    expect(result.current.streamPreview).toBe('Partial fixture');
    expect(result.current.streaming).toBe(false);
    expect(result.current.enhanced).toBe('Prior enhanced output');
    await waitFor(() => expect(savedRuns).toHaveLength(1));
    expect(savedRuns[0]).toMatchObject({ status: 'error', output: 'Partial fixture' });
  });

  it('retry_creates_new_eval_run', async () => {
    callModel
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'First output',
      })
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Retry output',
      });

    const { result } = renderExecutionFlow();

    await act(async () => {
      await result.current.enhance();
    });

    await act(async () => {
      await result.current.enhance();
    });

    await waitFor(() => {
      expect(savedRuns).toHaveLength(2);
    });

    expect(savedRuns[0].id).not.toBe(savedRuns[1].id);
    expect(savedRuns[0].output).toBe('First output');
    expect(savedRuns[1].output).toBe('Retry output');
  });

  it('exact_no_op_runs_one_corrective_pass_before_committing', async () => {
    callModel
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Draft prompt',
        usage: { input: 20, output: 10, total: 30 },
      })
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Corrected result',
        usage: { input: 30, output: 15, total: 45 },
      });
    parseEnhancedPayload.mockImplementation((text) => text === 'Draft prompt'
      ? {
          enhanced: 'Draft prompt',
          variants: [],
          notes: 'Already clear.',
          changes: [],
          reasoning: 'The prompt is already good as written.',
          assumptions: [],
          tags: [],
        }
      : {
          enhanced: 'Act as an editor. Rewrite the supplied draft for clarity and return the revised copy only.',
          variants: [],
          notes: 'Added an explicit role and output requirement.',
          changes: [{ type: 'added', label: 'Added editor role and output format' }],
          reasoning: 'Added a role and output format so the task and expected response are executable.',
          assumptions: [],
          tags: [],
        });
    const { result } = renderExecutionFlow();

    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(callModel.mock.calls[1][0]).toEqual(expect.objectContaining({
      system: expect.stringContaining('QUALITY CORRECTION PASS'),
      messages: expect.arrayContaining([
        { role: 'assistant', content: 'Draft prompt' },
      ]),
    }));
    expect(result.current.enhanced).toBe('Act as an editor. Rewrite the supplied draft for clarity and return the revised copy only.');
    expect(result.current.notes).toContain('used one corrective pass');
    await waitFor(() => expect(savedRuns).toHaveLength(1));
    expect(savedRuns[0]).toEqual(expect.objectContaining({
      status: 'success',
      output: 'Act as an editor. Rewrite the supplied draft for clarity and return the revised copy only.',
      usage: { input: 50, output: 25, total: 75 },
    }));
    expect(savedRuns[0].notes).toContain('used one corrective pass');
  });

  it('supported_small_improvement_does_not_trigger_correction', async () => {
    callModel.mockResolvedValueOnce({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      text: 'Small supported improvement',
    });
    parseEnhancedPayload.mockReturnValueOnce({
      enhanced: 'Write a concise summary',
      variants: [],
      notes: '',
      changes: [{ type: 'added', label: 'Added a concise length constraint' }],
      reasoning: 'Added a length constraint so the output stays focused and predictable.',
      assumptions: [],
      tags: [],
    });
    const { result } = renderExecutionFlow({ raw: 'Write a summary' });

    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).toHaveBeenCalledTimes(1);
    expect(result.current.enhanced).toBe('Write a concise summary');
  });

  it('second_no_op_fails_honestly_and_preserves_the_previous_result', async () => {
    callModel
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'First no-op',
      })
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Second no-op',
      });
    parseEnhancedPayload.mockImplementation(() => ({
      enhanced: 'Draft prompt',
      variants: [],
      notes: 'No changes needed.',
      changes: [],
      reasoning: 'The prompt is already clear.',
      assumptions: [],
      tags: [],
    }));
    const { result } = renderExecutionFlow({ enhanced: 'Prior enhanced output' });

    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).toHaveBeenCalledTimes(2);
    expect(result.current.enhanced).toBe('Prior enhanced output');
    expect(result.current.error).toEqual(expect.objectContaining({
      name: 'AppError',
      category: 'provider',
      retryable: true,
      userMessage: expect.stringContaining('could not produce a meaningful improvement'),
    }));
    await waitFor(() => expect(savedRuns).toHaveLength(1));
    expect(savedRuns[0]).toEqual(expect.objectContaining({
      status: 'error',
      output: expect.stringContaining('could not produce a meaningful improvement'),
      notes: expect.stringContaining('Quality gate: exact-no-op'),
    }));
  });

  it('cancel_aborts_the_corrective_pass_and_blocks_late_adoption', async () => {
    const correction = createDeferred();
    callModel
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Initial no-op',
      })
      .mockImplementationOnce(() => correction.promise);
    parseEnhancedPayload.mockImplementation((text) => ({
      enhanced: text === 'Initial no-op' ? 'Draft prompt' : 'Late correction result',
      variants: [],
      notes: '',
      changes: [],
      reasoning: 'The prompt is already clear.',
      assumptions: [],
      tags: [],
    }));
    const { result } = renderExecutionFlow({ enhanced: 'Prior enhanced output' });

    let enhancePromise;
    await act(async () => {
      enhancePromise = result.current.enhance();
      await Promise.resolve();
    });
    await waitFor(() => expect(callModel).toHaveBeenCalledTimes(2));
    const correctionSignal = callModel.mock.calls[1][1].signal;

    act(() => {
      result.current.cancelEnhance();
    });
    expect(correctionSignal.aborted).toBe(true);

    const abortError = new Error('Request cancelled.');
    abortError.name = 'AbortError';
    await act(async () => {
      correction.reject(abortError);
      await enhancePromise;
    });

    expect(result.current.enhanced).toBe('Prior enhanced output');
    await waitFor(() => expect(savedRuns).toHaveLength(1));
    expect(savedRuns[0].status).toBe('canceled');
  });

  it('pii_block_prevents_send_and_records_blocked_run', async () => {
    scanSensitiveData.mockReturnValue({
      matches: [{ id: 'm-1', type: 'email', snippet: 'user@example.com', path: ['messages', 0, 'content'], start: 0 }],
      settings: {},
    });
    const { result } = renderExecutionFlow({ raw: 'Contact me at user@example.com' });

    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).not.toHaveBeenCalled();
    expect(result.current.piiWarning).toBeTruthy();
    expect(result.current.piiWarning.matches).toHaveLength(1);
    expect(result.current.piiWarning.matches[0]).toEqual(expect.objectContaining({ type: 'email' }));
    expect(savedRuns).toHaveLength(1);
    expect(savedRuns[0]).toEqual(expect.objectContaining({
      status: 'blocked',
      provider: 'blocked',
      model: 'claude-sonnet-4-6',
      promptId: 'entry-1',
    }));
    // Blocked runs must still carry a valid output string for history display
    expect(typeof savedRuns[0].output).toBe('string');
    expect(savedRuns[0].output.length).toBeGreaterThan(0);
  });

  // DHA-10 / PLB-013: `loading` only disables the trigger after a render, so
  // the guard has to be synchronous or a double activation bills twice.
  it('rapid_enhance_activation_dispatches_one_provider_call', async () => {
    const { result } = renderExecutionFlow();

    await act(async () => {
      // Both calls are issued inside one tick, before any re-render.
      await Promise.all([result.current.enhance(), result.current.enhance()]);
    });

    expect(callModel).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(savedRuns).toHaveLength(1);
    });
  });

  it('cancel_releases_the_guard_so_a_retry_dispatches', async () => {
    const { result } = renderExecutionFlow();

    await act(async () => {
      await result.current.enhance();
    });
    expect(callModel).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.cancelEnhance();
    });

    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it('canceled_request_finally_does_not_release_a_newer_retry_guard', async () => {
    const firstRequest = createDeferred();
    const retryRequest = createDeferred();
    callModel
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => retryRequest.promise);
    const { result } = renderExecutionFlow();

    let firstEnhance;
    await act(async () => {
      firstEnhance = result.current.enhance();
      await Promise.resolve();
    });
    expect(callModel).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.cancelEnhance();
    });

    let retryEnhance;
    await act(async () => {
      retryEnhance = result.current.enhance();
      await Promise.resolve();
    });
    expect(callModel).toHaveBeenCalledTimes(2);

    const abortError = new Error('Request cancelled.');
    abortError.name = 'AbortError';
    await act(async () => {
      firstRequest.reject(abortError);
      await firstEnhance;
    });

    await act(async () => {
      await result.current.enhance();
    });
    expect(callModel).toHaveBeenCalledTimes(2);

    await act(async () => {
      retryRequest.resolve({
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        text: 'Retry output',
      });
      await retryEnhance;
    });
  });

  it('pii_blocked_attempt_leaves_the_guard_released', async () => {
    scanSensitiveData.mockReturnValueOnce({
      matches: [{ id: 'm-1', type: 'email', snippet: 'user@example.com', path: ['messages', 0, 'content'], start: 0 }],
      settings: {},
    });
    const { result } = renderExecutionFlow({ raw: 'Contact me at user@example.com' });

    await act(async () => {
      await result.current.enhance();
    });
    expect(callModel).not.toHaveBeenCalled();

    // A preflight stop must not strand the guard — the next attempt still sends.
    scanSensitiveData.mockReturnValue({ matches: [], settings: {} });
    await act(async () => {
      await result.current.enhance();
    });

    expect(callModel).toHaveBeenCalledTimes(1);
  });
  it.each(['mode', 'override'])('scans %s payloads and preserves the reviewed mode', async (entry) => {
    scanSensitiveData.mockReturnValue({ matches: [{ id: 'email', type: 'email', snippet: 'person@example.com' }] });
    callModel.mockResolvedValue({ text: 'A substantially improved and more precise prompt with a clear task and expected output.' });
    const { result } = renderExecutionFlow();
    await act(async () => {
      if (entry === 'mode') await result.current.enhanceWithMode('creative');
      else await result.current.enhance({ messages: [{ role: 'user', content: 'person@example.com' }] }, { modeId: 'creative' });
    });
    expect(callModel).not.toHaveBeenCalled();
    expect(result.current.piiWarning).toBeTruthy();
    await act(async () => result.current.piiSendAnyway());
    expect(callModel).toHaveBeenCalled();
    expect(saveEvalRun.mock.calls.every(([run]) => run.enhanceMode === 'creative')).toBe(true);
  });

  it('revokes a pending approval after the editor input changes', async () => {
    scanSensitiveData.mockReturnValue({ matches: [{ id: 'email', type: 'email', snippet: 'person@example.com' }] });
    const { result } = renderExecutionFlow();
    await act(async () => result.current.enhance());
    const send = result.current.piiSendAnyway;
    act(() => result.current.setRaw('A different prompt'));
    await act(async () => send());
    expect(callModel).not.toHaveBeenCalled();
  });

  it('aborts old editor work, discards late success, and releases the dispatch guard', async () => {
    const pending = createDeferred();
    callModel.mockReturnValueOnce(pending.promise);
    const { result } = renderExecutionFlow();
    let request;
    act(() => { request = result.current.enhance(); });
    const signal = callModel.mock.calls[0][1].signal;
    act(() => result.current.setRaw('A different prompt'));
    expect(signal.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    await act(async () => { pending.resolve({ text: 'Old result' }); await request; });
    expect(result.current.enhanced).toBe('Prior enhanced output');
    expect(saveEvalRun).not.toHaveBeenCalled();
    callModel.mockResolvedValue({ text: 'New prompt with a specific objective and a structured output format.' });
    await act(async () => result.current.enhance());
    expect(callModel.mock.calls.length).toBeGreaterThan(1);
  });

});
