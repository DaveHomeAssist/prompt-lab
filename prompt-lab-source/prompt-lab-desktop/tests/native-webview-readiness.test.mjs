import test from 'node:test';
import assert from 'node:assert/strict';
import { probeNativeWebView } from './native-webview-readiness.mjs';

function fixture({ ready = true, pages, response, silent = false } = {}) {
  const sockets = [], requests = [];
  const targets = pages ?? [{ id: 'native', type: 'page', title: 'about:blank', url: 'http://tauri.localhost/',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/native' }];
  class Socket extends EventTarget {
    constructor(url) { super(); this.url = url; sockets.push(this); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(text) {
      this.command = JSON.parse(text);
      if (!silent) queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify(response ?? { id: 1, result: { result: { type: 'boolean', value: ready } } }),
      })));
    }
    close() { this.closed = true; }
  }
  return { sockets, requests, options: { WebSocketImpl: Socket, fetchImpl: async (url, options) => {
    requests.push({ url: url.href, options });
    return Response.json(url.pathname === '/json/version' ? { Browser: 'Synthetic WebView2' } : targets);
  } } };
}

test('HTTP debugging availability alone does not establish native renderer readiness', async () => {
  const missing = fixture({ pages: [] });
  assert.equal((await probeNativeWebView(missing.options)).ready, false);
  assert.equal(missing.sockets.length, 0);
  const loading = fixture({ ready: false });
  assert.equal((await probeNativeWebView(loading.options)).ready, false);
  assert.equal(loading.sockets[0].closed, true);
  assert.equal(loading.sockets[0].command.method, 'Runtime.evaluate');
  assert.match(loading.sockets[0].command.params.expression, /__TAURI_INTERNALS__/);
});

test('only a boolean renderer acknowledgement qualifies the installed app', async () => {
  const f = fixture();
  const result = await probeNativeWebView(f.options);
  assert.equal(result.ready, true); assert.equal(result.page.id, 'native'); assert.equal(f.sockets[0].closed, true);
  assert.ok(f.requests.every(row => row.options.redirect === 'error'));
  const wrongType = fixture({ response: { id: 1, result: { result: { type: 'string', value: 'true' } } } });
  assert.equal((await probeNativeWebView(wrongType.options)).ready, false);
});

test('renderer exceptions, broken connections and deadlines never become successful readiness', async () => {
  const exception = fixture({ response: { id: 1, result: { exceptionDetails: { text: 'Synthetic error' } } } });
  await assert.rejects(probeNativeWebView(exception.options), /evaluation failed/); assert.equal(exception.sockets[0].closed, true);
  for (const event of ['error', 'close', 'abort']) {
    const f = fixture({ silent: true }), controller = new AbortController();
    const timer = setTimeout(() => event === 'abort' ? controller.abort(new Error('Synthetic deadline')) : f.sockets[0].dispatchEvent(new Event(event)), 15);
    try { await assert.rejects(probeNativeWebView({ ...f.options, signal: controller.signal }), event === 'abort' ? /deadline/ : /readiness|closed/); }
    finally { clearTimeout(timer); }
    assert.equal(f.sockets[0].closed, true);
  }
});

test('readiness rejects remote or mismatched debugging sockets before connecting', async () => {
  for (const url of ['ws://example.com/devtools/page/a', 'ws://127.0.0.1:9999/devtools/page/a', 'ws://127.0.0.1:9222/other']) {
    const f = fixture({ pages: [{ id: 'a', type: 'page', url: 'http://tauri.localhost/', webSocketDebuggerUrl: url }] });
    await assert.rejects(probeNativeWebView(f.options), /outside the owned/); assert.equal(f.sockets.length, 0);
  }
  await assert.rejects(probeNativeWebView({ ...fixture().options, baseUrl: 'http://example.com' }), /owned loopback/);
});
