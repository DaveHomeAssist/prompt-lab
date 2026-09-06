import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createDesktopFixtureServer } from './desktop-fixture-server.mjs';

async function start(t, options) {
  const server = createDesktopFixtureServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const request = { method: 'POST', headers: { Origin: 'tauri://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Fixture prompt' }] }) };

test('discovers the fixture and returns a valid enhancement contract', async t => {
  const url = await start(t);
  assert.equal((await (await fetch(`${url}/api/tags`)).json()).models[0].name, 'promptlab-fixture');
  const response = await fetch(`${url}/api/chat`, request);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost');
  assert.match(JSON.parse((await response.json()).message.content).enhanced, /Fixture enhanced prompt/);
});
test('rejects foreign origins, malformed input, oversized input and unknown routes', async t => {
  const url = await start(t);
  assert.equal((await fetch(`${url}/api/chat`, { ...request, headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(`${url}/api/chat`, { ...request, body: '{' })).status, 400);
  assert.equal((await fetch(`${url}/api/chat`, { ...request, body: 'x'.repeat(256 * 1024 + 1) })).status, 413);
  assert.equal((await fetch(`${url}/proxy`)).status, 404);
});
test('error mode returns a terminal provider failure', async t => {
  const url = await start(t, { mode: 'error' });
  const response = await fetch(`${url}/api/chat`, request);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'Intentional fixture failure');
});
test('follow-up responses preserve the selected source and still honor provider failures', async t => {
  const url = await start(t, { responseKind: 'follow-up' });
  const response = await fetch(`${url}/api/chat`, request);
  assert.deepEqual(JSON.parse((await response.json()).message.content), {
    suggestions: [{ title: 'Fixture next analysis', prompt: 'Continue from this saved answer:\nFixture prompt' }],
  });
  const failed = await start(t, { responseKind: 'follow-up', mode: 'error' });
  assert.equal((await fetch(`${failed}/api/chat`, request)).status, 400);
  assert.throws(() => createDesktopFixtureServer({ responseKind: 'unknown' }), /Unknown fixture response kind/);
});
test('aborting a slow request closes its connection without completing', { timeout: 5000 }, async t => {
  let received;
  let closed;
  const started = new Promise(resolve => { received = resolve; });
  const disconnected = new Promise(resolve => { closed = resolve; });
  const events = [];
  const url = await start(t, { mode: 'slow', onEvent(event) { events.push(event); if (event === 'request') received(); if (event === 'connection-closed') closed(); } });
  const controller = new AbortController();
  const pending = fetch(`${url}/api/chat`, { ...request, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  await disconnected;
  assert.deepEqual(events, ['request', 'connection-closed']);
});
