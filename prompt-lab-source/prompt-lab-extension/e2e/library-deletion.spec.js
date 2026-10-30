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

test('bulk deletion at real storage quota preserves all prompts, then succeeds after freeing space', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-bulk-quota-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const url = `chrome-extension://${new URL(worker.url()).host}/panel.html#/library`;
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (localStorage.getItem('bulk-quota-seeded')) return;
      localStorage.setItem('bulk-quota-seeded', '1');
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      localStorage.setItem('pl2-library', '[]');
      localStorage.setItem('pl2-library-trash', JSON.stringify(['quota-a', 'quota-b', 'kept'].map(id => ({
        id, title: id, original: 'Disposable quota fixture', enhanced: 'Disposable quota fixture',
        deletedAt: new Date().toISOString(), tombstoneVersion: 1,
      }))));
    });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(url);
    await page.getByRole('button', { name: /Recently Deleted/ }).click();
    const selectBatch = async () => {
      await page.getByLabel('Select quota-a', { exact: true }).check();
      await page.getByLabel('Select quota-b', { exact: true }).check();
    };
    await selectBatch();
    // Let initial normalization finish before filling actual browser storage.
    await page.waitForTimeout(250);
    const quota = await page.evaluate(() => {
      let low = 0;
      let high = 16 * 1024 * 1024;
      let quotaErrors = 0;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        try { localStorage.setItem('quota-filler', 'x'.repeat(middle)); low = middle; }
        catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          quotaErrors += 1;
          high = middle - 1;
        }
      }
      // Exactly one old per-ID marker can fit; the second would throw.
      const headroom = 'pl2-library-deleted:quota-a'.length + 1;
      localStorage.setItem('quota-filler', 'x'.repeat(low - headroom));
      return { quotaErrors, headroom };
    });
    expect(quota.quotaErrors).toBeGreaterThan(0);
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete forever' }).click();
    await expect(page.getByText('Permanent deletion failed. The prompts remain recoverable.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('pl2-library-deleted')))).toEqual([]);
    // Real storage events in a second tab exercise reconciliation at full quota.
    const second = await context.newPage();
    await second.goto(url);
    await second.getByRole('button', { name: /Recently Deleted/ }).click();
    await second.evaluate(() => {
      const trash = JSON.parse(localStorage.getItem('pl2-library-trash'));
      localStorage.setItem('pl2-library-trash', JSON.stringify(trash.reverse()));
    });
    for (const tab of [page, second]) {
      await expect(tab.getByLabel('Select quota-a', { exact: true })).toBeVisible();
      await expect(tab.getByLabel('Select quota-b', { exact: true })).toBeVisible();
      await tab.reload();
      await tab.getByRole('button', { name: /Recently Deleted/ }).click();
      await expect(tab.getByLabel('Select quota-a', { exact: true })).toBeVisible();
      await expect(tab.getByLabel('Select quota-b', { exact: true })).toBeVisible();
    }
    await page.evaluate(() => localStorage.removeItem('quota-filler'));
    await selectBatch();
    const stale = await page.evaluate(() => localStorage.getItem('pl2-library-trash'));
    await page.getByRole('toolbar', { name: 'Bulk actions' }).getByRole('button', { name: 'Delete forever' }).click();
    await expect(page.getByLabel('Select quota-a', { exact: true })).toHaveCount(0);
    await expect(second.getByLabel('Select quota-b', { exact: true })).toHaveCount(0);
    await second.evaluate(snapshot => localStorage.setItem('pl2-library-trash', snapshot), stale);
    for (const tab of [page, second]) {
      await tab.reload();
      await tab.getByRole('button', { name: /Recently Deleted/ }).click();
      await expect(tab.getByLabel('Select quota-a', { exact: true })).toHaveCount(0);
      await expect(tab.getByLabel('Select quota-b', { exact: true })).toHaveCount(0);
      await expect(tab.getByLabel('Select kept', { exact: true })).toBeVisible();
    }
  } finally {
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`old Trash remains recoverable after reopen at ${viewport.width}px`, async ({}, testInfo) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-lab-retained-trash-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    context.setDefaultTimeout(10_000);
    try {
      const worker = await test.step('Wait for extension worker', () => context.serviceWorkers()[0] || context.waitForEvent('serviceworker'));
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (localStorage.getItem('retained-trash-seeded')) return;
        localStorage.setItem('retained-trash-seeded', '1');
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-library', '[]');
        localStorage.setItem('pl2-library-trash', JSON.stringify([{
          id: 'old', title: 'Retained old prompt', original: 'Complete old content', enhanced: 'Complete old content',
          deletedAt: '2020-01-01T00:00:00Z', future: { retained: true },
          versions: Array.from({ length: 41 }, (_, i) => ({ id: `v${i}`, original: `History ${i}`, future: i })),
        }]));
      });
      await test.step('Open the app', () => page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html#/library`));
      for (let launch = 0; launch < 2; launch += 1) {
        await test.step(`Open old Trash on launch ${launch + 1}`, async () => {
          if (launch) await page.reload();
          if (viewport.width < 720) {
            await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
          } else {
            await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab', { name: 'Library', exact: true }).click();
          }
          const drawer = page.getByRole('button', { name: 'Show Library drawer' });
          if (await drawer.isVisible()) await drawer.click();
          await page.getByRole('button', { name: /Recently Deleted/ }).click();
          await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
          await expect(page.getByText(/^Deleted .*2020$/)).toBeVisible();
        });
      }
      await page.getByRole('button', { name: 'Restore', exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Restore', exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`old-trash-${viewport.width}.png`) });
      const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight <= document.documentElement.clientHeight }));
      expect(layout).toEqual({ width: true, height: true });
      await page.getByRole('button', { name: 'Restore', exact: true }).click();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]').some(row => row.id === 'old'))).toBe(true);
      await page.reload();
      const record = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'old'));
      expect(record.original).toBe('Complete old content'); expect(record.versions).toHaveLength(41);
      expect(record.versions[40].future).toBe(40); expect(record.future).toEqual({ retained: true });
      expect(await page.evaluate(() => localStorage.getItem('pl2-library-deleted:old'))).toBeNull();
    } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  });
}
