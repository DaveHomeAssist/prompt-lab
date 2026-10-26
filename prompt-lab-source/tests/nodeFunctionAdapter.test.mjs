import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createNodeCompatibleHandler } from '../api/_lib/nodeHandler.js';

function request({ method = 'POST', url = '/test?mode=node', body = '{}' } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { method, url, headers: { host: 'promptlab.tools', 'content-type': 'application/json' } });
  return req;
}

async function invoke(handler, req) {
  const headers = {};
  let ends = 0;
  let payload;
  const res = {
    statusCode: 200,
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    end(body) { ends += 1; payload = Buffer.from(body ?? ''); },
  };
  await handler(req, res);
  // Completion must happen before the handler resolves. A missing end cannot
  // leave this regression test waiting forever or let a hosted request linger.
  assert.equal(ends, 1, 'the Node response must finish exactly once');
  return { status: res.statusCode, headers, body: payload };
}

test('Node adapter forwards request data and completes a binary response with status and headers', async () => {
  const handler = createNodeCompatibleHandler(async (req) => {
    assert.equal(req.url, 'https://promptlab.tools/test?mode=node');
    assert.equal(req.method, 'POST');
    assert.deepEqual(await req.json(), { message: 'two\nlines' });
    return new Response(new Uint8Array([0, 127, 255]), { status: 201, headers: { 'X-Receipt': 'done' } });
  });
  const result = await invoke(handler, request({ body: JSON.stringify({ message: 'two\nlines' }) }));
  assert.equal(result.status, 201);
  assert.equal(result.headers['x-receipt'], 'done');
  assert.deepEqual([...result.body], [0, 127, 255]);
});

test('Node adapter finishes errors, including malformed request JSON', async () => {
  for (const handler of [
    createNodeCompatibleHandler(async () => { throw new Error('fixture failure'); }),
    createNodeCompatibleHandler(async (req) => { await req.json(); return new Response('unreachable'); }),
  ]) {
    const result = await invoke(handler, request({ body: '{' }));
    assert.equal(result.status, 500);
    assert.match(result.headers['content-type'], /application\/json/);
    assert.equal(typeof JSON.parse(result.body).error, 'string');
  }
});

test('Node adapter preserves Web Request callers', async () => {
  const expected = new Response('web response', { status: 202 });
  const req = new Request('https://promptlab.tools/test');
  const handler = createNodeCompatibleHandler(async (received) => {
    assert.equal(received, req);
    return expected;
  });
  assert.equal(await handler(req), expected);
});

test('disabled billing routes terminate actual Node responses without upstream calls', async (t) => {
  const original = process.env.BILLING_ENABLED;
  const originalFetch = globalThis.fetch;
  process.env.BILLING_ENABLED = 'false';
  globalThis.fetch = () => { throw new Error('disabled routes must not call upstream'); };
  try {
    for (const [route, expected] of [['checkout', 200], ['license', 200], ['portal', 200], ['webhook', 503]]) {
      await t.test(route, async () => {
        const { default: handler } = await import(`../api/billing/${route}.js`);
        const result = await invoke(handler, request({ url: `/api/billing/${route}` }));
        assert.equal(result.status, expected);
        assert.match(result.headers['content-type'], /application\/json/);
        const body = JSON.parse(result.body);
        assert.equal(route === 'webhook' ? Boolean(body.error) : body.billingDisabled, true);
      });
    }
  } finally {
    if (original === undefined) delete process.env.BILLING_ENABLED;
    else process.env.BILLING_ENABLED = original;
    globalThis.fetch = originalFetch;
  }
});
