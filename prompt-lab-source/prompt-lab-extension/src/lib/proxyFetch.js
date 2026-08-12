/**
 * Proxy-aware fetch wrapper for hosted web mode.
 * Routes provider API requests through a Vercel Edge Function to bypass CORS.
 */
export function createProxyFetch(proxyUrl = '/api/proxy') {
  return async function proxyFetch(url, init = {}) {
    const headers = init.headers instanceof Headers
      ? Object.fromEntries(init.headers)
      : init.headers || {};

    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUrl: url.toString(),
        headers,
        body: init.body,
      }),
      // Cancellation must reach the proxy transport, or aborted runs keep
      // consuming the hosted provider budget behind a "cancelled" UI.
      signal: init.signal,
    });

    return res;
  };
}
