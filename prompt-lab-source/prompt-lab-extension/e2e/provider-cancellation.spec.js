import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

test('MODEL_ABORT closes the actual packaged background request to a local fake provider', async () => {
  let requests = 0;
  let aborted = 0;
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' });
      response.end(); return;
    }
    requests += 1;
    request.resume();
    response.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    response.flushHeaders();
    response.on('close', () => { if (!response.writableEnded) aborted += 1; });
    // Hold the body until MODEL_ABORT; never contact a real provider.
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-cancel-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const origin = `http://127.0.0.1:${server.address().port}`;
    await worker.evaluate((baseUrl) => chrome.storage.local.set({ provider: 'ollama', ollamaBaseUrl: baseUrl, ollamaModel: 'fixture' }), origin);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await page.evaluate(() => {
      window.__cancelReply = null;
      chrome.runtime.sendMessage({
        type: 'MODEL_REQUEST', requestId: 'cancel-fixture',
        payload: { provider: 'ollama', messages: [{ role: 'user', content: 'Disposable cancellation fixture' }] },
      }, (reply) => { window.__cancelReply = reply; });
    });
    await expect.poll(() => requests).toBe(1);
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'MODEL_ABORT', requestId: 'cancel-fixture' }));
    await expect.poll(() => aborted).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__cancelReply)).toMatchObject({ error: expect.stringMatching(/abort|cancel/i) });
    expect(await page.evaluate(() => window.__cancelReply.data)).toBeUndefined();
    expect(requests).toBe(1);
  } finally {
    await context?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
