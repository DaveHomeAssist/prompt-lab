import { createClerkClient } from '@clerk/backend';
import { expect, test as base } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

// Fixture teardown has its own budget even when an acceptance action times out.
const test = base.extend({
  qaSession: [async ({}, use) => {
    const config = readProductionFreeSmokeConfig();
    const clerk = createClerkClient({ secretKey: config.clerkSecretKey });
    const owned = { clerk, config, task: null, sessionId: null };
    try { await use(owned); }
    finally {
      if (owned.sessionId) {
        await clerk.sessions.revokeSession(owned.sessionId);
        await expect.poll(async () => (await clerk.sessions.getSession(owned.sessionId)).status).toBe('revoked');
        console.info('[activation cleanup] disposable session revocation verified');
      } else if (owned.task) {
        await clerk.agentTasks.revoke(owned.task.agentTaskId);
        console.info('[activation cleanup] unused task revoked');
      }
    }
  }, { timeout: 30_000 }],
});

test.use({ serviceWorkers: 'block' });

for (const width of [375, 1440]) {
  test(`@production activation to Evaluate comparison at ${width}px`, async ({ page, context, qaSession }) => {
    test.setTimeout(150_000);
    const { appUrl, clerkUserId } = qaSession.config;
    const { clerk } = qaSession;
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    const phase = name => console.info(`[activation ${width}] ${name}`);
    expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data.length).toBe(0);
    let task;
    let sessionId;
    let calls = 0;
    const blocked = [];
    const outputs = ['Write a concise launch brief with three measured outcomes.', 'Write a concise launch brief with three measured outcomes and a named owner.'];
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appUrl.origin });
    await page.addInitScript(({ origin, staleMode }) => {
      if (location.origin !== origin) return;
      if (!localStorage.getItem('__activationQA')) {
        localStorage.setItem('__activationQA', '1');
        localStorage.setItem('pl2-library', '[]');
        localStorage.setItem('pl2-session-pl2-session', JSON.stringify({ enhMode: staleMode }));
      }
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
    }, { origin: appUrl.origin, staleMode: width === 375 ? 'json' : 'concise' });
    await page.route('**/*', async route => {
      const request = route.request();
      if (request.url() === `${appUrl.origin}/api/proxy` && request.method() === 'POST') {
        expect(calls, 'Only the two deliberate refinement requests are allowed').toBeLessThan(2);
        const payload = JSON.parse(request.postDataJSON().body);
        expect(payload.system).toContain('"primary_id":"expanded"');
        expect(payload.system).toContain('"variants":[]');
        expect(payload.system).not.toContain('Strict JSON');
        expect(payload.system).not.toContain('Tighter');
        const result = JSON.stringify({ title: 'Synthetic launch brief', enhanced: outputs[calls++], changes: ['Added measurable outcomes'], variants: [] });
        if (payload.stream) {
          const frame = data => `data: ${JSON.stringify(data)}\n\n`;
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: frame({ type: 'content_block_delta', delta: { text: result } }) + frame({ type: 'message_stop' }) });
        } else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: result }] }) });
        return;
      }
      const category = forbiddenRequestCategory(request.url());
      if (category) { blocked.push(category); await route.abort('blockedbyclient'); }
      else await route.continue();
    });
    const runs = () => page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('prompt_lab_local', 4);
      const timer = setTimeout(() => reject(new Error('Timed out reading eval_runs')), 5_000);
      const fail = error => { clearTimeout(timer); reject(error); };
      request.onerror = () => fail(request.error);
      request.onblocked = () => fail(new Error('eval_runs database is blocked'));
      request.onupgradeneeded = () => {
        request.transaction.abort();
        fail(new Error('Application has not initialized eval_runs'));
      };
      request.onsuccess = () => {
        const db = request.result;
        let tx;
        try { tx = db.transaction('eval_runs', 'readonly'); }
        catch (error) { db.close(); fail(error); return; }
        const rows = tx.objectStore('eval_runs').getAll();
        tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(rows.result); };
        tx.onabort = () => { db.close(); fail(tx.error); };
      };
    }));
    {
      phase('authenticate');
      task = await clerk.agentTasks.create({ onBehalfOf: { userId: clerkUserId }, permissions: '*', agentName: 'promptlab-activation', taskDescription: 'Verify starter, save and Evaluate comparison using intercepted synthetic responses only; no model calls.', redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300 });
      qaSession.task = task;
      await page.goto(task.url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('prompt-input')).toBeVisible();
      sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
      qaSession.sessionId = sessionId;
      expect(sessionId).toMatch(/^sess_/);
      const editingContext = page.getByRole('region', { name: 'Editing context' });
      await expect(editingContext).toContainText('New unsaved prompt');
      phase('verify restored generation defaults');
      await page.getByText(/Generation options · Expanded/).click();
      const strategies = page.getByLabel('Preferred primary candidate');
      await expect(strategies).toHaveValue('expanded');
      await expect(strategies.locator('option')).toHaveText(['Expanded', 'Refined', 'Rebuilt']);
      await expect(page.getByRole('checkbox', { name: /Generate alternatives/ })).not.toBeChecked();
      await expect(page.getByRole('button', { name: /JSON/i })).toHaveCount(0);
      await page.getByText(/Generation options · Expanded/).click();
      phase('load and save starter');
      await page.getByRole('button', { name: 'Load Starter Draft', exact: true }).click();
      await expect(page.getByTestId('prompt-input')).not.toHaveValue('');
      await page.getByRole('button', { name: 'Save First Prompt', exact: true }).click();
      await page.getByRole('dialog', { name: 'Save as new prompt', exact: true }).getByRole('button', { name: /^Save as new prompt (?:Ctrl|⌘)\+S$/ }).click();
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]').length)).toBe(1);
      await expect(editingContext).toContainText('Editing saved prompt:');
      await expect(editingContext).toContainText('No unsaved changes');
      const shortcuts = page.getByRole('button', { name: /^Prompt shortcuts/ });
      await expect(shortcuts).toHaveAttribute('aria-expanded', width === 375 ? 'false' : 'true');
      await shortcuts.click();
      for (let i = 0; i < 2; i++) {
        phase(`refine ${i + 1}`);
        await page.getByTestId('refine-action').click();
        await expect.poll(async () => (await runs()).filter(row => row.status === 'success').length).toBe(i + 1);
        await expect(editingContext).toContainText('Unsaved changes');
      }
      phase('compare saved runs');
      await page.goto(`${appUrl.href}#/evaluate`);
      await expect(page.getByText('Evaluate deck', { exact: true })).toBeVisible();
      const comparisons = page.getByRole('button', { name: 'Compare', exact: true });
      await expect(comparisons).toHaveCount(2);
      await comparisons.nth(0).click();
      await comparisons.nth(1).click();
      await expect(page.getByText('Ready to compare the selected runs')).toBeVisible();
      await page.getByRole('button', { name: 'Copy Comparison', exact: true }).click();
      const comparison = await page.evaluate(() => navigator.clipboard.readText());
      for (const output of outputs) expect(comparison).toContain(output);
      phase('verdict and reload');
      await page.getByRole('button', { name: 'unrated', exact: true }).first().click();
      await expect.poll(async () => (await runs()).some(row => row.verdict)).toBe(true);
      const before = await runs();
      await page.reload();
      await expect(page.getByText('Evaluate deck', { exact: true })).toBeVisible();
      expect(await runs()).toEqual(before);
      phase('copy winner');
      const winner = page.getByRole('button', { name: outputs[1], exact: true }).locator('xpath=ancestor::div[.//button[normalize-space(.)="Compare"]][1]');
      await winner.getByRole('button', { name: 'Copy', exact: true }).click();
      const reused = await page.evaluate(() => navigator.clipboard.readText());
      expect(reused).toBe(outputs[1]);
      phase('reuse winner');
      await page.goto(`${appUrl.href}#/`);
      // Make the discard-confirmation precondition explicit on both viewports.
      await page.getByTestId('prompt-input').fill('Synthetic draft to discard before reusing the selected run.');
      await page.getByTestId('global-new-prompt').click();
      await page.getByRole('dialog', { name: 'Start a new prompt?' }).getByRole('button', { name: 'Start new prompt', exact: true }).click();
      await page.getByTestId('prompt-input').fill(reused);
      await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();
      await expect.poll(() => page.evaluate(output => JSON.parse(localStorage.getItem('pl2-library') || '[]').some(row => row.original === output), outputs[1])).toBe(true);
      await expect(editingContext).toContainText('No unsaved changes');
      phase('verify slice 2A in both hosted layouts');
      const savedWinner = await page.evaluate(output => JSON.parse(localStorage.getItem('pl2-library') || '[]')
        .find(row => row.original === output), outputs[1]);
      // Library Save is immediate; useSessionSave commits the editor after 500 ms.
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}')))
        .toMatchObject({ raw: outputs[1], editingId: savedWinner.id });
      for (const layout of ['stacked', 'split']) {
        await page.evaluate(value => localStorage.setItem('pl2-create-layout', JSON.stringify(value)), layout);
        await page.reload();
        await expect(editingContext).toContainText('Editing saved prompt:');
        await expect(editingContext).toContainText('No unsaved changes');
        await expect(shortcuts).toHaveAttribute('aria-expanded', width === 375 ? 'true' : 'false');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      }
      expect(calls).toBe(2);
      expect(blocked).toEqual([]);
      console.info(`[activation ${width}] real starter/save/refine/history/compare/copy/verdict/reload flow passed with two synthetic provider responses`);
    }
  });
}
