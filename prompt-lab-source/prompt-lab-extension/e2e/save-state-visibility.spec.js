import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const [width, height] of [[375, 812], [1440, 900]]) {
  test(`save state stays visible and contained at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-save-state-'));
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: { width, height }, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
    try {
      await context.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      });
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html#/create`);
      const bar = page.getByRole('region', { name: 'Editing context' });
      await expect(bar).toBeVisible();
      await expect(bar.getByRole('status')).toBeVisible();
      await expect(bar.getByRole('status')).toContainText(/Empty draft|Not saved yet|No unsaved changes/);
      // The status is in summary, so collapsing details cannot hide it.
      const details = bar.locator('details').first();
      if (await details.getAttribute('open') !== null) await details.locator('summary').click();
      await expect(bar.getByRole('status')).toBeVisible();
      const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }));
      expect(overflow).toEqual({ x: false, y: false });
    } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  });
}
