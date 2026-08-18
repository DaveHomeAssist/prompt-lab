// Shared request-origin allow-list for the hosted API routes.
//
// One implementation, used by /api/proxy and /api/telemetry, so every
// browser-facing route answers CORS the same way:
//   - the production web origins (https://promptlab.tools and the mobile host
//     https://mobile.promptlab.tools routed by vercel.json) are always allowed;
//   - PROMPTLAB_WEB_ORIGIN / VITE_PROMPTLAB_WEB_ORIGIN and the comma-separated
//     PROMPTLAB_PROXY_ALLOWED_ORIGINS list add exact origins (including
//     chrome-extension://<32 a-p chars> extension ids);
//   - localhost / 127.0.0.1 are allowed outside production;
//   - a request with no Origin, or an unlisted one, is rejected with 403 and
//     never receives Access-Control-Allow-Origin (and never '*').

import { readListEnv } from './runtimeSafety.js';

export const DEFAULT_WEB_ORIGIN = 'https://promptlab.tools';
// vercel.json serves the mobile surface on this host (`has: host` rewrite to
// /mobile/index.html); it must be able to reach /api/proxy and /api/telemetry.
export const MOBILE_WEB_ORIGIN = 'https://mobile.promptlab.tools';
export const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;
export const LOCAL_WEB_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const DEFAULT_ALLOW_METHODS = 'POST, OPTIONS';
const DEFAULT_ALLOW_HEADERS = 'Content-Type';

export function normalizeAllowedOrigin(value) {
  const raw = String(value || '').trim().replace(/\/$/, '');
  if (CHROME_EXTENSION_ORIGIN.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    if (parsed.pathname !== '/') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function getAllowedRequestOrigins() {
  const configured = [
    DEFAULT_WEB_ORIGIN,
    MOBILE_WEB_ORIGIN,
    process.env.PROMPTLAB_WEB_ORIGIN,
    process.env.VITE_PROMPTLAB_WEB_ORIGIN,
    ...readListEnv('PROMPTLAB_PROXY_ALLOWED_ORIGINS', []),
  ];
  return new Set(configured.map(normalizeAllowedOrigin).filter(Boolean));
}

export function getRequestOrigin(request) {
  return String(request?.headers?.get?.('Origin') || '').trim().replace(/\/$/, '');
}

export function isAllowedRequestOrigin(request) {
  const origin = getRequestOrigin(request);
  if (!origin) return false;
  if (getAllowedRequestOrigins().has(origin)) return true;
  return process.env.NODE_ENV !== 'production' && LOCAL_WEB_ORIGIN.test(origin);
}

export function corsHeadersForRequest(request, extraHeaders = {}, {
  allowMethods = DEFAULT_ALLOW_METHODS,
  allowHeaders = DEFAULT_ALLOW_HEADERS,
} = {}) {
  const origin = getRequestOrigin(request);
  return {
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': allowHeaders,
    Vary: 'Origin',
    ...(origin && isAllowedRequestOrigin(request) ? { 'Access-Control-Allow-Origin': origin } : {}),
    ...extraHeaders,
  };
}

export function corsRejectionResponse(request) {
  if (isAllowedRequestOrigin(request)) return null;
  return new Response(JSON.stringify({ error: 'Origin is not allowed.' }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json',
      Vary: 'Origin',
    },
  });
}
