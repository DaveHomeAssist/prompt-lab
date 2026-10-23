import { createClerkClient } from '@clerk/backend';
import { expect, test as base } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

const test = base.extend({
  qa: [async ({}, use) => {
    const config = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
    const owned = { config, clerk, task: null, sessionId: null };
    try { await use(owned); }
    finally {
      if (owned.sessionId) {
        await clerk.sessions.revokeSession(owned.sessionId);
        await expect.poll(async () => (await clerk.sessions.getSession(owned.sessionId)).status).toBe('revoked');
        console.info('[Scratch acceptance] disposable session revocation verified');
      } else if (owned.task) await clerk.agentTasks.revoke(owned.task.agentTaskId);
    }
  }, { timeout: 30_000 }],
});
test.use({ serviceWorkers: 'block' });
test.skip(process.env.PROMPTLAB_SCRATCH_SMOKE !== 'true', 'Explicit Scratch acceptance dispatch only');

for (const width of [375, 1440]) {
  test(`signed-in Scratch focus retains space and saved edits at ${width}px`, async ({ page, qa }) => {
    const { config, clerk } = qa;
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    expect((await clerk.sessions.getSessionList({ userId: config.clerkUserId, status: 'active', limit: 100 })).data.length).toBe(0);
    await page.addInitScript(origin => {
      if (location.origin !== origin) return;
      if (!localStorage.getItem('__scratchAcceptance')) {
        localStorage.setItem('__scratchAcceptance', '1');
        localStorage.setItem('pl2-pads-schema-version', '4');
        localStorage.setItem('pl2-pads', JSON.stringify({ revision: 1, activePadId: 'qa-note', pads: [{ id: 'qa-note', name: 'Synthetic Scratch acceptance', content: '# Synthetic note\n\nPreserve this draft.', timestamp: Date.now() }] }));
      }
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
    }, config.appUrl.origin);
    const blocked = [];
    await page.route('**/*', async route => {
      const category = forbiddenRequestCategory(route.request().url());
      if (category) { blocked.push(category); await route.abort('blockedbyclient'); }
      else await route.continue();
    });
    qa.task = await clerk.agentTasks.create({ onBehalfOf: { userId: config.clerkUserId }, permissions: '*', agentName: 'promptlab-scratch-acceptance', taskDescription: 'Verify approved Scratch focus and autosave using synthetic local notes only; no model or billing calls.', redirectUrl: config.appUrl.href, sessionMaxDurationInSeconds: 600 });
    await page.goto(qa.task.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('global-new-prompt')).toBeVisible();
    qa.sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
    expect(qa.sessionId).toMatch(/^sess_/);
    await page.evaluate(() => { location.hash = '/scratch'; });
    const editor = page.getByRole('textbox', { name: 'Scratchpad' });
    if (width === 375) await page.getByRole('complementary', { name: 'Scratch note index' }).getByRole('button', { name: /Synthetic Scratch acceptance/ }).click();
    await expect(editor).toHaveValue('# Synthetic note\n\nPreserve this draft.');
    const before = await editor.boundingBox();
    await page.getByRole('button', { name: 'Focus note', exact: true }).click();
    const after = await editor.boundingBox();
    expect(after.width * after.height).toBeGreaterThan(before.width * before.height);
    await editor.fill('# Synthetic note\n\nSaved while focused.');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-pads')).pads.find(p => p.id === 'qa-note').content)).toContain('Saved while focused.');
    await page.getByRole('button', { name: 'Exit focus', exact: true }).click();
    await expect(editor).toHaveValue('# Synthetic note\n\nSaved while focused.');
    await page.reload();
    if (width === 375) await page.getByRole('complementary', { name: 'Scratch note index' }).getByRole('button', { name: /Synthetic Scratch acceptance/ }).click();
    await expect(editor).toHaveValue('# Synthetic note\n\nSaved while focused.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    expect(blocked).toEqual([]);
    console.info(`[Scratch acceptance] ${width}px focus, save, exit and reload passed; no model or billing requests`);
  });
}
