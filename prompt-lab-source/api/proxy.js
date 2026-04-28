export const config = { runtime: 'edge' };

const SHARED_KEY_PLACEHOLDER = '__plb_hosted_shared_key__';
const SUPPORTED_HOST = 'api.anthropic.com';
const DEFAULT_ALLOWED_MODELS = ['claude-sonnet-4-20250514'];
const DEFAULT_BURST_LIMIT = 30;
const BURST_WINDOW_MS = 60_000;
const DEFAULT_DEMO_DAILY_LIMIT = 3;
const DEMO_WINDOW_MS = 24 * 60 * 60_000;
const DEFAULT_MAX_TOKENS = 2048;

const burstHits = new Map();
const demoHits = new Map();

function readIntEnv(name, fallback) {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readListEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
}

function getAllowedModels() {
  return readListEnv('HOSTED_ALLOWED_ANTHROPIC_MODELS', DEFAULT_ALLOWED_MODELS);
}

function getBurstLimit() {
  return readIntEnv('HOSTED_BURST_LIMIT', DEFAULT_BURST_LIMIT);
}

function getDemoDailyLimit() {
  return readIntEnv('HOSTED_DEMO_DAILY_LIMIT', DEFAULT_DEMO_DAILY_LIMIT);
}

function getHostedMaxTokens() {
  return readIntEnv('HOSTED_MAX_TOKENS', DEFAULT_MAX_TOKENS);
}

function pruneMap(map, now) {
  if (map.size > 500) {
    for (const [key, value] of map) {
      if (now >= value.resetAt) map.delete(key);
    }
  }
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    normalized[String(key).toLowerCase()] = String(value);
  }
  return normalized;
}

function isPlaceholderValue(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed === SHARED_KEY_PLACEHOLDER
    || trimmed === `Bearer ${SHARED_KEY_PLACEHOLDER}`;
}

function stripPlaceholderAuth(headers) {
  const next = { ...headers };
  if (isPlaceholderValue(next['x-api-key'])) delete next['x-api-key'];
  if (isPlaceholderValue(next.authorization)) delete next.authorization;
  return next;
}

function hasAuth(headers) {
  return Boolean(headers['x-api-key'] || headers.authorization);
}

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return {
    url: url.replace(/\/+$/, ''),
    token,
  };
}

async function redisCommand(command, ...parts) {
  const config = getRedisConfig();
  if (!config) return null;

  const path = [command, ...parts].map((part) => encodeURIComponent(String(part))).join('/');
  const response = await fetch(`${config.url}/${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.token}` },
  });

  if (!response.ok) {
    throw new Error(`Rate limit store returned ${response.status}`);
  }

  const data = await response.json();
  return data?.result;
}

function incrementMemoryWindow(map, key, windowMs) {
  const now = Date.now();
  let entry = map.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    map.set(key, entry);
  }
  entry.count += 1;
  pruneMap(map, now);
  return {
    count: entry.count,
    resetAt: entry.resetAt,
    store: 'memory',
  };
}

async function incrementPersistentWindow(namespace, key, windowMs) {
  const redisKey = `plb:${namespace}:${key}`;
  const count = Number(await redisCommand('incr', redisKey));
  let ttlMs = Number(await redisCommand('pttl', redisKey));

  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    await redisCommand('pexpire', redisKey, windowMs);
    ttlMs = windowMs;
  }

  return {
    count,
    resetAt: Date.now() + Math.max(0, ttlMs),
    store: 'kv',
  };
}

async function incrementWindow(namespace, key, windowMs, memoryMap) {
  if (getRedisConfig()) {
    try {
      return await incrementPersistentWindow(namespace, key, windowMs);
    } catch (error) {
      console.warn(`[proxy] persistent rate limit unavailable for ${namespace}: ${error.message}`);
    }
  }

  return incrementMemoryWindow(memoryMap, key, windowMs);
}

async function getBurstState(ip) {
  const limit = getBurstLimit();
  if (limit <= 0) {
    return { limited: false, remaining: null, resetAt: null, store: getRedisConfig() ? 'kv' : 'memory' };
  }

  const state = await incrementWindow('burst', ip, BURST_WINDOW_MS, burstHits);
  return {
    limited: state.count > limit,
    remaining: Math.max(0, limit - state.count),
    resetAt: state.resetAt,
    store: state.store,
  };
}

async function getDemoState(ip) {
  const limit = getDemoDailyLimit();
  if (limit <= 0) {
    return { limited: false, remaining: null, resetAt: null, store: getRedisConfig() ? 'kv' : 'memory' };
  }

  const state = await incrementWindow('demo', ip, DEMO_WINDOW_MS, demoHits);
  return {
    limited: state.count > limit,
    remaining: Math.max(0, limit - state.count),
    resetAt: state.resetAt,
    store: state.store,
  };
}

function getServerKey(host) {
  if (host === SUPPORTED_HOST) return process.env.ANTHROPIC_API_KEY || '';
  return '';
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...extraHeaders,
    },
  });
}

function validateTargetUrl(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('Invalid targetUrl');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('HTTPS required');
  }

  if (parsed.hostname !== SUPPORTED_HOST) {
    throw new Error('Hosted Prompt Lab currently supports Anthropic only.');
  }

  return parsed;
}

function sanitizeAnthropicBody(rawBody) {
  let payload;

  try {
    payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  } catch {
    throw new Error('Invalid provider request body');
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid provider request body');
  }

  const allowedModels = getAllowedModels();
  const defaultModel = allowedModels[0];
  const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : '';
  const hostedMaxTokens = Math.max(1, getHostedMaxTokens());
  const requestedMaxTokens = Number(payload.max_tokens);

  payload.model = allowedModels.includes(requestedModel) ? requestedModel : defaultModel;
  payload.max_tokens = Number.isFinite(requestedMaxTokens) && requestedMaxTokens > 0
    ? Math.min(Math.floor(requestedMaxTokens), hostedMaxTokens)
    : hostedMaxTokens;

  return {
    body: JSON.stringify(payload),
    model: payload.model,
    maxTokens: payload.max_tokens,
  };
}

function resolveAuth(headers) {
  const sanitized = stripPlaceholderAuth(normalizeHeaders(headers));
  return {
    headers: sanitized,
    usingSharedKey: !hasAuth(sanitized),
  };
}

function injectServerKey(url, headers, usingSharedKey) {
  if (!usingSharedKey) {
    return { url, headers };
  }

  const serverKey = getServerKey(new URL(url).hostname);
  if (!serverKey) {
    throw new Error('Hosted Anthropic key is not configured.');
  }

  return {
    url,
    headers: {
      ...headers,
      'x-api-key': serverKey,
    },
  };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const burstState = await getBurstState(clientIp);
  if (burstState.limited) {
    return jsonResponse(
      { error: 'Rate limit exceeded. Try again shortly.' },
      429,
      {
        'X-RateLimit-Store': burstState.store,
        ...(burstState.resetAt ? { 'X-RateLimit-Reset': new Date(burstState.resetAt).toISOString() } : {}),
      },
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { targetUrl, headers = {}, body } = payload || {};

  if (!targetUrl) {
    return jsonResponse({ error: 'Missing targetUrl' }, 400);
  }

  let parsedUrl;
  try {
    parsedUrl = validateTargetUrl(targetUrl);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Invalid targetUrl' }, 403);
  }

  const auth = resolveAuth(headers);

  let demoState = null;
  if (auth.usingSharedKey) {
    demoState = await getDemoState(clientIp);
    if (demoState.limited) {
      return jsonResponse(
        {
          error: 'Daily hosted demo limit reached. Add your own Anthropic key to keep going.',
          demo_remaining: 0,
          demo_reset_at: demoState.resetAt ? new Date(demoState.resetAt).toISOString() : null,
        },
        429,
        {
          'X-Demo-Remaining': '0',
          'X-RateLimit-Store': demoState.store,
          ...(demoState.resetAt ? { 'X-Demo-Reset': new Date(demoState.resetAt).toISOString() } : {}),
        },
      );
    }
  }

  let sanitizedBody;
  try {
    sanitizedBody = sanitizeAnthropicBody(body);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Invalid provider request body' }, 400);
  }

  let injected;
  try {
    injected = injectServerKey(parsedUrl.toString(), auth.headers, auth.usingSharedKey);
  } catch (error) {
    return jsonResponse({ error: error.message || 'Hosted provider key is unavailable.' }, 503);
  }

  try {
    const upstream = await fetch(injected.url, {
      method: 'POST',
      headers: injected.headers,
      body: sanitizedBody.body,
    });

    const responseHeaders = {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Hosted-Provider': 'anthropic',
      'X-Hosted-Model': sanitizedBody.model,
      'X-Hosted-Max-Tokens': String(sanitizedBody.maxTokens),
      'X-RateLimit-Store': auth.usingSharedKey
        ? demoState?.store || burstState.store
        : burstState.store,
    };

    if (auth.usingSharedKey && demoState?.remaining != null) {
      responseHeaders['X-Demo-Remaining'] = String(demoState.remaining);
      if (demoState.resetAt) {
        responseHeaders['X-Demo-Reset'] = new Date(demoState.resetAt).toISOString();
      }
    }

    if (upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    const responseBody = await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonResponse(
      { error: error.message || 'Upstream fetch failed' },
      502,
      { 'X-RateLimit-Store': auth.usingSharedKey ? demoState?.store || burstState.store : burstState.store },
    );
  }
}
