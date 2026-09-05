import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

test('permanent deletion survives stale writes from another extension tab and reload', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-deletion-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
    const first = await context.newPage();
    await first.addInitScript(() => {
      if (localStorage.getItem('deletion-fixture-seeded')) return;
      localStorage.setItem('deletion-fixture-seeded', '1');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-library', '[]');
      localStorage.setItem('pl2-library-trash', JSON.stringify([{
        id: 'discarded-prompt', title: 'Disposable deletion fixture', original: 'Private fixture content',
        enhanced: 'Private fixture content', deletedAt: new Date().toISOString(), tombstoneVersion: 1,
      }]));
    });
    await first.goto(url);
    const second = await context.newPage();
    await second.addInitScript(() => {
      window.__holdStorage = true;
      window.addEventListener('storage', (event) => {
        if (window.__holdStorage) event.stopImmediatePropagation();
      }, true);
    });
    await second.goto(url);
    for (const page of [first, second]) {
      await page.getByTestId('nav-library').click();
      await page.getByRole('button', { name: /Recently Deleted/ }).click();
      await expect(page.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' })).toBeVisible();
    }
    const stale = await second.evaluate(() => localStorage.getItem('pl2-library-trash'));
    first.on('dialog', (dialog) => dialog.accept());
    await first.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' }).click();
    await expect(first.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' })).toHaveCount(0);
    await expect(second.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' })).toBeVisible();
    await second.evaluate(async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      localStorage.setItem('pl2-library-trash', snapshot);
      window.__holdStorage = false;
      window.dispatchEvent(new StorageEvent('storage', { key: 'pl2-library-trash', newValue: snapshot }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'pl2-library-trash', newValue: '[]' }));
    }, stale);
    for (const page of [first, second]) {
      await expect(page.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' })).toHaveCount(0);
      await page.reload();
      await page.getByTestId('nav-library').click();
      await page.getByRole('button', { name: /Recently Deleted/ }).click();
      await expect(page.getByRole('button', { name: 'Permanently delete Disposable deletion fixture' })).toHaveCount(0);
    }
    await expect.poll(() => first.evaluate(() => localStorage.getItem('pl2-library-trash'))).toBe('[]');
    expect(await first.evaluate(() => localStorage.getItem('pl2-library-deleted:discarded-prompt'))).toBe('1');

    // Clear also invalidates records a stale replica had not shared yet.
    await first.getByRole('button', { name: 'Settings', exact: true }).click();
    await first.getByRole('button', { name: 'Clear All Prompts' }).click();
    await first.getByRole('button', { name: 'Close settings' }).click();
    await second.evaluate(() => {
      localStorage.setItem('pl2-library', JSON.stringify([{
        id: 'unseen-before-clear', title: 'Stale unseen prompt', original: 'Stale content', enhanced: 'Stale content',
      }]));
      window.__holdStorage = false;
      window.dispatchEvent(new StorageEvent('storage', { key: 'pl2-library' }));
    });
    await expect.poll(() => first.evaluate(() => localStorage.getItem('pl2-library'))).toBe('[]');
    for (const page of [first, second]) {
      await page.reload();
      await page.getByTestId('nav-library').click();
      await expect(page.getByRole('button', { name: 'Inspect Stale unseen prompt' })).toHaveCount(0);
    }
    expect(await first.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('pl2-library-clear:')).length)).toBe(1);
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
