import fs from 'node:fs';
import { legacyLibraryFixture, verifyLegacyLibrary } from '../../scripts/verify-legacy-library.mjs';
import os from 'node:os';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

for (const width of [375, 1440]) {
  test(`@production Library starter and stale deletion survive process restart at ${width}px`, async () => {
    test.setTimeout(180_000);
    const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-library-restart-'));
    const blocked = [];
    let context;
    let task;
    let sessionId;
    const launch = async () => {
      context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await context.route('**/*', async route => {
        const category = forbiddenRequestCategory(route.request().url());
        if (category) { blocked.push(category); await route.abort('blockedbyclient'); }
        else await route.continue();
      });
      return context.pages()[0] || await context.newPage();
    };
    const library = async page => {
      if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
      else await page.getByRole('tablist', { name: 'Create views' }).getByRole('tab', { name: 'Library', exact: true }).click();
    };
    const snapshot = page => page.evaluate(() => ({
      library: JSON.parse(localStorage.getItem('pl2-library') || '[]'),
      trash: JSON.parse(localStorage.getItem('pl2-library-trash') || '[]'),
      packs: JSON.parse(localStorage.getItem('pl2-loaded-packs') || '[]'),
      deleted: localStorage.getItem('pl2-library-deleted:qa-discarded'),
    }));
    try {
      let page = await launch();
      await context.addInitScript(origin => {
        if (location.origin !== origin || localStorage.getItem('__restartQA')) return;
        localStorage.setItem('__restartQA', '1');
        localStorage.setItem('pl2-library', '[]');
        localStorage.setItem('pl2-library-trash', JSON.stringify([{ id: 'qa-discarded', title: 'QA discarded prompt', original: 'Synthetic stale content', enhanced: 'Synthetic stale content', deletedAt: new Date().toISOString(), tombstoneVersion: 1 }]));
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
      }, appUrl.origin);
      task = await clerk.agentTasks.create({ onBehalfOf: { userId: clerkUserId }, permissions: '*', agentName: 'promptlab-library-restart', taskDescription: 'Synthetic local starter, deletion and process restart acceptance; no inference or purchases.', redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300 });
      await page.goto(task.url, { waitUntil: 'domcontentloaded' });
      await library(page);
      sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
      expect(sessionId).toMatch(/^sess_/);
      await page.getByText('Starter Libraries', { exact: true }).click();
      const pack = page.getByText("Project Prompt Instruments — Dave's Suite", { exact: true }).locator('xpath=ancestor::div[.//button][1]');
      await pack.getByRole('button', { name: 'Load', exact: true }).click();
      await expect(pack.getByRole('button', { name: /^Loaded/ })).toBeDisabled();
      await expect.poll(async () => (await snapshot(page)).library.filter(row => row.metadata?.packId === 'lib_project_prompt_instruments').length).toBe(14);
      const loaded = (await snapshot(page)).library;
      expect(new Set(loaded.map(row => row.id)).size).toBe(14);
      expect(loaded.every(row => row.metadata?.packLoadedAt && row.title && (row.original || row.enhanced))).toBe(true);

      const second = await context.newPage();
      await second.addInitScript(() => {
        window.__holdStorage = true;
        addEventListener('storage', event => { if (window.__holdStorage) event.stopImmediatePropagation(); }, true);
      });
      await second.goto(appUrl.href);
      for (const tab of [page, second]) {
        await library(tab);
        await tab.getByRole('button', { name: /Recently Deleted/ }).click();
        await expect(tab.getByRole('button', { name: 'Permanently delete QA discarded prompt' })).toBeVisible();
      }
      const stale = await second.evaluate(() => localStorage.getItem('pl2-library-trash'));
      page.on('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Permanently delete QA discarded prompt' }).click();
      await expect(page.getByRole('button', { name: 'Permanently delete QA discarded prompt' })).toHaveCount(0);
      await expect(second.getByRole('button', { name: 'Permanently delete QA discarded prompt' })).toBeVisible();
      await second.evaluate(value => {
        localStorage.setItem('pl2-library-trash', value);
        window.__holdStorage = false;
        dispatchEvent(new StorageEvent('storage', { key: 'pl2-library-trash', newValue: value }));
        dispatchEvent(new StorageEvent('storage', { key: 'pl2-library-trash', newValue: '[]' }));
      }, stale);
      for (const tab of [page, second]) await expect(tab.getByRole('button', { name: 'Permanently delete QA discarded prompt' })).toHaveCount(0);
      await expect.poll(async () => (await snapshot(page)).trash).toEqual([]);
      expect((await snapshot(page)).deleted).toBe('1');
      await page.getByRole('button', { name: /^All prompts/ }).click();
      await page.locator('[aria-label="Import Prompt Lab workspace"]').setInputFiles({ name: 'legacy-schema-1.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyLibraryFixture)) });
      const preview = page.getByRole('dialog', { name: 'Review Library import' });
      await preview.getByRole('button', { name: 'Apply import', exact: true }).click();
      await expect(preview).toHaveCount(0);
      await expect.poll(async () => (await snapshot(page)).library.filter(row => row.id === legacyLibraryFixture.library[0].id).length).toBe(1);
      verifyLegacyLibrary((await snapshot(page)).library);
      const before = await snapshot(page);
      const cookies = await context.cookies();
      // Closing a persistent context terminates its browser process. Reuse the
      // actual profile, not an injected Library snapshot, in a new process.
      await context.close();
      page = await launch();
      await context.addCookies(cookies);
      await page.goto(appUrl.href);
      await library(page);
      await page.getByRole('button', { name: /^All prompts/ }).click();
      await expect(page.getByRole('list', { name: 'Saved prompts' }).getByRole('listitem')).toHaveCount(15);
      expect(await snapshot(page)).toEqual(before);
      verifyLegacyLibrary((await snapshot(page)).library);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export Library', exact: true }).click();
      const download = await downloadPromise;
      const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      expect(exported.schemaVersion).toBe(2);
      verifyLegacyLibrary(exported.library);
      expect(await page.evaluate(() => window.Clerk?.session?.id)).toBe(sessionId);
      expect(blocked, 'No inference, purchase or telemetry requests').toEqual([]);
      console.info(`[library-restart ${width}] actual starter load, stale deletion, schema-1 import, process restart and schema-2 export passed`);
    } finally {
      try {
        if (sessionId) await clerk.sessions.revokeSession(sessionId);
        else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
      } finally {
        await context?.close();
        fs.rmSync(profile, { recursive: true, force: true });
      }
    }
  });
}
