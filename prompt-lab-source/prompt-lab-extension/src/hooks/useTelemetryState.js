import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';
import {
  buildTelemetryEnvelope,
  buildTelemetryIdentityPayload,
  createDefaultTelemetryState,
  createSessionId,
  getTelemetryApiBase,
  getTelemetrySurface,
  normalizeTelemetryState,
  sanitizeTelemetryContext,
} from '../lib/telemetry.js';

export default function useTelemetryState({ notify }) {
  const [state, setState] = useState(() => normalizeTelemetryState(
    loadJson(storageKeys.telemetry, createDefaultTelemetryState()),
  ));
  const [busyAction, setBusyAction] = useState('');
  const [sessionId] = useState(() => createSessionId());
  const apiBase = getTelemetryApiBase();
  const surface = getTelemetrySurface();

  useEffect(() => {
    saveJson(storageKeys.telemetry, state);
  }, [state]);

  const sendPayload = useCallback(async (payload) => {
    const response = await fetch(`${apiBase}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let message = 'Telemetry request failed.';
      try {
        const body = await response.json();
        if (typeof body?.error === 'string' && body.error.trim()) {
          message = body.error.trim();
        }
      } catch {
        // Ignore malformed error payloads.
      }
      throw new Error(message);
    }
    return response.json().catch(() => ({ ok: true }));
  }, [apiBase]);

  const flushPending = useCallback(async () => {
    if (!state.telemetryEnabled || state.pendingEvents.length === 0) return;

    setBusyAction('flush');
    try {
      for (const envelope of state.pendingEvents) {
        await sendPayload(envelope);
      }
      setState((prev) => ({
        ...prev,
        pendingEvents: [],
        lastSyncedAt: new Date().toISOString(),
        lastError: '',
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, lastError: error.message || 'Telemetry sync failed.' }));
    } finally {
      setBusyAction('');
    }
  }, [sendPayload, state.pendingEvents, state.telemetryEnabled]);

  useEffect(() => {
    if (state.telemetryEnabled && state.pendingEvents.length > 0) {
      flushPending();
    }
  }, [flushPending, state.pendingEvents.length, state.telemetryEnabled]);

  const track = useCallback(async (event, context = {}) => {
    if (!state.telemetryEnabled) return false;

    const envelope = buildTelemetryEnvelope(state, sessionId, event, sanitizeTelemetryContext(context));
    try {
      await sendPayload(envelope);
      setState((prev) => ({
        ...prev,
        lastSyncedAt: new Date().toISOString(),
        lastError: '',
      }));
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        lastError: error.message || 'Telemetry sync failed.',
        pendingEvents: [...prev.pendingEvents, envelope].slice(-25),
      }));
      return false;
    }
  }, [sendPayload, sessionId, state]);

  const updatePreferences = useCallback(async ({ telemetryEnabled, contactEmail }) => {
    const nextState = normalizeTelemetryState({
      ...state,
      telemetryEnabled,
      contactEmail,
    });

    setState(nextState);
    setBusyAction('preferences');
    try {
      await sendPayload(buildTelemetryIdentityPayload(nextState, sessionId, {
        telemetryEnabled: nextState.telemetryEnabled,
        contactEmail: nextState.contactEmail,
      }));
      setState((prev) => ({
        ...prev,
        telemetryEnabled: nextState.telemetryEnabled,
        contactEmail: nextState.contactEmail,
        lastSyncedAt: new Date().toISOString(),
        lastError: '',
      }));
      notify?.('Insights preferences updated.');
      return true;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        telemetryEnabled: nextState.telemetryEnabled,
        contactEmail: nextState.contactEmail,
        lastError: error.message || 'Could not save insights preferences.',
      }));
      notify?.(error.message || 'Could not save insights preferences.');
      return false;
    } finally {
      setBusyAction('');
    }
  }, [notify, sendPayload, sessionId, state]);

  const telemetry = useMemo(() => ({
    ...state,
    busyAction,
    sessionId,
    surface,
    queueSize: state.pendingEvents.length,
    track,
    flushPending,
    updatePreferences,
  }), [busyAction, flushPending, sessionId, state, surface, track, updatePreferences]);

  return telemetry;
}
