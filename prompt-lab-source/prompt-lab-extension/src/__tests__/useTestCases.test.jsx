import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import useTestCases from '../hooks/useTestCases.js';

const {
  saveTestCase,
  listTestCases,
  deleteTestCase,
} = vi.hoisted(() => ({
  saveTestCase: vi.fn(),
  listTestCases: vi.fn(),
  deleteTestCase: vi.fn(),
}));

vi.mock('../experimentStore', () => ({
  saveTestCase,
  listTestCases,
  deleteTestCase,
}));

describe('useTestCases', () => {
  const notify = vi.fn();
  let confirmSpy;

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    listTestCases.mockResolvedValue([]);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    confirmSpy.mockRestore();
  });

  it('initial state has empty testCasesByPrompt', () => {
    const { result } = renderHook(() => useTestCases({ notify }));

    expect(result.current.testCasesByPrompt).toEqual({});
  });

  it('openCaseForm sets caseFormPromptId and populates fields for existing case', () => {
    const existingCase = {
      id: 'case-1',
      title: 'Regression',
      input: 'Sample input',
      expectedTraits: ['precise', 'grounded'],
      expectedExclusions: ['hallucinations'],
      notes: 'Keep short',
    };
    const { result } = renderHook(() => useTestCases({ notify }));

    act(() => {
      result.current.openCaseForm('prompt-1', existingCase);
    });

    expect(result.current.caseFormPromptId).toBe('prompt-1');
    expect(result.current.editingCaseId).toBe('case-1');
    expect(result.current.caseTitle).toBe('Regression');
    expect(result.current.caseInput).toBe('Sample input');
    expect(result.current.caseTraits).toBe('precise, grounded');
    expect(result.current.caseExclusions).toBe('hallucinations');
    expect(result.current.caseNotes).toBe('Keep short');
  });

  it('resetCaseForm clears all fields', () => {
    const existingCase = {
      id: 'case-1',
      title: 'Regression',
      input: 'Sample input',
      expectedTraits: ['precise'],
      expectedExclusions: ['hallucinations'],
      notes: 'Keep short',
    };
    const { result } = renderHook(() => useTestCases({ notify }));

    act(() => {
      result.current.openCaseForm('prompt-1', existingCase);
      result.current.resetCaseForm();
    });

    expect(result.current.caseFormPromptId).toBeNull();
    expect(result.current.editingCaseId).toBeNull();
    expect(result.current.caseTitle).toBe('');
    expect(result.current.caseInput).toBe('');
    expect(result.current.caseTraits).toBe('');
    expect(result.current.caseExclusions).toBe('');
    expect(result.current.caseNotes).toBe('');
  });

  it('saveCaseForPrompt calls saveTestCase with correct payload, refreshes, resets form', async () => {
    saveTestCase.mockResolvedValue({ title: 'New case' });
    listTestCases
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'case-2', promptId: 'prompt-1', title: 'New case' }]);
    const { result } = renderHook(() => useTestCases({ notify }));

    await waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.openCaseForm('prompt-1');
      result.current.setCaseTitle('New case');
      result.current.setCaseInput('Check this');
      result.current.setCaseTraits('clear, concise');
      result.current.setCaseExclusions('hedging');
      result.current.setCaseNotes('Ship it');
    });

    await act(async () => {
      await result.current.saveCaseForPrompt('prompt-1');
    });

    expect(saveTestCase).toHaveBeenCalledWith({
      promptId: 'prompt-1',
      title: 'New case',
      input: 'Check this',
      expectedTraits: ['clear', 'concise'],
      expectedExclusions: ['hedging'],
      notes: 'Ship it',
    });
    expect(listTestCases).toHaveBeenCalledTimes(2);
    expect(result.current.testCasesByPrompt).toEqual({
      'prompt-1': [{ id: 'case-2', promptId: 'prompt-1', title: 'New case' }],
    });
    expect(result.current.caseFormPromptId).toBeNull();
    expect(result.current.caseTitle).toBe('');
    expect(result.current.caseInput).toBe('');
    expect(result.current.caseTraits).toBe('');
    expect(result.current.caseExclusions).toBe('');
    expect(result.current.caseNotes).toBe('');
    expect(notify).toHaveBeenCalledWith('Saved test case: New case');
  });

  it('saveCaseForPrompt with editingCaseId includes id and updatedAt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-13T12:00:00Z'));
    saveTestCase.mockResolvedValue({ title: 'Updated case' });
    listTestCases.mockResolvedValue([]);
    const { result } = renderHook(() => useTestCases({ notify }));

    await act(async () => {});
    expect(listTestCases).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.openCaseForm('prompt-1', {
        id: 'case-1',
        title: 'Original case',
        input: 'Initial input',
        expectedTraits: ['specific'],
        expectedExclusions: ['fluff'],
        notes: 'Before edit',
      });
      result.current.setCaseTitle('Updated case');
      result.current.setCaseInput('Updated input');
      result.current.setCaseTraits('specific, measurable');
      result.current.setCaseExclusions('fluff, jargon');
      result.current.setCaseNotes('After edit');
    });

    await act(async () => {
      await result.current.saveCaseForPrompt('prompt-1');
    });

    expect(saveTestCase).toHaveBeenCalledWith({
      id: 'case-1',
      promptId: 'prompt-1',
      title: 'Updated case',
      input: 'Updated input',
      expectedTraits: ['specific', 'measurable'],
      expectedExclusions: ['fluff', 'jargon'],
      notes: 'After edit',
      updatedAt: '2026-03-13T12:00:00.000Z',
    });
    expect(notify).toHaveBeenCalledWith('Updated test case: Updated case');
  });

  it('removeCase with confirm=true calls deleteTestCase and refreshes', async () => {
    listTestCases
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTestCases({ notify }));

    await waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.removeCase({ id: 'case-1', title: 'Delete me' });
    });

    expect(window.confirm).toHaveBeenCalledWith('Delete test case "Delete me"?');
    expect(deleteTestCase).toHaveBeenCalledWith('case-1');
    expect(listTestCases).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith('Test case deleted');
  });

  it('removeCase with confirm=false does nothing', async () => {
    confirmSpy.mockReturnValue(false);
    const { result } = renderHook(() => useTestCases({ notify }));

    await waitFor(() => expect(listTestCases).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.removeCase({ id: 'case-1', title: 'Keep me' });
    });

    expect(deleteTestCase).not.toHaveBeenCalled();
    expect(listTestCases).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });
});
