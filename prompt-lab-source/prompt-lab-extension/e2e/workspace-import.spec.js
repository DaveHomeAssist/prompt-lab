import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

test('workspace import retries mapped history without duplicate records and survives reload', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-import-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (!localStorage.getItem('import-fixture-seeded')) {
        localStorage.setItem('import-fixture-seeded', '1');
        localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-library', JSON.stringify([{
          id: 'local', title: 'Local survivor', original: 'Shared body', enhanced: 'Shared body', currentVersionId: 'local-version',
        }]));
      }
      window.__failImport = true;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.__failImport && key === 'pl2-eval-run-fallback') throw new Error('Injected quota failure');
        return setItem.call(this, key, value);
      };
      indexedDB.open = () => { throw new Error('Injected IndexedDB unavailable'); };
    });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const fixture = {
      library: [{ id: 'source', title: 'Imported duplicate', original: 'Shared body', enhanced: 'Shared body', currentVersionId: 'source-version' }],
      runs: [{ id: 'import-run', promptId: 'source', promptVersionId: 'source-version', testCaseId: 'import-case', output: 'Historical fixture output' }],
      testCases: [{ id: 'import-case', promptId: 'source', input: 'Fixture case' }],
    };
    await page.locator('input[type="file"]').setInputFiles({ name: 'workspace.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await expect(page.getByRole('button', { name: 'Retry import', exact: true })).toBeVisible();
    await expect(page.getByText(/Import incomplete:/)).toBeVisible();
    await page.evaluate(() => { window.__failImport = false; });
    await page.getByRole('button', { name: 'Retry import', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Retry import', exact: true })).toHaveCount(0);
    await page.reload();
    const stored = await page.evaluate(() => ({
      library: JSON.parse(localStorage.getItem('pl2-library')),
      runs: JSON.parse(localStorage.getItem('pl2-eval-run-fallback')),
      cases: JSON.parse(localStorage.getItem('pl2-test-case-fallback')),
    }));
    expect(stored.library.map((entry) => entry.id)).toEqual(['local']);
    expect(stored.runs).toHaveLength(1);
    expect(stored.cases).toHaveLength(1);
    expect(stored.runs[0]).toMatchObject({ promptId: 'local', promptVersionId: 'local-version', testCaseId: 'import-case' });
    expect(stored.cases[0].promptId).toBe('local');
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
