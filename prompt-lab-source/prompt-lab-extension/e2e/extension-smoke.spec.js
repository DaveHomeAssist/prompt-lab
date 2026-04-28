import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..', 'dist');

async function launchMockedExtension() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

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

  return {
    context,
    page,
    async cleanup() {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

test('refine and save flow works with a mocked extension API response', async () => {
  const { page, cleanup } = await launchMockedExtension();

  try {
    await page.getByTestId('telemetry-deny').click();
    await page.getByTestId('prompt-input').fill('Make this prompt better');
    await expect(page.getByTestId('refine-action')).toBeEnabled();
    await page.getByTestId('refine-action').click();

    await expect.poll(() => page.evaluate(() => window.__promptLabRequests.length)).toBe(1);
    await expect(page.getByTestId('output-panel')).toContainText('Improved prompt for smoke test', { timeout: 15_000 });
    await expect(page.getByTestId('output-textarea')).toHaveValue('Improved prompt for smoke test');

    const savedBefore = Number((await page.getByTestId('library-count').innerText()).match(/\d+/)?.[0] || '0');
    await expect(page.getByTestId('save-to-library').last()).toBeEnabled();
    await page.getByTestId('save-to-library').last().click();
    await expect(page.getByTestId('library-count')).toContainText(`${savedBefore + 1} saved`);

    const request = await page.evaluate(() => window.__promptLabRequests[0]);
    expect(JSON.stringify(request)).toContain('MODEL_REQUEST');
    expect(JSON.stringify(request)).toContain('Make this prompt better');
  } finally {
    await cleanup();
  }
});
