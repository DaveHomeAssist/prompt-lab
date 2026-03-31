const DEFAULT_PREFIX = 'promptlab';
const DEFAULT_EVENT_LIST_KEY = 'telemetry:events';

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
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function buildTelemetryConfig() {
  return {
    redisUrl: readStringEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, ''),
    redisToken: readStringEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'),
    prefix: readStringEnv('PROMPTLAB_TELEMETRY_PREFIX') || DEFAULT_PREFIX,
    consoleFallback: readBooleanEnv('PROMPTLAB_TELEMETRY_CONSOLE_FALLBACK', true),
    webhookSecret: readStringEnv('LEMON_SQUEEZY_WEBHOOK_SECRET'),
  };
}

export function normalizeTelemetryEvent(payload = {}, fallbackEvent = '') {
  const eventName = sanitizeEventName(payload?.event || fallbackEvent);
  if (!eventName) throw new Error('A valid event name is required.');

  return {
    event: eventName,
    appVersion: normalizeShortString(payload?.appVersion, 32),
    surface: normalizeEnum(payload?.surface, ['extension', 'web', 'desktop', 'server'], 'web'),
    deviceId: normalizeShortString(payload?.deviceId, 120) || `server-${Date.now().toString(36)}`,
    sessionId: normalizeShortString(payload?.sessionId, 120),
    plan: normalizeEnum(payload?.plan, ['free', 'pro'], 'free'),
    contactEmail: normalizeEmail(payload?.contactEmail),
    telemetryEnabled: payload?.telemetryEnabled !== false,
    occurredAt: new Date().toISOString(),
    context: sanitizeContext(payload?.context),
  };
}

export async function persistTelemetryEvent(event, config = buildTelemetryConfig()) {
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

    await redisCommand(config, 'set', [`${prefix}:profile:${event.deviceId}`], profile);
    await redisCommand(config, 'sadd', [`${prefix}:devices`, event.deviceId]);
    await redisCommand(config, 'incr', [`${prefix}:count:${event.event}`]);
    await redisCommand(config, 'rpush', [`${prefix}:${DEFAULT_EVENT_LIST_KEY}`], payload);
    if (event.contactEmail) {
      await redisCommand(config, 'set', [`${prefix}:contact:${event.contactEmail}`], profile);
      await redisCommand(config, 'sadd', [`${prefix}:emails`, event.contactEmail]);
    }
  } else if (config.consoleFallback) {
    console.log('[promptlab.telemetry]', payload);
  }

  return { ok: true, mode };
}

export async function verifyLemonSignature(rawBody, providedSignature, secret) {
  if (!secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const digest = Array.from(new Uint8Array(signatureBuffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return digest.toLowerCase() === String(providedSignature || '').trim().toLowerCase();
}

export function buildLemonWebhookEvent(payload = {}) {
  const meta = payload?.meta || {};
  const data = payload?.data || {};
  const attributes = data?.attributes || {};
  const custom = meta?.custom_data || {};
  const eventName = sanitizeEventName(`billing.${meta?.event_name || 'webhook.received'}`);
  const deviceId = normalizeShortString(
    custom?.device_id || custom?.deviceId || attributes?.identifier || data?.id,
    120,
  ) || `lemon-${Date.now().toString(36)}`;
  const plan = normalizeEnum(custom?.plan, ['free', 'pro'], 'pro');

  return normalizeTelemetryEvent({
    event: eventName,
    surface: normalizeEnum(custom?.surface, ['extension', 'web', 'desktop', 'server'], 'server'),
    deviceId,
    sessionId: normalizeShortString(custom?.session_id || custom?.sessionId, 120),
    plan,
    contactEmail: normalizeEmail(
      attributes?.user_email ||
      attributes?.customer_email ||
      attributes?.email ||
      custom?.contact_email ||
      custom?.contactEmail
    ),
    context: {
      source: 'lemon-webhook',
      lemonEvent: meta?.event_name || '',
      resourceType: data?.type || '',
      resourceId: data?.id || '',
      status: normalizeShortString(attributes?.status, 40),
      orderIdentifier: normalizeShortString(attributes?.order_identifier, 80),
      productName: normalizeShortString(attributes?.product_name || meta?.custom_data?.product_name, 120),
      variantName: normalizeShortString(attributes?.variant_name, 120),
      productId: normalizeShortString(attributes?.product_id, 40),
      variantId: normalizeShortString(attributes?.variant_id || meta?.variant_id, 40),
      customerName: normalizeShortString(attributes?.user_name || attributes?.customer_name, 120),
      urls: sanitizeContext(attributes?.urls || {}),
    },
  });
}

function hasRedis(config) {
  return Boolean(config.redisUrl && config.redisToken);
}

async function redisCommand(config, command, args = [], bodyValue = null) {
  const path = [command.toLowerCase(), ...args.map((value) => encodeURIComponent(String(value)))].join('/');
  const url = `${config.redisUrl}/${path}`;
  const response = await fetch(url, {
    method: bodyValue == null ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config.redisToken}`,
      ...(bodyValue == null ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' }),
    },
    ...(bodyValue == null ? {} : { body: String(bodyValue) }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Redis ${command} failed.`);
  }
  return payload?.result;
}

function sanitizeEventName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '');
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

function sanitizeContext(value, depth = 0) {
  if (value == null) return null;
  if (depth > 2) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.trim().slice(0, 240);
  if (Array.isArray(value)) {
    return value.slice(0, 12).map((item) => sanitizeContext(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([key, entry]) => [String(key).slice(0, 64), sanitizeContext(entry, depth + 1)])
        .filter(([, entry]) => entry !== undefined)
    );
  }
  return String(value).slice(0, 120);
}
