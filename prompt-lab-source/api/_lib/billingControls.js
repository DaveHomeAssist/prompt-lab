import { fetchWithTimeout, isBillingTimeoutError } from './billingNetwork.js';
import { jsonResponse } from './stripeBilling.js';

const RATE_LIMIT_WINDOW_MS = 60_000;
const BURST_WINDOW_MS = 10_000;
const BURST_MULTIPLIER = 2;
const DEFAULT_RATE_LIMIT_PREFIX = 'promptlab:billing:rate';
const DEFAULT_CIRCUIT_PREFIX = 'promptlab:billing:circuit';
const BILLING_DISABLED_MESSAGE = 'Hosted billing is temporarily unavailable.';
const BILLING_RATE_LIMIT_MESSAGE = 'Too many billing requests. Please wait and try again.';

const memoryWindows = new Map();
const memoryCircuits = new Map();

function readStringEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readIntEnv(name, fallback) {
  const value = Number.parseInt(readStringEnv(name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBooleanEnv(name, fallback = false) {
  const value = readStringEnv(name);
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readCsvEnv(...names) {
  const raw = readStringEnv(...names);
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function pruneMap(map, now = Date.now()) {
  if (map.size > 500) {
    for (const [key, value] of map) {
      if (!value || now >= value.resetAt) map.delete(key);
    }
  }
}

function getRedisConfig() {
  const redisUrl = readStringEnv('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL').replace(/\/+$/, '');
  const redisToken = readStringEnv('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) return null;
  return { redisUrl, redisToken };
}

async function redisCommand(command, args = [], bodyValue = null) {
  const config = getRedisConfig();
  if (!config) return null;
  const path = [command.toLowerCase(), ...args.map((value) => encodeURIComponent(String(value)))].join('/');
  const response = await fetchWithTimeout(`${config.redisUrl}/${path}`, {
    method: bodyValue == null ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${config.redisToken}`,
      ...(bodyValue == null ? {} : { 'Content-Type': 'text/plain;charset=UTF-8' }),
    },
    ...(bodyValue == null ? {} : { body: String(bodyValue) }),
  }, {
    timeoutMessage: 'Billing control request timed out.',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error || `Redis ${command} failed.`);
  }
  return payload?.result;
}

function getRateLimitPrefix() {
  return readStringEnv('PROMPTLAB_BILLING_RATE_LIMIT_PREFIX') || DEFAULT_RATE_LIMIT_PREFIX;
}

function getCircuitPrefix() {
  return readStringEnv('PROMPTLAB_BILLING_CIRCUIT_PREFIX') || DEFAULT_CIRCUIT_PREFIX;
}

function getUserLimit(route) {
  switch (route) {
    case 'license':
      return readIntEnv('BILLING_LICENSE_USER_LIMIT_PER_MIN', 5);
    case 'checkout':
      return readIntEnv('BILLING_CHECKOUT_USER_LIMIT_PER_MIN', 10);
    case 'portal':
      return readIntEnv('BILLING_PORTAL_USER_LIMIT_PER_MIN', 10);
    default:
      return 10;
  }
}

function getGlobalLimit(route) {
  switch (route) {
    case 'license':
      return readIntEnv('BILLING_LICENSE_GLOBAL_LIMIT_PER_MIN', 20);
    default:
      return 0;
  }
}

function getBurstLimit(limit) {
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.max(1, Math.ceil((limit * BURST_MULTIPLIER * BURST_WINDOW_MS) / RATE_LIMIT_WINDOW_MS));
}

function buildWindowKey(namespace, route, subject) {
  return `${getRateLimitPrefix()}:${namespace}:${route}:${subject}`;
}

function buildCircuitKey(route) {
  return `${getCircuitPrefix()}:${route}`;
}

function incrementMemoryWindow(key, windowMs) {
  const now = Date.now();
  let entry = memoryWindows.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    memoryWindows.set(key, entry);
  }
  entry.count += 1;
  pruneMap(memoryWindows, now);
  return {
    count: entry.count,
    resetAt: entry.resetAt,
    store: 'memory',
  };
}

async function incrementPersistentWindow(key, windowMs) {
  const count = Number(await redisCommand('incr', [key]));
  let ttlMs = Number(await redisCommand('pttl', [key]));
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    await redisCommand('pexpire', [key, windowMs]);
    ttlMs = windowMs;
  }
  return {
    count,
    resetAt: Date.now() + Math.max(0, ttlMs),
    store: 'kv',
  };
}

async function incrementWindow(namespace, route, subject, windowMs) {
  const key = buildWindowKey(namespace, route, subject);
  if (getRedisConfig()) {
    try {
      return await incrementPersistentWindow(key, windowMs);
    } catch (error) {
      console.warn(`[Billing] route=${route} action=rate-limit-store auth=no status=0 duration=0 timeout=${isBillingTimeoutError(error) ? 'true' : 'false'} note=store-fallback`);
    }
  }
  return incrementMemoryWindow(key, windowMs);
}

function normalizeIdentityKey(identity) {
  const userId = String(identity?.userId || '').trim();
  if (userId) return `user:${userId}`;
  const email = String(identity?.customerEmail || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  return '';
}

function sanitizeLogValue(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._:/=+-]/g, '');
}

function getClientIp(request) {
  const forwardedFor = request.headers.get('x-forwarded-for') || request.headers.get('X-Forwarded-For') || '';
  const firstForwarded = forwardedFor.split(',')[0]?.trim();
  if (firstForwarded) return firstForwarded;
  const realIp = request.headers.get('x-real-ip') || request.headers.get('X-Real-IP') || '';
  return realIp.trim();
}

function getRequestId(request) {
  const requestId = request.headers.get('x-vercel-id') || request.headers.get('X-Vercel-Id') || '';
  if (requestId.trim()) return requestId.trim();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `billing-${Date.now()}`;
}

function getForcedOpenRoutes() {
  return new Set(readCsvEnv('BILLING_CIRCUIT_OPEN_ROUTES', 'BILLING_FORCE_OPEN_ROUTES'));
}

function isBillingEnabled() {
  return readBooleanEnv('BILLING_ENABLED', true);
}

function getCircuitRecordFromMemory(route) {
  return memoryCircuits.get(route) || null;
}

async function getCircuitRecord(route) {
  if (getForcedOpenRoutes().has(route) || getForcedOpenRoutes().has('*')) {
    return {
      route,
      reason: 'forced-open',
      openedAt: new Date().toISOString(),
      source: 'env',
    };
  }

  if (getRedisConfig()) {
    try {
      const payload = await redisCommand('get', [buildCircuitKey(route)]);
      if (payload) {
        return JSON.parse(String(payload));
      }
    } catch (error) {
      console.warn(`[Billing] route=${route} action=circuit-store auth=no status=0 duration=0 timeout=${isBillingTimeoutError(error) ? 'true' : 'false'} note=store-fallback`);
    }
  }

  return getCircuitRecordFromMemory(route);
}

export async function tripBillingCircuit(route, reason) {
  const record = {
    route,
    reason: String(reason || 'timeout').trim() || 'timeout',
    openedAt: new Date().toISOString(),
    source: getRedisConfig() ? 'kv' : 'memory',
  };

  if (getRedisConfig()) {
    try {
      await redisCommand('set', [buildCircuitKey(route)], JSON.stringify(record));
    } catch (error) {
      memoryCircuits.set(route, record);
      console.warn(`[Billing] route=${route} action=circuit-store auth=no status=0 duration=0 timeout=${isBillingTimeoutError(error) ? 'true' : 'false'} note=store-fallback`);
      return record;
    }
  } else {
    memoryCircuits.set(route, record);
  }

  return record;
}

function buildRateLimitRules(route, identity) {
  const rules = [];
  const identityKey = normalizeIdentityKey(identity);
  if (identityKey) {
    rules.push({
      namespace: 'user',
      subject: identityKey,
      limit: getUserLimit(route),
    });
  }

  const globalLimit = getGlobalLimit(route);
  if (globalLimit > 0) {
    rules.push({
      namespace: 'global',
      subject: 'all',
      limit: globalLimit,
    });
  }

  return rules;
}

async function checkRateLimitRule(route, rule) {
  if (!rule.limit || rule.limit <= 0) return null;

  const burstLimit = getBurstLimit(rule.limit);
  const [minuteState, burstState] = await Promise.all([
    incrementWindow(`${rule.namespace}:minute`, route, rule.subject, RATE_LIMIT_WINDOW_MS),
    incrementWindow(`${rule.namespace}:burst`, route, rule.subject, BURST_WINDOW_MS),
  ]);

  const limited = minuteState.count > rule.limit || burstState.count > burstLimit;
  if (!limited) return null;

  const retryAfterMs = Math.max(
    1,
    Math.min(
      Math.max(0, minuteState.resetAt - Date.now()),
      Math.max(0, burstState.resetAt - Date.now()),
    ),
  );

  return {
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    limit: rule.limit,
    burstLimit,
  };
}

export async function enforceBillingRouteControls({ request, route, identity }) {
  const requestId = getRequestId(request);
  const clientIp = getClientIp(request);

  if (!isBillingEnabled()) {
    return {
      requestId,
      clientIp,
      status: 503,
      response: jsonResponse({ error: BILLING_DISABLED_MESSAGE }, 503),
    };
  }

  const circuit = await getCircuitRecord(route);
  if (circuit) {
    return {
      requestId,
      clientIp,
      status: 503,
      response: jsonResponse({ error: BILLING_DISABLED_MESSAGE }, 503),
      circuit,
    };
  }

  const rules = buildRateLimitRules(route, identity);
  for (const rule of rules) {
    const limited = await checkRateLimitRule(route, rule);
    if (!limited) continue;
    return {
      requestId,
      clientIp,
      status: 429,
      response: jsonResponse({ error: BILLING_RATE_LIMIT_MESSAGE }, 429, {
        'Retry-After': String(limited.retryAfterSeconds),
      }),
      limited,
    };
  }

  return {
    requestId,
    clientIp,
    status: 200,
    response: null,
  };
}

export async function recordBillingRouteFailure({ route, error }) {
  if (!isBillingTimeoutError(error)) return null;
  return tripBillingCircuit(route, error?.message || 'timeout');
}

export function logBillingRouteResult({
  route,
  action = 'request',
  identity,
  status,
  startedAt,
  timeout = false,
  requestId = '',
  note = '',
  clientIp = '',
}) {
  const duration = Math.max(0, Date.now() - Number(startedAt || Date.now()));
  const auth = identity?.isAuthenticated ? 'yes' : 'no';
  const parts = [
    `[Billing] route=${sanitizeLogValue(route)}`,
    `action=${sanitizeLogValue(action) || 'request'}`,
    `auth=${auth}`,
    `status=${Number(status || 0)}`,
    `duration=${duration}`,
    `timeout=${timeout ? 'true' : 'false'}`,
  ];

  if (requestId) parts.push(`requestId=${sanitizeLogValue(requestId)}`);
  if (clientIp) parts.push(`ip=${sanitizeLogValue(clientIp)}`);
  if (note) parts.push(`note=${sanitizeLogValue(note)}`);

  console.info(parts.join(' '));
}

export function resetBillingControlState() {
  memoryWindows.clear();
  memoryCircuits.clear();
}
