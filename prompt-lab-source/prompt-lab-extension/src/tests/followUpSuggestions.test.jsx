import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  buildFollowUpPayload,
  parseFollowUpSuggestions,
  FOLLOW_UP_SYSTEM_PROMPT,
  MAX_FOLLOW_UP_SUGGESTIONS,
} from '../lib/followUpSuggestions.js';
import useFollowUpSuggestions from '../hooks/useFollowUpSuggestions.js';
import { callModel } from '../api';

vi.mock('../api', () => ({
  callModel: vi.fn(),
}));

vi.mock('../promptUtils', () => ({
  extractTextFromAnthropic: vi.fn((data) => data?.content?.[0]?.text || ''),
}));

describe('buildFollowUpPayload', () => {
  it('prefers the enhanced text over the raw prompt', () => {
    const payload = buildFollowUpPayload({ raw: 'raw text', enhanced: 'enhanced text' });
    expect(payload.messages).toEqual([{ role: 'user', content: 'enhanced text' }]);
    expect(payload.system).toContain(FOLLOW_UP_SYSTEM_PROMPT);
    expect(payload.responseFormat).toBe('json');
  });

  it('falls back to the raw prompt when nothing is enhanced', () => {
    const payload = buildFollowUpPayload({ raw: 'raw text', enhanced: '' });
    expect(payload.messages[0].content).toBe('raw text');
  });
});

describe('parseFollowUpSuggestions', () => {
  it('parses plain JSON suggestions', () => {
    const parsed = parseFollowUpSuggestions('{"suggestions":[{"title":"Critique it","prompt":"Review the output for gaps."}]}');
    expect(parsed).toEqual([{ title: 'Critique it', prompt: 'Review the output for gaps.' }]);
  });

  it('parses fenced JSON and noisy wrappers', () => {
    const parsed = parseFollowUpSuggestions('```json\n{"suggestions":[{"title":"Next step","prompt":"Summarize the result."}]}\n```');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].prompt).toBe('Summarize the result.');
  });

  it('caps results, drops empty prompts, and defaults missing titles', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ title: '', prompt: `Prompt ${i}` }));
    rows.push({ title: 'Empty', prompt: '   ' });
    const parsed = parseFollowUpSuggestions(JSON.stringify({ suggestions: rows }));
    expect(parsed).toHaveLength(MAX_FOLLOW_UP_SUGGESTIONS);
    expect(parsed.every((row) => row.title === 'Follow-up prompt')).toBe(true);
  });

  it('returns an empty list for malformed payloads', () => {
    expect(parseFollowUpSuggestions('not json at all')).toEqual([]);
    expect(parseFollowUpSuggestions('')).toEqual([]);
    expect(parseFollowUpSuggestions('{"suggestions":"nope"}')).toEqual([]);
  });
});

describe('useFollowUpSuggestions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const respondWith = (suggestions) => ({
    content: [{ text: JSON.stringify({ suggestions }) }],
  });

  it('fetches and exposes suggestions', async () => {
    callModel.mockResolvedValueOnce(respondWith([{ title: 'Refine tone', prompt: 'Adjust the tone for executives.' }]));
    const { result } = renderHook(() => useFollowUpSuggestions({ raw: 'raw', enhanced: 'enhanced' }));

    await act(async () => {
      await result.current.fetchFollowUps();
    });

    expect(result.current.followUps).toEqual([expect.objectContaining({ title: 'Refine tone', prompt: 'Adjust the tone for executives.', id: expect.any(String), origin: expect.objectContaining({ sourceKind: 'enhanced-prompt' }) })]);
    expect(result.current.followUpsError).toBe('');
    expect(result.current.followUpsLoading).toBe(false);
  });

  it('surfaces an error message when the call fails', async () => {
    callModel.mockRejectedValueOnce(new Error('Provider unavailable'));
    const { result } = renderHook(() => useFollowUpSuggestions({ raw: 'raw', enhanced: 'enhanced' }));

    await act(async () => {
      await result.current.fetchFollowUps();
    });

    expect(result.current.followUps).toEqual([]);
    expect(result.current.followUpsError).toBeTruthy();
  });

  it('does nothing when there is no prompt text', async () => {
    const { result } = renderHook(() => useFollowUpSuggestions({ raw: '', enhanced: '' }));
    await act(async () => {
      await result.current.fetchFollowUps();
    });
    expect(callModel).not.toHaveBeenCalled();
  });

  it('invalidates suggestions when the enhanced output changes', async () => {
    callModel.mockResolvedValue(respondWith([{ title: 'Next', prompt: 'Do the next thing.' }]));
    const { result, rerender } = renderHook(
      ({ enhanced }) => useFollowUpSuggestions({ raw: 'raw', enhanced }),
      { initialProps: { enhanced: 'first output' } },
    );

    await act(async () => {
      await result.current.fetchFollowUps();
    });
    expect(result.current.followUps).toHaveLength(1);

    rerender({ enhanced: 'second output' });
    await waitFor(() => {
      expect(result.current.followUps).toEqual([]);
    });
  });
  it('sends actual selected output and captures the source and generation models', async () => {
    callModel.mockResolvedValueOnce({ ...respondWith([{ title: 'Next', prompt: 'Next step' }]), provider: 'openai', model: 'actual-model' });
    const source = { text: 'Actual saved answer', kind: 'run-output', runId: 'run-1', promptId: 'parent', promptVersionId: 'v1', provider: 'anthropic', model: 'source-model' };
    const { result } = renderHook(() => useFollowUpSuggestions({ raw: 'Draft', enhanced: 'Enhanced instructions', source }));
    await act(async () => { await result.current.fetchFollowUps(); });
    expect(callModel.mock.calls[0][0].messages[0].content).toBe('Actual saved answer');
    expect(result.current.followUps[0].origin).toMatchObject({ sourceKind: 'run-output', sourceRunId: 'run-1', sourcePromptId: 'parent', sourceModel: 'source-model', generationModel: 'actual-model', generationProvider: 'openai' });
  });

  it('aborts old owners and ignores late completion while a new request is active', async () => {
    let resolveOld;
    callModel.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result, rerender, unmount } = renderHook(({ raw }) => useFollowUpSuggestions({ raw, enhanced: '' }), { initialProps: { raw: 'Old draft' } });
    let old;
    act(() => { old = result.current.fetchFollowUps(); result.current.fetchFollowUps(); });
    expect(callModel).toHaveBeenCalledTimes(1);
    const signal = callModel.mock.calls[0][1].signal;
    rerender({ raw: 'New draft' });
    expect(signal.aborted).toBe(true);
    callModel.mockResolvedValueOnce(respondWith([{ title: 'New', prompt: 'New next step' }]));
    await act(async () => { await result.current.fetchFollowUps(); });
    await act(async () => { resolveOld(respondWith([{ title: 'Old', prompt: 'Old next step' }])); await old; });
    expect(result.current.followUps[0].title).toBe('New');
    unmount();
  });

  it('requires preflight for sensitive saved output and marks redaction in provenance', async () => {
    callModel.mockResolvedValueOnce(respondWith([{ title: 'Next', prompt: 'Safe next step' }]));
    const { result } = renderHook(() => useFollowUpSuggestions({ raw: '', enhanced: '', source: { kind: 'run-output', text: 'Contact alice@example.com about the result', runId: 'private-run' } }));
    await act(async () => { await result.current.fetchFollowUps(); });
    expect(callModel).not.toHaveBeenCalled();
    expect(result.current.piiWarning).toBeTruthy();
    await act(async () => { await result.current.piiRedactAndSend(); });
    expect(callModel.mock.calls[0][0].messages[0].content).not.toContain('alice@example.com');
    expect(result.current.followUps[0].origin.redacted).toBe(true);
  });

});
