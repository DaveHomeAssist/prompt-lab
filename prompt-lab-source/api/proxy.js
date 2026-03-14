export const config = { runtime: 'edge' };

const ALLOWED_HOSTS = new Set([
  'api.anthropic.com',
  'api.openai.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const { targetUrl, headers, body } = await request.json();
    const url = new URL(targetUrl);

    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
      return Response.json(
        { error: 'Blocked: not an allowed provider domain' },
        { status: 403, headers: CORS_HEADERS },
      );
    }

    const upstream = await fetch(targetUrl, { method: 'POST', headers, body });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...Object.fromEntries(upstream.headers), ...CORS_HEADERS },
    });
  } catch (e) {
    return Response.json(
      { error: e.message || 'Proxy fetch failed' },
      { status: 502, headers: CORS_HEADERS },
    );
  }
}
