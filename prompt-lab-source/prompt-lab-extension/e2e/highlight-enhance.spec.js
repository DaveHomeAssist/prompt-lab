import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const extensionPath = join(here, '..', 'dist');
const shots = process.env.HIGHLIGHT_SCREENSHOT_DIR || join(tmpdir(), 'prompt-lab-highlight-shots');
mkdirSync(shots, { recursive: true });
const undoKey = process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z';

async function undoField(page, selector) {
  await page.locator(selector).focus();
  await page.keyboard.press(undoKey);
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function startServer() {
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const path = normalize(join(repoRoot, decodeURIComponent(url.pathname)));
    if (!path.startsWith(repoRoot) || !existsSync(path)) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    response.writeHead(200, { 'content-type': types[extname(path)] || 'text/plain' });
    createReadStream(path).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test.describe('highlight to enhance on a local page', () => {
  let server;
  let base;

  test.beforeAll(async () => {
    server = await startServer();
    base = `http://127.0.0.1:${server.address().port}`;
  });

  test.afterAll(() => { server?.close(); });

  test('replaces textarea, input, contenteditable, and a rich editor, and falls back when it cannot', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.goto(`${base}/prompt-lab-source/prompt-lab-extension/e2e/fixtures/highlight-demo.html`);

    await page.evaluate(() => window.__highlight.run('plain', 'light'));
    await expect.poll(() => page.evaluate(() => window.__card?.query('.status')?.textContent || '')).toContain('Enter accepts');
    await page.screenshot({ path: `${shots}/highlight-card-light.png` });
    await page.evaluate(() => window.__highlight.accept());
    await expect.poll(() => page.locator('#plain').inputValue()).toBe('Enhanced hello world');
    await page.screenshot({ path: `${shots}/highlight-after-accept.png` });
    await undoField(page, '#plain');
    await expect.poll(() => page.locator('#plain').inputValue()).toBe('hello world');

    await page.evaluate(() => window.__highlight.run('field', 'dark'));
    await expect.poll(() => page.evaluate(() => window.__card?.query('style')?.textContent || '')).toContain('#101018');
    await page.screenshot({ path: `${shots}/highlight-card-dark.png` });
    await page.evaluate(() => window.__highlight.accept());
    await expect.poll(() => page.locator('#field').inputValue()).toBe('Enhanced hello world');
    await undoField(page, '#field');
    await expect.poll(() => page.locator('#field').inputValue()).toBe('hello world');

    await page.evaluate(() => window.__highlight.run('editable', 'light'));
    await page.evaluate(() => window.__highlight.accept());
    await expect.poll(() => page.locator('#editable').innerText()).toBe('Enhanced hello world');
    await undoField(page, '#editable');
    await expect.poll(() => page.locator('#editable').innerText()).toBe('hello world');

    await page.evaluate(() => window.__highlight.run('rich', 'light'));
    await page.evaluate(() => window.__highlight.accept());
    await expect.poll(() => page.locator('#rich').innerText()).toBe('Enhanced hello world');

    await page.evaluate(() => window.__highlight.run('locked', 'light'));
    await page.evaluate(() => window.__highlight.accept());
    await expect.poll(() => page.evaluate(() => window.__lastOutcome?.message || '')).toBe('Copied, paste to replace');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Enhanced hello');
    await expect(page.locator('#locked')).toHaveText('hello world');
    await page.screenshot({ path: `${shots}/highlight-fallback.png` });

    await page.evaluate(() => window.__highlight.showMenu(['Enhance with Prompt Lab', 'Send to Prompt Lab']));
    await page.screenshot({ path: `${shots}/highlight-context-menu.png` });

    await page.setViewportSize({ width: 440, height: 520 });
    await page.evaluate(() => window.__highlight.showDesktop());
    await page.screenshot({ path: `${shots}/highlight-desktop-window.png` });
  });
});

test('the extension context menu is registered for selections', async () => {
  test.skip(!existsSync(join(extensionPath, 'manifest.json')), 'extension build is produced by npm run build');
  const userData = join(tmpdir(), `prompt-lab-highlight-${Date.now()}`);
  const context = await chromium.launchPersistentContext(userData, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#highlightMenu')).toBeChecked();
    const status = await page.evaluate(() => new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'HIGHLIGHT_STATUS' }, resolve);
    }));
    expect(status.enabled).toBe(true);
    expect(status.titles).toEqual(['Enhance with Prompt Lab', 'Send to Prompt Lab']);
  } finally {
    await context.close();
  }
});
