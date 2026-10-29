const readinessExpression = `Boolean(document.readyState !== 'loading'
  && window.__TAURI_INTERNALS__ && document.querySelector('[data-testid="nav-library"]'))`;

function rendererReady(url, { signal, WebSocketImpl }) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const socket = new WebSocketImpl(url);
    let settled = false;
    const finish = (error, ready) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      socket.removeEventListener('open', opened);
      socket.removeEventListener('message', message);
      socket.removeEventListener('error', failed);
      socket.removeEventListener('close', closed);
      socket.close();
      if (error) reject(error); else resolve(ready);
    };
    const aborted = () => finish(signal.reason);
    const failed = () => finish(new Error('Native renderer readiness connection failed.'));
    const closed = () => finish(new Error('Native renderer closed before its readiness reply.'));
    const opened = () => {
      try { socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
        params: { expression: readinessExpression, returnByValue: true } })); }
      catch (error) { finish(error); }
    };
    const message = event => {
      try {
        const reply = JSON.parse(event.data);
        if (reply.id !== 1) return;
        if (reply.error || reply.result?.exceptionDetails) throw new Error('Native renderer readiness evaluation failed.');
        finish(null, reply.result?.result?.type === 'boolean' && reply.result.result.value === true);
      } catch (error) { finish(error); }
    };
    signal.addEventListener('abort', aborted, { once: true });
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('message', message);
    socket.addEventListener('error', failed, { once: true });
    socket.addEventListener('close', closed, { once: true });
    if (signal.aborted) aborted();
  });
}

// A debugging HTTP response can precede the actual WebView renderer. Probe the
// installed app without changing it, then let WebDriver create its one session.
export async function probeNativeWebView({ baseUrl = 'http://127.0.0.1:9222',
  expectedOrigin = 'http://tauri.localhost', signal = AbortSignal.timeout(1500),
  fetchImpl = fetch, WebSocketImpl = WebSocket } = {}) {
  const endpoint = new URL(baseUrl);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password) {
    throw new Error('Native readiness requires the owned loopback debugging endpoint.');
  }
  const read = async route => {
    const response = await fetchImpl(new URL(route, endpoint), { signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Native debugging endpoint returned ${response.status}.`);
    return response.json();
  };
  const version = await read('/json/version'), pages = await read('/json/list');
  if (!Array.isArray(pages)) throw new Error('Native debugging target list is invalid.');
  const page = pages.find(row => {
    try { return row.type === 'page' && new URL(row.url).origin === expectedOrigin; } catch { return false; }
  });
  if (!page) return { ready: false, reason: 'Native page target is not available.', version };
  const socketUrl = new URL(page.webSocketDebuggerUrl);
  if (socketUrl.protocol !== 'ws:' || socketUrl.host !== endpoint.host || socketUrl.username || socketUrl.password
    || !socketUrl.pathname.startsWith('/devtools/page/')) throw new Error('Native renderer target is outside the owned debugging endpoint.');
  const ready = await rendererReady(socketUrl.href, { signal, WebSocketImpl });
  return { ready, reason: ready ? 'Native renderer responded with app controls ready.' : 'Native renderer has not finished app startup.',
    version, page: { id: page.id, url: page.url, title: page.title } };
}
