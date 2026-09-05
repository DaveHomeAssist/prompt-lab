import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const width of [400, 1180]) {
  test(`packaged extension recovers local writes without rerunning providers at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-recovery-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-pads', JSON.stringify({
          pads: [{ id: 'recovery-note', name: 'Research', content: 'Readable during quota failure', timestamp: 10 }],
          activePadId: 'recovery-note',
        }));
        localStorage.setItem('pl2-pads-schema-version', '3');
        window.__failStorage = true;
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (window.__failStorage && (key === 'pl2-pads' || key.endsWith('-fallback'))) {
            throw new DOMException('Injected quota failure', 'QuotaExceededError');
          }
          return setItem.call(this, key, value);
        };
        indexedDB.open = () => { throw new Error('Injected IndexedDB unavailable'); };
      });
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
      await page.evaluate(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.__providerCalls = 0;
        chrome.runtime.sendMessage = (message, callback) => {
          if (message?.type === 'MODEL_REQUEST') {
            window.__providerCalls += 1;
            callback?.({ data: { provider: 'mock', model: 'mock-model', content: [{ type: 'text', text: 'Recovered arena response' }] } });
            return;
          }
          if (message?.type === 'GET_PROVIDER_SETTINGS') {
            callback?.({ providers: [{ provider: 'mock', model: 'mock-model' }] });
            return;
          }
          return original(message, callback);
        };
      });
      const openWorkspace = async (name) => {
        if (width < 720) {
          await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name, exact: true }).click();
        } else {
          await page.getByRole('tablist', { name: 'Primary workspaces' }).getByRole('tab', { name, exact: true }).click();
        }
      };
      await openWorkspace('Scratch');
      if (width < 720) await page.getByRole('button', { name: /Research/ }).click();
      await expect(page.getByRole('textbox', { name: 'Scratchpad', exact: true })).toHaveValue('Readable during quota failure');
      await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toBeVisible();
      await page.evaluate(() => { window.__failStorage = false; });
      await page.getByRole('button', { name: 'Retry saving', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry saving', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-pads')).pads[0].content)).toBe('Readable during quota failure');
      expect(await page.evaluate(() => localStorage.getItem('pl2-pads-schema-version'))).toBe('4');

      await openWorkspace('Evaluate');
      if (width < 720) await page.getByRole('button', { name: 'Compare View' }).click();
      else await page.getByRole('tablist', { name: 'Evaluate views' }).getByRole('tab', { name: 'Compare' }).click();
      await page.getByRole('textbox', { name: 'Prompt for variant A' }).fill('Write a brief fixture response.');
      await page.evaluate(() => { window.__failStorage = true; });
      await page.getByRole('button', { name: 'Run A', exact: true }).click();
      await expect(page.getByText('Recovered arena response', { exact: true })).toBeVisible();
      const retry = page.getByRole('button', { name: 'Retry saving records' });
      await expect(retry).toBeVisible();
      await retry.click();
      await expect(retry).toBeVisible();
      await page.evaluate(() => { window.__failStorage = false; });
      await retry.click();
      await expect(retry).toHaveCount(0);
      expect(await page.evaluate(() => window.__providerCalls)).toBe(1);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-eval-run-fallback')).length)).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
