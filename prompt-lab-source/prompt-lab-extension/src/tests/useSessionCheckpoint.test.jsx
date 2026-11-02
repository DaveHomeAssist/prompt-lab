import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionSave } from '../hooks/useSessionState.js';

const { sessionSet } = vi.hoisted(() => ({ sessionSet: vi.fn() }));
vi.mock('../lib/platform.js', () => ({ sessionSet, sessionGet: vi.fn() }));

describe('draft checkpoint exit and failure recovery', () => {
  beforeEach(() => { vi.useFakeTimers(); sessionSet.mockReset().mockReturnValue(true); });
  afterEach(() => vi.useRealTimers());

  it('flushes the latest edit on immediate refresh before the debounce', () => {
    const { rerender } = renderHook(({ raw }) => useSessionSave({ raw }), { initialProps: { raw: 'Earlier' } });
    rerender({ raw: 'Latest edit' });
    const event = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(sessionSet).toHaveBeenLastCalledWith({ 'pl2-session': { raw: 'Latest edit' } });
    expect(event.defaultPrevented).toBe(false);
  });

  it('shows failure, warns before exit, and retries the latest draft', () => {
    sessionSet.mockReturnValue(false);
    const { result, rerender } = renderHook(({ raw }) => useSessionSave({ raw }), { initialProps: { raw: 'Draft' } });
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.status).toBe('failed');
    const event = new Event('beforeunload', { cancelable: true });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    rerender({ raw: 'Newer draft' });
    sessionSet.mockReturnValue(true);
    act(() => result.current.retry());
    expect(sessionSet).toHaveBeenLastCalledWith({ 'pl2-session': { raw: 'Newer draft' } });
    expect(result.current.status).toBe('saved');
  });

  it('does not let an older rejected write replace a newer acknowledged status', async () => {
    let rejectOld;
    sessionSet.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }));
    const { result, rerender } = renderHook(({ raw }) => useSessionSave({ raw }), { initialProps: { raw: 'Old draft' } });
    act(() => vi.advanceTimersByTime(500));
    rerender({ raw: 'New draft' });
    sessionSet.mockReturnValue(true);
    act(() => result.current.retry());
    await act(async () => rejectOld(new Error('Old failure')));
    expect(result.current.status).toBe('saved');
  });

  it('retains failure for rejected asynchronous writes and releases only an acknowledged checkpoint', async () => {
    sessionSet.mockRejectedValueOnce(new Error('Storage unavailable'));
    const { result } = renderHook(() => useSessionSave({ raw: 'Draft' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(result.current.status).toBe('failed');
    sessionSet.mockResolvedValue(true);
    await act(async () => { await result.current.retry(); });
    expect(result.current.status).toBe('saved');
  });
});
