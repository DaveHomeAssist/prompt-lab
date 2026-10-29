import { test, expect, chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probeNativeWebView } from '../../prompt-lab-desktop/tests/native-webview-readiness.mjs';

test('native readiness uses a real renderer reply and rejects an HTTP-only or loading browser', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'promptlab-native-readiness-'));
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<!doctype html><title>Readiness fixture</title><body>Loading</body>');
  });
  let context;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const expectedOrigin = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: ['--remote-debugging-port=0'] });
    const port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
    expect(port).toMatch(/^\d+$/);
    const options = { baseUrl: `http://127.0.0.1:${port}`, expectedOrigin };
    expect((await probeNativeWebView(options)).ready).toBe(false);
    const page = await context.newPage(); await page.goto(expectedOrigin);
    expect((await probeNativeWebView(options)).ready).toBe(false);
    await page.evaluate(() => {
      window.__TAURI_INTERNALS__ = {};
      document.body.innerHTML = '<button data-testid="nav-library">Library</button>';
    });
    const ready = await probeNativeWebView(options);
    expect(ready.ready).toBe(true); expect(ready.page.url).toBe(expectedOrigin + '/');
    await page.close();
    expect((await probeNativeWebView(options)).ready).toBe(false);
  } finally {
    await context?.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
