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

describe('useExecutionFlow', () => {
  let savedRuns;
  let idCounter;

  beforeEach(() => {
    vi.clearAllMocks();
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
      model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
      output: 'Enhanced output',
      goldenScore: 0.82,
    }));
    // Verify schema-level fields survive normalization
    expect(savedRuns[0].id).toEqual(expect.any(String));
    expect(savedRuns[0].createdAt).toEqual(expect.any(String));
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
    expect(savedRuns).toHaveLength(0);
  });

  it('retry_creates_new_eval_run', async () => {
    callModel
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        text: 'First output',
      })
      .mockResolvedValueOnce({
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
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
      model: 'claude-sonnet-4-20250514',
      promptId: 'entry-1',
    }));
    // Blocked runs must still carry a valid output string for history display
    expect(typeof savedRuns[0].output).toBe('string');
    expect(savedRuns[0].output.length).toBeGreaterThan(0);
  });
});
