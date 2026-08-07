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
      telemetryEnabled: true,
      context: { section: 'create' },
    });
  });

  it('omits an optional contact email from content-free landing events', async () => {
    localStorage.setItem('pl_telemetry_consent', 'granted');
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: true,
      contactEmail: 'private@example.com',
    }));
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    await act(async () => {
      await result.current.track(
        'landing.cta_clicked',
        {
          attributionVersion: 1,
          placement: 'pricing_pro',
          intent: 'upgrade',
          destination: 'app',
          period: 'annual',
        },
        { includeContactEmail: false },
      );
    });

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({
      event: 'landing.cta_clicked',
      context: {
        attributionVersion: 1,
        placement: 'pricing_pro',
        intent: 'upgrade',
        destination: 'app',
        period: 'annual',
      },
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty('contactEmail');
    expect(global.fetch.mock.calls[0][1].body).not.toContain('private@example.com');
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
