import { APP_VERSION } from '../constants.js';
import { isExtension } from './platform.js';
import {
  normalizeTelemetryEventName,
  sanitizeTelemetryEventContext,
} from '../../../shared/telemetrySchema.js';

export const TELEMETRY_EVENT_LIMIT = 25;

export function createDefaultTelemetryState() {
  return {
    telemetryEnabled: false,
    contactEmail: '',
    deviceId: createDeviceId(),
    pendingEvents: [],
    lastSyncedAt: '',
    lastError: '',
    deletionPending: false,
  };
}

export function normalizeTelemetryState(value = {}) {
  const fallback = createDefaultTelemetryState();
  return {
    ...fallback,
    ...(value && typeof value === 'object' ? value : {}),
    telemetryEnabled: value?.telemetryEnabled === true,
    contactEmail: typeof value?.contactEmail === 'string' ? value.contactEmail.trim() : '',
    deviceId: typeof value?.deviceId === 'string' && value.deviceId.trim()
      ? value.deviceId.trim()
      : fallback.deviceId,
    pendingEvents: Array.isArray(value?.pendingEvents)
      ? value.pendingEvents
        .filter((envelope) => (
          envelope
          && typeof envelope === 'object'
          && envelope.kind === 'event'
          && envelope.telemetryEnabled === true
          && typeof envelope.event === 'string'
        ))
        .slice(-TELEMETRY_EVENT_LIMIT)
      : [],
    lastSyncedAt: typeof value?.lastSyncedAt === 'string' ? value.lastSyncedAt : '',
    lastError: typeof value?.lastError === 'string' ? value.lastError : '',
    deletionPending: value?.deletionPending === true,
  };
}

export function getTelemetrySurface() {
  if (isExtension) return 'extension';
  if (typeof window !== 'undefined' && /^https?:/i.test(window.location?.origin || '')) return 'web';
  return 'desktop';
}

export function getTelemetryApiBase() {
  const configuredBase = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PROMPTLAB_API_BASE)
      ? String(import.meta.env.VITE_PROMPTLAB_API_BASE)
      : 'https://promptlab.tools'
  ).replace(/\/+$/, '');

  if (typeof window !== 'undefined') {
    const origin = window.location.origin || '';
    const isHostedWebOrigin = /^https?:\/\//.test(origin) && !/localhost|127\.0\.0\.1/.test(origin);
    if (isHostedWebOrigin && !isExtension) {
      return `${origin}/api`;
    }
  }

  return `${configuredBase}/api`;
}

export function createSessionId() {
  return createId('plsess');
}

export function createDeviceId() {
  return createId('pldev');
}

export function buildTelemetryEnvelope(state, sessionId, event, context = {}) {
  const eventName = normalizeTelemetryEventName(event);
  // AN-07: events carry only the anonymous device and session ids. The contact
  // email is sent with the identify payload (buildTelemetryIdentityPayload).
  return {
    kind: 'event',
    event: eventName,
    appVersion: APP_VERSION,
    surface: getTelemetrySurface(),
    deviceId: state.deviceId,
    sessionId,
    telemetryEnabled: state?.telemetryEnabled === true,
    context: sanitizeTelemetryEventContext(eventName, context),
  };
}

export function buildTelemetryIdentityPayload(state, sessionId, overrides = {}) {
  return {
    kind: 'identify',
    appVersion: APP_VERSION,
    surface: getTelemetrySurface(),
    deviceId: overrides.deviceId || state.deviceId,
    sessionId,
    telemetryEnabled: overrides.telemetryEnabled ?? state.telemetryEnabled,
    contactEmail: normalizeEmail(overrides.contactEmail ?? state.contactEmail),
  };
}

// PRIV-02: sent when the user withdraws insights consent. The server deletes
// this device's profile, the contact record written by this device, and this
// device's queued events. The email is only a lookup hint; the server checks
// that the contact record belongs to the same device id before deleting it.
export function buildTelemetryWithdrawalPayload(state) {
  const contactEmail = normalizeEmail(state?.contactEmail);
  return {
    kind: 'withdraw',
    surface: getTelemetrySurface(),
    deviceId: state?.deviceId,
    telemetryEnabled: false,
    ...(contactEmail ? { contactEmail } : {}),
  };
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function createId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
