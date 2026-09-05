import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

for (const width of [400, 1180]) {
  test(`packaged preflight and Arena ownership at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-ownership-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        indexedDB.open = () => { throw new Error('Fixture fallback'); };
      });
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
      await page.evaluate(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.__attempts = [];
        window.__aborts = [];
        chrome.runtime.sendMessage = (message, callback) => {
          if (message?.type === 'MODEL_REQUEST') {
            window.__attempts.push({ message, callback });
            return;
          }
          if (message?.type === 'MODEL_ABORT') {
            window.__aborts.push(message);
            callback?.({ ok: true });
            return;
          }
          return original(message, callback);
        };
      });
      await page.getByTestId('prompt-input').fill('Contact person@example.com');
      await page.getByTestId('refine-action').click();
      await expect(page.getByRole('dialog', { name: 'Sensitive Data Detected' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await page.evaluate(() => window.__attempts.length)).toBe(0);
      if (width < 720) {
        await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Evaluate', exact: true }).click();
        await page.getByRole('button', { name: 'Compare View' }).click();
      } else {
        await page.getByRole('tablist', { name: 'Primary workspaces' }).getByRole('tab', { name: 'Evaluate', exact: true }).click();
        await page.getByRole('tablist', { name: 'Evaluate views' }).getByRole('tab', { name: 'Compare' }).click();
      }
      await page.getByRole('textbox', { name: 'Prompt for variant A' }).fill('Contact first@example.com');
      await page.getByRole('textbox', { name: 'Prompt for variant B' }).fill('Contact second@example.com');
      await page.getByRole('button', { name: 'Run All', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Sensitive Data Detected' });
      await expect(dialog.getByText('Arena Variant A')).toBeVisible();
      expect(await page.evaluate(() => window.__attempts.length)).toBe(0);
      await dialog.getByRole('button', { name: 'Redact & Send' }).click();
      await expect(dialog.getByText('Arena Variant B')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await page.evaluate(() => JSON.stringify(window.__attempts[0].message))).not.toContain('first@example.com');
      await page.getByRole('textbox', { name: 'Prompt for variant A' }).fill('New input after approval');
      expect(await page.evaluate(() => window.__aborts.length)).toBe(1);
      await page.evaluate(() => window.__attempts[0].callback({ data: { content: [{ text: 'Stale response' }] } }));
      await expect(page.getByText('Stale response', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Run A', exact: true }).click();
      await page.evaluate(() => window.__attempts[1].callback({ data: { provider: 'mock', model: 'fixture', content: [{ text: 'Current response' }] } }));
      await expect(page.getByText('Current response', { exact: true })).toBeVisible();
      const runs = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-eval-run-fallback')));
      const arenaRuns = runs.filter(run => run.mode === 'ab');
      expect(arenaRuns).toHaveLength(1);
      expect(arenaRuns[0].input).toBe('New input after approval');
      expect(await page.evaluate(() => window.__attempts.length)).toBe(2);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
