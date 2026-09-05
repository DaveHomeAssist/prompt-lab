import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
for (const width of [400, 1180]) {
  test(`import preview cancels without writes and applies explicit conflicts at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-import-preview-'));
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
        localStorage.setItem('pl2-library', JSON.stringify([{
          id: 'existing', title: 'Shared title', original: 'Original body', enhanced: 'Original body', currentVersionId: 'old-version',
        }]));
        indexedDB.open = () => { throw new Error('Fixture fallback'); };
      });
      await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('pl2-library'))[0]?.completeness);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.__importWrites = [];
        Storage.prototype.setItem = function (key, value) {
          if (['pl2-library', 'pl2-library-trash', 'pl2-collections', 'pl2-pads', 'pl2-packs', 'pl2-eval-run-fallback', 'pl2-test-case-fallback'].includes(key)) window.__importWrites.push(key);
          return original.call(this, key, value);
        };
      });
      const fixture = {
        library: [
          { id: 'duplicate', title: 'Duplicate label', original: 'Original body', enhanced: 'Original body' },
          { id: 'replacement', title: 'Shared title', original: 'Replacement body', enhanced: 'Replacement body', currentVersionId: 'replacement-version' },
          { id: 'fresh', title: 'Fresh prompt', original: 'Fresh body', enhanced: 'Fresh body' },
        ],
        runs: [{ id: 'incoming-run', promptId: 'replacement', promptVersionId: 'replacement-version', output: 'Historical replacement result' }],
      };
      const selectFile = () => page.locator('input[type="file"]').setInputFiles({ name: 'preview.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
      await selectFile();
      const dialog = page.getByRole('dialog', { name: 'Review Library import' });
      await expect(dialog.getByRole('heading', { name: 'Review Library import' })).toBeFocused();
      await expect(dialog.getByRole('button', { name: 'Apply import', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('combobox', { name: 'Conflict action for Duplicate label' })).toHaveValue('skip');
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await page.evaluate(() => window.__importWrites)).toEqual([]);
      await selectFile();
      await dialog.getByRole('combobox', { name: 'Conflict action for Shared title' }).selectOption('replace');
      await expect(dialog.getByRole('button', { name: 'Apply import', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Apply import', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const stored = await page.evaluate(() => ({ library: JSON.parse(localStorage.getItem('pl2-library')), runs: JSON.parse(localStorage.getItem('pl2-eval-run-fallback')) }));
      expect(stored.library).toHaveLength(2);
      const replaced = stored.library.find(row => row.id === 'existing');
      expect(replaced.enhanced).toBe('Replacement body');
      expect(replaced.versions.some(row => row.enhanced === 'Original body')).toBe(true);
      expect(stored.runs).toHaveLength(1);
      expect(stored.runs[0]).toMatchObject({ promptId: 'existing', promptVersionId: replaced.currentVersionId });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
