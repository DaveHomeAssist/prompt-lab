import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isExtension: false,
}));

import useTelemetryState from '../hooks/useTelemetryState.js';
import { normalizeTelemetryState } from '../lib/telemetry.js';

describe('useTelemetryState', () => {
  const originalFetch = global.fetch;
  let setGoogleAnalyticsConsent;

  beforeEach(() => {
    localStorage.clear();
    setGoogleAnalyticsConsent = vi.fn();
    window.PromptLabGoogleAnalytics = { setConsent: setGoogleAnalyticsConsent };
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.PromptLabGoogleAnalytics;
  });

  it('keeps Google Analytics aligned with the hosted web consent choice', async () => {
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    await waitFor(() => {
      expect(setGoogleAnalyticsConsent).toHaveBeenLastCalledWith(false);
    });

    act(() => {
      result.current.grantConsent();
    });
    await waitFor(() => {
      expect(setGoogleAnalyticsConsent).toHaveBeenLastCalledWith(true);
    });

    act(() => {
      result.current.denyConsent();
    });
    await waitFor(() => {
      expect(setGoogleAnalyticsConsent).toHaveBeenLastCalledWith(false);
    });
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

    // PRIV-02: the only request after withdrawal is the deletion request.
    const sentBodies = global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(sentBodies.filter((body) => body.kind !== 'withdraw')).toEqual([]);
    expect(localStorage.getItem('pl_telemetry_consent')).toBe('denied');
  });

  it('drops legacy queued envelopes that predate explicit consent markers', () => {
    const state = normalizeTelemetryState({
      telemetryEnabled: true,
      pendingEvents: [
        { kind: 'event', event: 'app.opened', context: { section: 'create' } },
        {
          kind: 'event',
          event: 'app.opened',
          telemetryEnabled: true,
          context: { section: 'create' },
        },
      ],
    });

    expect(state.pendingEvents).toEqual([{
      kind: 'event',
      event: 'app.opened',
      telemetryEnabled: true,
      context: { section: 'create' },
    }]);
  });

  describe('PRIV-02 consent withdrawal', () => {
    function withdrawCalls() {
      return global.fetch.mock.calls
        .map(([, init]) => JSON.parse(init.body))
        .filter((body) => body.kind === 'withdraw');
    }

    it('asks the server to delete stored records when consent is withdrawn in settings', async () => {
      const notify = vi.fn();
      const { result } = renderHook(() => useTelemetryState({ notify }));

      await act(async () => {
        await result.current.updatePreferences({ telemetryEnabled: true, contactEmail: 'Person@Example.com' });
      });
      await act(async () => {
        await result.current.updatePreferences({ telemetryEnabled: false, contactEmail: 'Person@Example.com' });
      });

      await waitFor(() => expect(withdrawCalls()).toHaveLength(1));
      const [withdraw] = withdrawCalls();
      expect(withdraw).toMatchObject({
        kind: 'withdraw',
        deviceId: result.current.deviceId,
        contactEmail: 'person@example.com',
        telemetryEnabled: false,
      });
      await waitFor(() => expect(result.current.deletionPending).toBe(false));
      expect(notify).toHaveBeenLastCalledWith(
        'Insights turned off. Stored insights data for this device is being deleted.',
      );
    });

    it('asks the server to delete stored records when consent is withdrawn from the banner', async () => {
      const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));
      act(() => result.current.grantConsent());
      await waitFor(() => expect(result.current.consentGiven).toBe('granted'));
      act(() => result.current.denyConsent());

      await waitFor(() => expect(withdrawCalls()).toHaveLength(1));
      expect(withdrawCalls()[0].deviceId).toBe(result.current.deviceId);
      expect(withdrawCalls()[0]).not.toHaveProperty('contactEmail');
    });

    it('sends nothing when consent was never granted', async () => {
      const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));
      act(() => result.current.denyConsent());
      await act(async () => {
        await result.current.updatePreferences({ telemetryEnabled: false, contactEmail: '' });
      });
      await waitFor(() => expect(result.current.consentGiven).toBe('denied'));
      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.current.deletionPending).toBe(false);
    });

    it('keeps a failed deletion pending and retries it on the next load', async () => {
      localStorage.setItem('pl_telemetry_consent', 'granted');
      global.fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'down' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }));
      const first = renderHook(() => useTelemetryState({ notify: vi.fn() }));
      act(() => first.result.current.denyConsent());
      await waitFor(() => expect(first.result.current.lastError).toMatch(/will retry/));
      expect(first.result.current.deletionPending).toBe(true);
      expect(JSON.parse(localStorage.getItem('pl2-telemetry')).deletionPending).toBe(true);
      first.unmount();

      global.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, withdrawn: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      const second = renderHook(() => useTelemetryState({ notify: vi.fn() }));
      await waitFor(() => expect(withdrawCalls()).toHaveLength(1));
      await waitFor(() => expect(second.result.current.deletionPending).toBe(false));
    });

    it('re-granting consent cancels a withdrawal that has not been sent', () => {
      const state = normalizeTelemetryState({ deletionPending: true });
      expect(state.deletionPending).toBe(true);
      const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));
      act(() => result.current.grantConsent());
      expect(result.current.deletionPending).toBe(false);
    });
  });
});
