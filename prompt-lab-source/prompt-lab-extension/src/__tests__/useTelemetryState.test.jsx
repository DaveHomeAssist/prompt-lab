import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTelemetryState from '../hooks/useTelemetryState.js';

describe('useTelemetryState', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('does not send telemetry before first-run consent is granted', async () => {
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    expect(result.current.consentGiven).toBe(null);
    expect(result.current.telemetryEnabled).toBe(false);

    await act(async () => {
      await result.current.track('app.opened');
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends events after analytics consent is granted', async () => {
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    act(() => {
      result.current.grantConsent();
    });

    await waitFor(() => {
      expect(result.current.consentGiven).toBe('granted');
    });

    await act(async () => {
      await result.current.track('app.opened', { section: 'create' });
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      event: 'app.opened',
      context: { section: 'create' },
    });
  });

  it('does not send future events after consent is denied', async () => {
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    act(() => {
      result.current.grantConsent();
    });
    await waitFor(() => {
      expect(result.current.consentGiven).toBe('granted');
    });

    act(() => {
      result.current.denyConsent();
    });
    await waitFor(() => {
      expect(result.current.consentGiven).toBe('denied');
    });

    await act(async () => {
      await result.current.track('app.opened');
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(localStorage.getItem('pl_telemetry_consent')).toBe('denied');
  });
});
