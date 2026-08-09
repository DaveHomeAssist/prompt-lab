import { fetchWithTimeout, readBoundedIntEnv } from './runtimeSafety.js';
import {
  isLandingTelemetryEvent,
  normalizeTelemetryEventName,
  sanitizeTelemetryEventContext,
  TELEMETRY_EVENT_SCHEMAS,
  TelemetrySchemaError,
} from '../../shared/telemetrySchema.js';

const DEFAULT_PREFIX = 'promptlab';
const DEFAULT_EVENT_LIST_KEY = 'telemetry:events';
const DEFAULT_EVENT_LIST_LIMIT = 2000;
const DEFAULT_REQUEST_MAX_BYTES = 16 * 1024;
const DEFAULT_RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const REDIS_TIMEOUT_MS = 2000;
const rateLimitHits = new Map();

export class TelemetryRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'TelemetryRequestError';
    this.status = status;
  }
}

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readBooleanEnv(name, fallback = false) {
  const value = readStringEnv(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function createCorsHeaders(extraHeaders = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Signature',
    ...extraHeaders,
  };
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...createCorsHeaders(extraHeaders),
    },
  });
}

export function optionsResponse() {
  return new Response(null, {
    status: 204,
    headers: createCorsHeaders(),
  });
}

export async function parseJsonBody(request) {
  const maxBytes = readBoundedIntEnv('PROMPTLAB_TELEMETRY_MAX_BODY_BYTES', DEFAULT_REQUEST_MAX_BYTES, {
    min: 1024,
    max: 64 * 1024,
  });
  const declaredLength = Number.parseInt(request?.headers?.get?.('content-length') || '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new TelemetryRequestError('Telemetry payload is too large.', 413);
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      throw new TelemetryRequestError('Telemetry payload is too large.', 413);
    }
    return JSON.parse(raw || '{}');
  } catch (error) {
    if (error instanceof TelemetryRequestError) throw error;
    throw new TelemetryRequestError('Telemetry payload must be valid JSON.', 400);
  }
}

export async function enforceTelemetryRateLimit(request, config = buildTelemetryConfig()) {
  const limit = readBoundedIntEnv('PROMPTLAB_TELEMETRY_RATE_LIMIT', DEFAULT_RATE_LIMIT, {
    min: 1,
    max: 600,
  });
  const ip = String(
    request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim()
      || request?.headers?.get?.('x-real-ip')
      || 'unknown',
  );

  if (hasRedis(config)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
    const clientHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
    const key = `${config.prefix}:telemetry:rate:${bucket}:${clientHash}`;
    const count = Number(await redisCommand(config, 'incr', [key]));
    if (count === 1) {
      await redisCommand(config, 'expire', [key, Math.ceil((RATE_LIMIT_WINDOW_MS * 2) / 1000)]);
    }
    return {
      limited: count > limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  const now = Date.now();
  let state = rateLimitHits.get(ip);
  if (!state || now >= state.resetAt) {
    state = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitHits.set(ip, state);
  }
  state.count += 1;
  if (rateLimitHits.size > 1000) {
    for (const [key, entry] of rateLimitHits) {
      if (now >= entry.resetAt) rateLimitHits.delete(key);
    }
    while (rateLimitHits.size > 1000) {
      const oldestKey = rateLimitHits.keys().next().value;
      if (oldestKey == null) break;
      rateLimitHits.delete(oldestKey);
    }
  }
  return {
    limited: state.count > limit,
    remaining: Math.max(0, limit - state.count),
    retryAfterSeconds: Math.max(1, Math.ceil((state.resetAt - now) / 1000)),
  };
}

export function assertTelemetryConsent(payload) {
  if (payload?.telemetryEnabled !== true) {
    throw new TelemetryRequestError('Telemetry consent is required.', 400);
  }
}

export function buildTelemetryConfig() {
  return {
    redisUrl: readStringEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, ''),
    redisToken: readStringEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
    prefix: readStringEnv('PROMPTLAB_TELEMETRY_PREFIX') || DEFAULT_PREFIX,
    consoleFallback: readBooleanEnv('PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK', process.env.NODE_ENV !== 'production'),
    eventListLimit: readBoundedIntEnv('PROMPTLAB_TELEMETRY_EVENT_LIST_LIMIT', DEFAULT_EVENT_LIST_LIMIT, {
      min: 100,
      max: 10_000,
    }),
    redisTimeoutMs: readBoundedIntEnv('PROMPTLAB_REDIS_TIMEOUT_MS', REDIS_TIMEOUT_MS, { max: 5000 }),
  };
}

export function normalizeTelemetryEvent(payload = {}, fallbackEvent = '') {
  const eventName = normalizeTelemetryEventName(payload?.event || fallbackEvent);
  if (!TELEMETRY_EVENT_SCHEMAS[eventName]) {
    throw new TelemetryRequestError('A supported telemetry event is required.', 400);
  }

  let context;
  try {
    context = sanitizeTelemetryEventContext(eventName, payload?.context);
  } catch (error) {
    if (error instanceof TelemetrySchemaError) {
      throw new TelemetryRequestError(error.message, 400);
    }
    throw error;
  }

  const landingEvent = isLandingTelemetryEvent(eventName);

  return {
    event: eventName,
    appVersion: normalizeShortString(payload?.appVersion, 32),
    surface: normalizeEnum(payload?.surface, ['extension', 'web', 'desktop', 'server'], 'web'),
    deviceId: normalizeShortString(payload?.deviceId, 120) || `server-${Date.now().toString(36)}`,
    sessionId: normalizeShortString(payload?.sessionId, 120),
    plan: normalizeEnum(payload?.plan, ['free', 'pro'], 'free'),
    ...(!landingEvent && normalizeEmail(payload?.contactEmail)
      ? { contactEmail: normalizeEmail(payload?.contactEmail) }
      : {}),
    telemetryEnabled: payload?.telemetryEnabled === true,
    occurredAt: new Date().toISOString(),
    context,
  };
}

export async function persistTelemetryEvent(event, config = buildTelemetryConfig()) {
  if (process.env.NODE_ENV === 'production' && !hasRedis(config)) {
    return { ok: true, mode: 'disabled' };
  }

  const mode = hasRedis(config) ? 'redis' : (config.consoleFallback ? 'console' : 'noop');
  const payload = JSON.stringify(event);

  if (hasRedis(config)) {
    const prefix = `${config.prefix}:telemetry`;
    const profile = JSON.stringify({
      deviceId: event.deviceId,
      contactEmail: event.contactEmail,
      plan: event.plan,
      surface: event.surface,
      appVersion: event.appVersion,
      telemetryEnabled: event.telemetryEnabled,
      lastSeenAt: event.occurredAt,
      lastEvent: event.event,
      lastContext: event.context,
    });

    const eventListKey = `${prefix}:${DEFAULT_EVENT_LIST_KEY}`;
    const writes = [
      redisCommand(config, 'set', [`${prefix}:profile:${event.deviceId}`], profile),
      redisCommand(config, 'sadd', [`${prefix}:devices`, event.deviceId]),
      redisCommand(config, 'incr', [`${prefix}:count:${event.event}`]),
      redisCommand(config, 'rpush', [eventListKey], payload),
    ];
    if (event.contactEmail) {
      writes.push(
        redisCommand(config, 'set', [`${prefix}:contact:${event.contactEmail}`], profile),
        redisCommand(config, 'sadd', [`${prefix}:emails`, event.contactEmail]),
      );
    }
    await Promise.all(writes);
    await redisCommand(config, 'ltrim', [eventListKey, -config.eventListLimit, -1]);
  } else if (config.consoleFallback) {
    console.log('[promptlab.telemetry]', payload);
  }

  return { ok: true, mode };
}

function hasRedis(config) {
  return Boolean(config.redisUrl && config.redisToken);
}

async function redisCommand(config, command, args = [], bodyValue = null) {
  const path = [command.toLowerCase(), ...args.map((value) => encodeURIComponent(String(value)))].join('/');
  const url = `${config.redisUrl}/${path}`;
  const response = await fetchWithTimeout(url, {
    method: bodyValue == null ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config.redisToken}`,
      ...(bodyValue == null ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' }),
    },
    ...(bodyValue == null ? {} : { body: String(bodyValue) }),
  }, {
    service: 'Redis',
    timeoutMs: config.redisTimeoutMs || REDIS_TIMEOUT_MS,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Redis ${command} failed.`);
  }
  return payload?.result;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeShortString(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}
