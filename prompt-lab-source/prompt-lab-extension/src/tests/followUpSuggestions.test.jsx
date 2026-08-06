import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  buildFollowUpPayload,
  parseFollowUpSuggestions,
  resolveFollowUpSource,
  buildFollowUpLibraryRecord,
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
    expect(payload.system).toBe(FOLLOW_UP_SYSTEM_PROMPT);
    expect(payload.responseFormat).toBe('json');
  });

  it('falls back to the raw prompt when nothing is enhanced', () => {
    const payload = buildFollowUpPayload({ raw: 'raw text', enhanced: '' });
    expect(payload.messages[0].content).toBe('raw text');
  });

  it('grounds follow-ups in a successful run actual output', () => {
    const sourceRun = {
      id: 'run-1',
      status: 'success',
      input: 'Draft an incident update.',
      output: 'Service restored at 14:32 UTC.',
      provider: 'openai',
    };
    const source = resolveFollowUpSource({ raw: 'raw', enhanced: 'enhanced', sourceRun });
    const payload = buildFollowUpPayload({ source });

    expect(source.kind).toBe('run-output');
    expect(source.runId).toBe('run-1');
    expect(payload.messages[0].content).toContain('SOURCE PROMPT:\nDraft an incident update.');
    expect(payload.messages[0].content).toContain('ACTUAL OUTPUT:\nService restored at 14:32 UTC.');
  });

  it('ignores failed run output and falls back to enhanced text', () => {
    const source = resolveFollowUpSource({
      raw: 'raw',
      enhanced: 'enhanced',
      sourceRun: { id: 'run-2', status: 'error', output: 'partial failure' },
    });

    expect(source.kind).toBe('enhanced-prompt');
    expect(source.text).toBe('enhanced');
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

    expect(result.current.followUps).toEqual([
      expect.objectContaining({
        title: 'Refine tone',
        prompt: 'Adjust the tone for executives.',
        generatedAt: expect.any(String),
        source: expect.objectContaining({ kind: 'enhanced-prompt' }),
      }),
    ]);
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

  it('invalidates suggestions when the selected run changes', async () => {
    callModel.mockResolvedValue(respondWith([{ title: 'Next', prompt: 'Do the next thing.' }]));
    const firstRun = { id: 'run-1', status: 'success', output: 'First result' };
    const secondRun = { id: 'run-2', status: 'success', output: 'Second result' };
    const { result, rerender } = renderHook(
      ({ sourceRun }) => useFollowUpSuggestions({ raw: 'raw', enhanced: 'enhanced', sourceRun }),
      { initialProps: { sourceRun: firstRun } },
    );

    await act(async () => {
      await result.current.fetchFollowUps();
    });
    expect(result.current.followUps).toHaveLength(1);
    expect(result.current.source.runId).toBe('run-1');

    rerender({ sourceRun: secondRun });
    await waitFor(() => {
      expect(result.current.followUps).toEqual([]);
    });
    expect(result.current.source.runId).toBe('run-2');
  });
});

describe('buildFollowUpLibraryRecord', () => {
  it('creates an independent record with complete run provenance', () => {
    const record = buildFollowUpLibraryRecord({
      title: 'Audit gaps',
      prompt: 'Audit this result for missing risks.',
      generatedAt: '2026-08-05T13:00:00.000Z',
      source: {
        kind: 'run-output',
        label: 'Actual output from openai',
        promptId: 'prompt-1',
        runId: 'run-1',
        provider: 'openai',
        model: 'gpt-test',
        sourceGeneratedAt: '2026-08-05T12:59:00.000Z',
      },
    });

    expect(record).toMatchObject({
      title: 'Audit gaps',
      raw: 'Audit this result for missing risks.',
      enhanced: 'Audit this result for missing risks.',
      tags: ['follow-up'],
      editingId: null,
      metadata: {
        derivedFrom: 'run-output',
        sourcePromptId: 'prompt-1',
        sourceRunId: 'run-1',
        sourceProvider: 'openai',
        sourceModel: 'gpt-test',
        sourceGeneratedAt: '2026-08-05T12:59:00.000Z',
        followUpGeneratedAt: '2026-08-05T13:00:00.000Z',
      },
    });
  });
});
