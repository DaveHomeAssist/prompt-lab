import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { readProductionFreeSmokeConfig } from './production-auth.mjs';

test.use({ serviceWorkers: 'block' });
for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }]) {
  test(`@production shared import and draft exit recovery at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: clerkSecretKey });
    expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
    let task;
    let sessionId;
    await page.setViewportSize(viewport);
    // All application API calls are blocked, including cloud sync. Only the
    // disposable Clerk login uses the network; fixtures remain browser local.
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Offline screenflow acceptance fixture' } }));
    await page.addInitScript(origin => {
      if (location.origin !== origin) return;
      if (!sessionStorage.getItem('screenflow-qa')) {
        if (localStorage.getItem('pl2-library')) throw new Error('Expected an empty disposable profile.');
        sessionStorage.setItem('screenflow-qa', '1');
        localStorage.setItem('pl2-library', JSON.stringify([{ id: 'screenflow-prior', title: 'Prior fixture', original: 'Original saved fixture', enhanced: 'Original saved fixture', currentVersionId: 'fixture-v1', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }]));
        localStorage.setItem('pl2-session-pl2-session', JSON.stringify({ raw: 'Displaced unsaved fixture', enhanced: '', variants: [], notes: '', editingId: 'screenflow-prior', editingVersionId: 'fixture-v1', saveTitle: 'Prior fixture', tab: 'editor' }));
      }
      localStorage.setItem('pl_telemetry_consent', 'denied');
      const write = Storage.prototype.setItem;
      window.failScreenflowCheckpoint = false;
      Storage.prototype.setItem = function (key, value) {
        if (window.failScreenflowCheckpoint && key === 'pl2-session-pl2-session') throw new DOMException('Synthetic quota', 'QuotaExceededError');
        return write.call(this, key, value);
      };
    }, appUrl.origin);
    try {
      task = await clerk.agentTasks.create({ onBehalfOf: { userId: clerkUserId }, permissions: '*', agentName: 'promptlab-screenflow-acceptance', taskDescription: 'Verify browser-local shared prompt and draft recovery with synthetic fixtures and no inference or purchases.', redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300 });
      await page.goto(task.url, { waitUntil: 'domcontentloaded' });
      const input = page.getByTestId('prompt-input');
      await expect(input).toHaveValue('Displaced unsaved fixture');
      sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
      expect(sessionId).toMatch(/^sess_/);
      const payload = Buffer.from(JSON.stringify({ title: 'Shared fixture', original: 'Independent incoming fixture' })).toString('base64');
      await page.goto(`${appUrl.origin}/app/#share=${payload}`);
      const dialog = page.getByRole('dialog', { name: 'Save as new prompt' });
      await expect(dialog).toBeVisible();
      await expect.poll(() => page.evaluate(() => Array.isArray(JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'screenflow-prior')?.versions))).toBe(true);
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'screenflow-prior'));
      await dialog.getByTestId('save-to-library').click();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).length)).toBe(2);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'screenflow-prior'))).toEqual(before);
      await page.getByRole('button', { name: 'Restore previous draft', exact: true }).click();
      await expect(input).toHaveValue('Displaced unsaved fixture');
      await expect(page.locator('#save-receipt-title')).toHaveCount(0);
      await input.fill('Latest edit immediately before refresh');
      await page.reload();
      await expect(input).toHaveValue('Latest edit immediately before refresh');
      await page.evaluate(() => { window.failScreenflowCheckpoint = true; });
      await input.fill('Retained draft while storage fails');
      await expect(page.getByRole('alert').filter({ hasText: 'Draft recovery could not be saved' })).toBeVisible();
      await page.evaluate(() => { window.failScreenflowCheckpoint = false; });
      await page.getByRole('button', { name: 'Retry draft recovery', exact: true }).click();
      await page.reload();
      await expect(input).toHaveValue('Retained draft while storage fails');
      expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ x: false, y: false });
      console.info(`[screenflow ${viewport.width}] separate save, displaced draft, immediate refresh and failed-write retry passed`);
    } finally {
      if (sessionId) await clerk.sessions.revokeSession(sessionId);
      else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
      console.info(`[screenflow ${viewport.width}] disposable authentication revoked`);
    }
  });
}
