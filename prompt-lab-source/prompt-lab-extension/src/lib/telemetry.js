import { APP_VERSION } from '../constants.js';
import { isExtension } from './platform.js';
import {
  isLandingTelemetryEvent,
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
    pendingEvents: Array.isArray(value?.pendingEvents) ? value.pendingEvents.slice(-TELEMETRY_EVENT_LIMIT) : [],
    lastSyncedAt: typeof value?.lastSyncedAt === 'string' ? value.lastSyncedAt : '',
    lastError: typeof value?.lastError === 'string' ? value.lastError : '',
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
  const landingEvent = isLandingTelemetryEvent(eventName);
  return {
    kind: 'event',
    event: eventName,
    appVersion: APP_VERSION,
    surface: getTelemetrySurface(),
    deviceId: state.deviceId,
    sessionId,
    telemetryEnabled: state?.telemetryEnabled === true,
    ...(!landingEvent && normalizeEmail(state.contactEmail)
      ? { contactEmail: normalizeEmail(state.contactEmail) }
      : {}),
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
