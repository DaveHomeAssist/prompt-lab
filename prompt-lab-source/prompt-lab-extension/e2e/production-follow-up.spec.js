import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { forbiddenRequestCategory, readProductionFreeSmokeConfig } from './production-auth.mjs';

// Accepted plan K: exercise the deployed, authenticated shell and real storage.
// Only the synthetic upstream run and provider response are fixtures. Never
// forward a generation request to the hosted proxy or a paid provider.
test('@production signed-in follow-up preserves its source and saves independently', async ({ page }) => {
  test.setTimeout(120_000);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const activeSessions = await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 });
  expect(activeSessions.data, 'The dedicated QA account must have no active session.').toHaveLength(0);

  let agentTask;
  let sessionId;
  const forbiddenRequests = [];
  const fixtureRequests = [];
  const marker = `Followup${Date.now()}`;
  const sourceOutput = `${marker} saved answer: prioritize the measured acceptance gaps.`;
  const suggestion = { title: `${marker} next step`, prompt: `Continue from this saved answer: ${sourceOutput}` };

  await page.addInitScript(() => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
  });
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url() === `${appUrl.origin}/api/proxy` && request.method() === 'POST') {
      // Capture only our synthetic prompt body, never request auth headers.
      const envelope = request.postDataJSON();
      const payload = JSON.parse(envelope.body);
      fixtureRequests.push(payload.messages?.[0]?.content);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ model: 'synthetic-follow-up', content: [{ type: 'text', text: JSON.stringify({ suggestions: [suggestion] }) }] }),
      });
      return;
    }
    const category = forbiddenRequestCategory(request.url());
    if (category) {
      forbiddenRequests.push(category);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const library = () => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));
  try {
    agentTask = await clerk.agentTasks.create({
      onBehalfOf: { userId: clerkUserId }, permissions: '*',
      agentName: 'promptlab-production-follow-up',
      taskDescription: 'Verify independent follow-up saving using synthetic local data and intercepted provider responses, without billing or inference.',
      redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300,
    });
    await page.goto(agentTask.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
    expect(sessionId).toMatch(/^sess_/);
    await page.getByTestId('prompt-input').fill(`${marker} original instructions`);
    await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();
    await expect.poll(async () => (await library()).find(row => row.original === `${marker} original instructions`)?.currentVersionId).toBeTruthy();
    const parent = (await library()).find(row => row.original === `${marker} original instructions`);
    const source = {
      id: `${marker}-run`, promptId: parent.id, promptVersionId: parent.currentVersionId,
      promptTitle: parent.title, mode: 'ab', status: 'success', input: parent.original,
      output: sourceOutput, provider: 'fixture', model: 'synthetic-source', createdAt: new Date().toISOString(),
    };
    await page.evaluate(record => new Promise((resolve, reject) => {
      const request = indexedDB.open('prompt_lab_local', 4);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('eval_runs', 'readwrite');
        tx.objectStore('eval_runs').put(record);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), source);
    // Wait for the real session store before reloading the actual app.
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}').editingId)).toBe(parent.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const panel = page.getByTestId('follow-up-panel');
    await panel.getByRole('combobox', { name: 'Follow-up source' }).selectOption(source.id);
    await panel.getByTestId('suggest-follow-ups').click();
    await expect(panel.getByText(suggestion.title, { exact: true })).toBeVisible();
    expect(fixtureRequests).toEqual([sourceOutput]);
    await panel.getByRole('button', { name: 'View source output', exact: true }).click();
    await expect(panel.getByText(sourceOutput, { exact: true })).toBeVisible();
    const baseline = await library();

    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__followUpRejectedWrites = 0;
      window.__rejectFollowUpSave = true;
      Storage.prototype.setItem = function (key, value) {
        if (window.__rejectFollowUpSave && key === 'pl2-library') {
          window.__followUpRejectedWrites++;
          throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    });
    await panel.getByRole('button', { name: 'Save to Library', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__followUpRejectedWrites)).toBeGreaterThan(0);
    await expect(panel.getByRole('button', { name: 'Save to Library', exact: true })).toBeEnabled();
    expect(await library()).toEqual(baseline);
    await page.evaluate(() => { window.__rejectFollowUpSave = false; });
    await panel.getByRole('button', { name: 'Save to Library', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Saved to Library', exact: true })).toBeDisabled();
    const saved = await library();
    expect(saved).toHaveLength(baseline.length + 1);
    expect(saved.find(row => row.id === parent.id)).toEqual(baseline.find(row => row.id === parent.id));
    const child = saved.find(row => row.title === suggestion.title);
    expect(child.id).not.toBe(parent.id);
    expect(child.metadata.followUpOrigin).toMatchObject({
      sourcePromptId: parent.id, sourcePromptVersionId: parent.currentVersionId,
      sourceRunId: source.id, generationProvider: 'anthropic', generationModel: 'synthetic-follow-up',
    });
    expect(fixtureRequests).toEqual([sourceOutput]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await page.getByTestId('library-search').fill(child.title);
    await page.getByRole('button', { name: `Inspect ${child.title}`, exact: true }).click();
    await expect(page.getByRole('region', { name: 'Follow-up provenance' }).first()).toBeVisible();
    const reloaded = await library();
    expect(reloaded.find(row => row.id === child.id)?.metadata.followUpOrigin).toEqual(child.metadata.followUpOrigin);
    expect(reloaded.find(row => row.id === parent.id)).toEqual(baseline.find(row => row.id === parent.id));
    expect(forbiddenRequests).toEqual([]);
    console.info('[production-follow-up] source, rejected save, retry, independent identity, unchanged parent and reload passed; one intercepted response, no inference');
  } finally {
    if (sessionId) await clerk.sessions.revokeSession(sessionId);
    else if (agentTask) await clerk.agentTasks.revoke(agentTask.agentTaskId);
  }
});
