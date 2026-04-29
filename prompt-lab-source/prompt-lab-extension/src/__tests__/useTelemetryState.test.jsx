import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useTelemetryState from '../hooks/useTelemetryState.js';
import { createDefaultTelemetryState, normalizeTelemetryState } from '../lib/telemetry.js';

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

  it('defaults telemetry off for new installs', () => {
    expect(createDefaultTelemetryState().telemetryEnabled).toBe(false);
    expect(normalizeTelemetryState({}).telemetryEnabled).toBe(false);
  });

  it('does not send telemetry when disabled', async () => {
    const { result } = renderHook(() => useTelemetryState({ notify: vi.fn() }));

    await act(async () => {
      const tracked = await result.current.track('app.opened', { section: 'create' });
      expect(tracked).toBe(false);
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('clears pending telemetry without calling the API when disabled', async () => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: false,
      pendingEvents: [{ kind: 'event', event: 'app.opened' }],
    }));

    const notify = vi.fn();
    const { result } = renderHook(() => useTelemetryState({ notify }));

    await act(async () => {
      await result.current.updatePreferences({ telemetryEnabled: false, contactEmail: '' });
    });

    expect(result.current.telemetryEnabled).toBe(false);
    expect(result.current.pendingEvents).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Insights preferences updated.');
  });
});
