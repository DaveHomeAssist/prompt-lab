import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..', 'dist');

test('enhance flow works with a mocked extension API response', async ({}) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/panel.html`);
    await page.evaluate(() => {
      const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
      window.__promptLabRequests = [];
      chrome.runtime.sendMessage = (message, callback) => {
        window.__promptLabRequests.push(message);
        if (message?.type === 'MODEL_REQUEST') {
          const payload = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                enhanced: 'Improved prompt for smoke test',
                variants: [
                  { label: 'Variant A', content: 'Variant A output' },
                  { label: 'Variant B', content: 'Variant B output' },
                ],
                notes: 'Mocked provider response',
                tags: ['qa'],
              }),
            }],
            provider: 'mock-provider',
            model: message.payload?.model || 'mock-model',
          };
          setTimeout(() => callback?.({ data: payload }), 0);
          return;
        }
        return originalSendMessage(message, callback);
      };
    });

    await page.getByPlaceholder(/Paste or write your prompt here/i).fill('Make this prompt better');
    await expect(page.getByRole('button', { name: /Enhance/i })).toBeEnabled();
    await page.getByRole('button', { name: /Enhance/i }).click();

    await expect.poll(() => page.evaluate(() => window.__promptLabRequests.length)).toBe(1);
    await expect(page.getByText('Enhanced')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('textarea').nth(1)).toHaveValue('Improved prompt for smoke test');
    await expect(page.getByText('Mocked provider response')).toBeVisible();

    const request = await page.evaluate(() => window.__promptLabRequests[0]);
    expect(JSON.stringify(request)).toContain('MODEL_REQUEST');
    expect(JSON.stringify(request)).toContain('Make this prompt better');
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
