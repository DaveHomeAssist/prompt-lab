export const config = { runtime: 'edge' };

/* ── Per-IP rate limiting ── */
const RATE_LIMIT = 30;          // max requests per window
const RATE_WINDOW_MS = 60_000;  // 1 minute
const ipHits = new Map();       // ip → { count, resetAt }

function isRateLimited(ip) {
  const now = Date.now();
  let entry = ipHits.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS };
    ipHits.set(ip, entry);
  }
  entry.count++;
  // Prune stale entries every 100 requests to avoid unbounded growth
  if (ipHits.size > 500) {
    for (const [k, v] of ipHits) {
      if (now >= v.resetAt) ipHits.delete(k);
    }
  }
  return entry.count > RATE_LIMIT;
}

const ALLOWED_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
]);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

/** Map provider hostname → env var name + how to inject the key. */
function injectKey(url, headers) {
  const host = new URL(url).hostname;

  if (host === 'api.anthropic.com' && process.env.ANTHROPIC_API_KEY) {
    headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
  }
  if (host === 'api.openai.com' && process.env.OPENAI_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OPENAI_API_KEY}`;
  }
  if (host === 'openrouter.ai' && process.env.OPENROUTER_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OPENROUTER_API_KEY}`;
  }
  // Gemini uses a query param — rewrite the URL
  if (host === 'generativelanguage.googleapis.com' && process.env.GEMINI_API_KEY) {
    const u = new URL(url);
    u.searchParams.set('key', process.env.GEMINI_API_KEY);
    return { url: u.toString(), headers };
  }

  return { url, headers };
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  // Rate limit by IP
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  if (isRateLimited(clientIp)) {
    return jsonResponse({ error: 'Rate limit exceeded. Try again shortly.' }, 429);
  }

  let targetUrl, headers, body;
  try {
    ({ targetUrl, headers = {}, body } = await request.json());
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  // Validate target
  try {
    const { hostname, protocol } = new URL(targetUrl);
    if (protocol !== 'https:') return jsonResponse({ error: 'HTTPS required' }, 403);
    if (!ALLOWED_HOSTS.has(hostname)) {
      return jsonResponse({ error: 'Blocked: not an allowed provider domain' }, 403);
    }
  } catch {
    return jsonResponse({ error: 'Invalid targetUrl' }, 400);
  }

  // Inject server-side keys (overwrites any client-sent keys)
  const injected = injectKey(targetUrl, { ...headers });

  try {
    const upstream = await fetch(injected.url, {
      method: 'POST',
      headers: injected.headers,
      body,
    });

    const responseBody = await upstream.arrayBuffer();
    return new Response(responseBody, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
        ...CORS,
      },
    });
  } catch (e) {
    return jsonResponse({ error: e.message || 'Upstream fetch failed' }, 502);
  }
}
