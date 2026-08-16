import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import {
  forbiddenRequestCategory,
  isProductionLicenseResponse,
  readProductionFreeSmokeConfig,
} from './production-auth.mjs';

test('@production signed-in Free account keeps features open and billing unavailable', async ({ page }) => {
  test.setTimeout(90_000);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerkClient = createClerkClient({ secretKey: clerkSecretKey });
  const activeSessions = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    status: 'active',
    limit: 100,
  });
  const staleAgentSessions = activeSessions.data.filter((session) => session.actor?.type === 'agent');
  await Promise.all(staleAgentSessions.map((session) => clerkClient.sessions.revokeSession(session.id)));
  const sessionsAfterStaleAgentCleanup = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    status: 'active',
    limit: 100,
  });
  expect(
    sessionsAfterStaleAgentCleanup.data,
    'The dedicated QA user must not retain a human session between smoke runs.',
  ).toHaveLength(0);
  const existingSessionIds = new Set(sessionsAfterStaleAgentCleanup.data.map((session) => session.id));

  let agentTask = null;
  let agentSessionId = '';
  const blockedRequests = [];
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({
      telemetryEnabled: false,
      pendingEvents: [],
    }));
  });
  await page.route('**/*', async (route) => {
    const category = forbiddenRequestCategory(route.request().url());
    if (!category) {
      await route.continue();
      return;
    }
    blockedRequests.push(`${category}: ${route.request().method()} ${route.request().url()}`);
    await route.abort('blockedbyclient');
  });

  try {
    agentTask = await clerkClient.agentTasks.create({
      onBehalfOf: { userId: clerkUserId },
      permissions: '*',
      agentName: 'promptlab-production-free-smoke',
      taskDescription: 'Verify the signed-in Free account without billing or provider activity.',
      redirectUrl: appUrl.href,
      sessionMaxDurationInSeconds: 300,
    });

    const licenseResponse = page.waitForResponse(
      (response) => isProductionLicenseResponse(response.url(), appUrl.origin),
      { timeout: 30_000 },
    );
    await page.goto(agentTask.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    const signedInSessions = await clerkClient.sessions.getSessionList({
      userId: clerkUserId,
      status: 'active',
      limit: 100,
    });
    const createdAgentSessions = signedInSessions.data.filter((session) => !existingSessionIds.has(session.id));
    expect(createdAgentSessions, 'The Agent Task must create exactly one disposable QA session.').toHaveLength(1);
    agentSessionId = createdAgentSessions[0].id;

    const response = await licenseResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      plan: 'free',
      status: 'free',
      billingDisabled: true,
      retryable: false,
    });

    await page.getByTestId('upgrade-trigger').click();
    const billingDialog = page.getByRole('dialog', { name: 'Unlock Prompt Lab Pro' });
    await expect(billingDialog).toBeVisible();
    await expect(billingDialog.locator('p').filter({ hasText: /^Free$/ })).toBeVisible();
    await expect(billingDialog.getByText(/Owner Pro/)).toHaveCount(0);
    await expect(billingDialog.getByText('Purchases are temporarily unavailable', { exact: true })).toBeVisible();
    await expect(billingDialog.getByRole('button', { name: 'Manage Purchases' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: 'Sync Purchase' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: 'Refresh Status' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: /Go Pro/ })).toHaveCount(0);
    await expect(billingDialog.getByRole('button', { name: 'Enable Owner Pro' })).toHaveCount(0);
    await billingDialog.getByRole('button', { name: 'Close billing modal' }).click();
    await expect(billingDialog).toHaveCount(0);

    await page.goto(`${appUrl.href}#/compare`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Model Arena/)).toBeVisible();
    expect(blockedRequests, 'The smoke must not request billing, Stripe, providers, or telemetry.').toEqual([]);

  } finally {
    if (agentSessionId) {
      await clerkClient.sessions.revokeSession(agentSessionId);
    } else if (agentTask) {
      await clerkClient.agentTasks.revoke(agentTask.agentTaskId).catch(() => undefined);
    }
  }
});
