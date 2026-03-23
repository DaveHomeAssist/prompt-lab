export const config = { runtime: 'edge' };

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 100_000;
const MAX_TOKENS_CEILING = 4096;
const ipHits = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  let entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    ipHits.set(ip, entry);
  }
  entry.count++;
  if (ipHits.size > 500) {
    for (const [key, value] of ipHits) {
      if (now >= value.resetAt) ipHits.delete(key);
    }
  }
  return entry.count > RATE_LIMIT;
}

const ALLOWED_ORIGINS = new Set([
  'https://promptlab.tools',
  'https://www.promptlab.tools',
  'https://prompt-lab-tawny.vercel.app',
]);

const ALLOWED_PATHS = new Map([
  ['api.anthropic.com', new Set(['/v1/messages'])],
  ['api.openai.com', new Set(['/v1/chat/completions'])],
  ['generativelanguage.googleapis.com', null],
  ['openrouter.ai', new Set(['/api/v1/chat/completions'])],
]);

const STRIPPED_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'host',
]);

function getCorsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, corsHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function sanitizeHeaders(clientHeaders) {
  const clean = {};
  for (const [key, value] of Object.entries(clientHeaders)) {
    if (!STRIPPED_HEADERS.has(key.toLowerCase())) {
      clean[key] = value;
    }
  }
  return clean;
}

function validatePath(hostname, pathname) {
  const allowedPaths = ALLOWED_PATHS.get(hostname);
  if (allowedPaths === null) return true;
  if (!allowedPaths) return false;
  return allowedPaths.has(pathname) ||
    [...allowedPaths].some(p => pathname.startsWith(p + '/'));
}

function clampMaxTokens(body) {
  if (typeof body !== 'object' || body === null) return body;
  if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS_CEILING) {
    body.max_tokens = MAX_TOKENS_CEILING;
  }
  if (body.generationConfig && typeof body.generationConfig.maxOutputTokens === 'number' &&
      body.generationConfig.maxOutputTokens > MAX_TOKENS_CEILING) {
    body.generationConfig.maxOutputTokens = MAX_TOKENS_CEILING;
  }
  return body;
}

// BYOK passthrough — client supplies their own API keys.
// No server-side key injection. Auth headers pass through directly.

export default async function handler(request) {
  const origin = request.headers.get('origin') || '';
  const cors = getCorsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  if (!ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  }

  const clientIp = request.ip
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429, cors);
  }

  let targetUrl;
  let headers;
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return jsonResponse({ error: 'Request body too large' }, 413, cors);
    }
    ({ targetUrl, headers = {}, body } = JSON.parse(raw));
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== 'https:') {
      return jsonResponse({ error: 'HTTPS required' }, 403, cors);
    }
    if (!ALLOWED_PATHS.has(parsedUrl.hostname)) {
      return jsonResponse({ error: 'Blocked: not an allowed provider domain' }, 403, cors);
    }
    if (!validatePath(parsedUrl.hostname, parsedUrl.pathname)) {
      return jsonResponse({ error: 'Blocked: path not allowed for this provider' }, 403, cors);
    }
  } catch {
    return jsonResponse({ error: 'Invalid targetUrl' }, 400, cors);
  }

  const cleanHeaders = sanitizeHeaders(headers);

  if (typeof body === 'object' && body !== null) {
    body = clampMaxTokens(body);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: cleanHeaders,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

    const responseBody = await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        ...cors,
      },
    });
  } catch {
    return jsonResponse({ error: 'Upstream request failed' }, 502, cors);
  }
}
