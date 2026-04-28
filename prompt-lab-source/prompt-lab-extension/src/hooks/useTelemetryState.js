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

const TELEMETRY_CONSENT_KEY = 'pl_telemetry_consent';

function loadConsentState() {
  try {
    const value = localStorage.getItem(TELEMETRY_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

function saveConsentState(value) {
  try {
    if (value === 'granted' || value === 'denied') {
      localStorage.setItem(TELEMETRY_CONSENT_KEY, value);
    } else {
      localStorage.removeItem(TELEMETRY_CONSENT_KEY);
    }
  } catch {
    // Consent remains in React state for this session if storage is unavailable.
  }
}

export default function useTelemetryState({ notify }) {
  const [state, setState] = useState(() => normalizeTelemetryState(
    loadJson(storageKeys.telemetry, createDefaultTelemetryState()),
  ));
  const [consentGiven, setConsentGiven] = useState(() => loadConsentState());
  const [busyAction, setBusyAction] = useState('');
  const [sessionId] = useState(() => createSessionId());
  const apiBase = getTelemetryApiBase();
  const surface = getTelemetrySurface();
  const telemetryAllowed = consentGiven === 'granted';

  useEffect(() => {
    saveJson(storageKeys.telemetry, state);
  }, [state]);

  useEffect(() => {
    setState((prev) => {
      const nextPendingEvents = telemetryAllowed ? prev.pendingEvents : [];
      if (
        prev.telemetryEnabled === telemetryAllowed &&
        nextPendingEvents.length === prev.pendingEvents.length
      ) {
        return prev;
      }
      return normalizeTelemetryState({
        ...prev,
        telemetryEnabled: telemetryAllowed,
        pendingEvents: nextPendingEvents,
      });
    });
  }, [telemetryAllowed]);

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
    if (!telemetryAllowed || !state.telemetryEnabled || state.pendingEvents.length === 0) return;

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
  }, [sendPayload, state.pendingEvents, state.telemetryEnabled, telemetryAllowed]);

  useEffect(() => {
    if (telemetryAllowed && state.telemetryEnabled && state.pendingEvents.length > 0) {
      flushPending();
    }
  }, [flushPending, state.pendingEvents.length, state.telemetryEnabled, telemetryAllowed]);

  const track = useCallback(async (event, context = {}) => {
    if (!telemetryAllowed || !state.telemetryEnabled) return false;

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
  }, [sendPayload, sessionId, state, telemetryAllowed]);

  const updatePreferences = useCallback(async ({ telemetryEnabled, contactEmail }) => {
    const nextConsent = telemetryEnabled ? 'granted' : 'denied';
    saveConsentState(nextConsent);
    setConsentGiven(nextConsent);
    const nextState = normalizeTelemetryState({
      ...state,
      telemetryEnabled,
      contactEmail,
      pendingEvents: telemetryEnabled ? state.pendingEvents : [],
    });

    setState(nextState);
    if (!telemetryEnabled) {
      notify?.('Insights preferences updated.');
      return true;
    }

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

  const grantConsent = useCallback(() => {
    saveConsentState('granted');
    setConsentGiven('granted');
    setState((prev) => normalizeTelemetryState({
      ...prev,
      telemetryEnabled: true,
    }));
  }, []);

  const denyConsent = useCallback(() => {
    saveConsentState('denied');
    setConsentGiven('denied');
    setState((prev) => normalizeTelemetryState({
      ...prev,
      telemetryEnabled: false,
      pendingEvents: [],
      lastError: '',
    }));
  }, []);

  const telemetry = useMemo(() => ({
    ...state,
    consentGiven,
    busyAction,
    sessionId,
    surface,
    queueSize: state.pendingEvents.length,
    track,
    flushPending,
    updatePreferences,
    grantConsent,
    denyConsent,
  }), [busyAction, consentGiven, denyConsent, flushPending, grantConsent, sessionId, state, surface, track, updatePreferences]);

  return telemetry;
}
