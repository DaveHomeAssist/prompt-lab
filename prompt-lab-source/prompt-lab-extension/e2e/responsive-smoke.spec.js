import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '..', 'dist');

const viewports = [
  { name: 'mobile-400', width: 400, height: 860 },
  { name: 'tablet-768', width: 768, height: 900 },
];

async function launchMockedExtension(viewport) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `prompt-lab-${viewport.name}-`));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: viewport.width, height: viewport.height },
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
              enhanced: 'Improved prompt for responsive smoke test',
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

for (const viewport of viewports) {
  test(`core controls are visible and operable at ${viewport.width}px`, async () => {
    const { page, cleanup } = await launchMockedExtension(viewport);

    try {
      await page.getByTestId('telemetry-deny').click();
      await expect(page.getByTestId('prompt-input')).toBeVisible();
      await expect(page.getByTestId('refine-action')).toBeVisible();
      await expect(page.getByTestId('upgrade-trigger')).toBeVisible();
      await expect(page.getByTestId('pro-gated-action')).toBeVisible();

      await page.getByTestId('prompt-input').fill(`Responsive prompt for ${viewport.name}`);
      await page.getByTestId('refine-action').click();

      await expect.poll(() => page.evaluate(() => window.__promptLabRequests.length)).toBe(1);
      await expect(page.getByTestId('output-panel')).toContainText('Improved prompt for responsive smoke test', { timeout: 15_000 });
      await expect(page.getByTestId('save-to-library').last()).toBeVisible();
      const savedBefore = Number((await page.getByTestId('library-count').innerText()).match(/\d+/)?.[0] || '0');
      await page.getByTestId('save-to-library').last().click();
      await expect(page.getByTestId('library-count')).toContainText(`${savedBefore + 1} saved`);

      await page.getByTestId('nav-library').click();
      await expect(page.getByTestId('library-search')).toBeVisible();
      await page.getByTestId('library-search').fill('responsive');
    } finally {
      await cleanup();
    }
  });
}
