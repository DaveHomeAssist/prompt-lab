import { APP_VERSION } from '../constants.js';
import { isExtension } from './platform.js';

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
  return {
    kind: 'event',
    event,
    appVersion: APP_VERSION,
    surface: getTelemetrySurface(),
    deviceId: state.deviceId,
    sessionId,
    contactEmail: normalizeEmail(state.contactEmail),
    context: sanitizeTelemetryContext(context),
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

export function sanitizeTelemetryContext(value, depth = 0) {
  if (value == null) return null;
  if (depth > 2) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim().slice(0, 240);
  if (Array.isArray(value)) {
    return value.slice(0, 12)
      .map((item) => sanitizeTelemetryContext(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, item]) => [key.slice(0, 64), sanitizeTelemetryContext(item, depth + 1)])
        .filter(([, item]) => item !== undefined)
    );
  }
  return String(value).slice(0, 120);
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
