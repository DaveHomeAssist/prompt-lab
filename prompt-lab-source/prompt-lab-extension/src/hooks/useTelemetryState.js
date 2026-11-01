import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadJson, saveJson, storageKeys } from '../lib/storage.js';
import {
  buildTelemetryEnvelope,
  buildTelemetryIdentityPayload,
  buildTelemetryWithdrawalPayload,
  createDefaultTelemetryState,
  createSessionId,
  getTelemetryApiBase,
  getTelemetrySurface,
  normalizeTelemetryState,
} from '../lib/telemetry.js';
import { isLandingTelemetryEvent } from '../../../shared/telemetrySchema.js';

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

// A device that never granted consent has nothing stored server-side, so a
// first-time "No thanks" sends no request at all.
function wasGranted(consentGiven, state) {
  return consentGiven === 'granted' || state?.telemetryEnabled === true || Boolean(state?.lastSyncedAt);
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

  useEffect(() => {
    if (surface !== 'web' || typeof window === 'undefined') return;
    window.PromptLabGoogleAnalytics?.setConsent?.(telemetryAllowed);
  }, [surface, telemetryAllowed]);

  const sendPayload = useCallback(async (payload) => {
    const landingEvent = payload?.kind === 'event' && isLandingTelemetryEvent(payload?.event);
    const requestPayload = { ...payload };
    if (landingEvent) delete requestPayload.contactEmail;
    const endpoint = payload?.kind === 'withdraw'
      ? `${apiBase}/telemetry?action=withdraw`
      : `${apiBase}/telemetry`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
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

  // PRIV-02: withdrawing consent asks the server to delete this device's stored
  // profile, linked contact record and queued events. If the request fails it
  // stays pending in local state and is retried on the next load.
  const requestDeletion = useCallback(async (snapshot) => {
    try {
      await sendPayload(buildTelemetryWithdrawalPayload(snapshot));
      setState((prev) => ({ ...prev, deletionPending: false, lastError: '' }));
      return true;
    } catch {
      setState((prev) => ({
        ...prev,
        deletionPending: true,
        lastError: 'Could not delete stored insights data yet. Prompt Lab will retry.',
      }));
      return false;
    }
  }, [sendPayload]);

  useEffect(() => {
    if (!telemetryAllowed && state.deletionPending) {
      requestDeletion(state);
    }
    // Retry once per load or whenever a new withdrawal is recorded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestDeletion, state.deletionPending, telemetryAllowed]);

  const track = useCallback(async (event, context = {}, { includeContactEmail = true } = {}) => {
    if (!telemetryAllowed || !state.telemetryEnabled) return false;

    const envelopeState = includeContactEmail ? state : { ...state, contactEmail: '' };
    let envelope = null;
    try {
      envelope = buildTelemetryEnvelope(envelopeState, sessionId, event, context);
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
        pendingEvents: envelope
          ? [...prev.pendingEvents, envelope].slice(-25)
          : prev.pendingEvents,
      }));
      return false;
    }
  }, [sendPayload, sessionId, state, telemetryAllowed]);

  const updatePreferences = useCallback(async ({ telemetryEnabled, contactEmail }) => {
    const nextConsent = telemetryEnabled ? 'granted' : 'denied';
    const withdrawing = !telemetryEnabled && wasGranted(consentGiven, state);
    saveConsentState(nextConsent);
    setConsentGiven(nextConsent);
    const nextState = normalizeTelemetryState({
      ...state,
      telemetryEnabled,
      contactEmail,
      pendingEvents: telemetryEnabled ? state.pendingEvents : [],
      // Re-granting consent cancels a withdrawal that has not reached the server.
      deletionPending: telemetryEnabled ? false : (withdrawing || state.deletionPending),
    });

    setState(nextState);
    if (!telemetryEnabled) {
      notify?.(withdrawing
        ? 'Insights turned off. Stored insights data for this device is being deleted.'
        : 'Insights preferences updated.');
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
  }, [consentGiven, notify, sendPayload, sessionId, state]);

  const grantConsent = useCallback(() => {
    saveConsentState('granted');
    setConsentGiven('granted');
    setState((prev) => normalizeTelemetryState({
      ...prev,
      telemetryEnabled: true,
      deletionPending: false,
    }));
  }, []);

  const denyConsent = useCallback(() => {
    const withdrawing = wasGranted(consentGiven, state);
    saveConsentState('denied');
    setConsentGiven('denied');
    setState((prev) => normalizeTelemetryState({
      ...prev,
      telemetryEnabled: false,
      pendingEvents: [],
      lastError: '',
      deletionPending: withdrawing || prev.deletionPending,
    }));
  }, [consentGiven, state]);

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
