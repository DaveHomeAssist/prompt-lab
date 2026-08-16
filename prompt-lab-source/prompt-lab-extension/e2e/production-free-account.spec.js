import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import {
  forbiddenRequestCategory,
  isProductionLicenseResponse,
  readProductionFreeSmokeConfig,
} from './production-auth.mjs';

const CLERK_TEARDOWN_TIMEOUT_MS = 15_000;

function withTimeout(promise, description) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${description} exceeded ${CLERK_TEARDOWN_TIMEOUT_MS / 1_000} seconds.`));
    }, CLERK_TEARDOWN_TIMEOUT_MS);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function reportPhase(phase) {
  console.info(`[production-free-smoke] ${phase}`);
}

test('@production signed-in Free account keeps features open and billing unavailable', async ({ page }) => {
  test.setTimeout(90_000);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerkClient = createClerkClient({ secretKey: clerkSecretKey });
  reportPhase('checking QA session preconditions');
  const activeSessions = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    status: 'active',
    limit: 100,
  });
  const staleAgentSessions = activeSessions.data.filter((session) => session.actor?.type === 'agent');
  reportPhase('revoking stale Agent Task sessions');
  await Promise.all(staleAgentSessions.map((session) => clerkClient.sessions.revokeSession(session.id)));
  reportPhase('confirming no human QA session remains');
  const sessionsAfterStaleAgentCleanup = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    status: 'active',
    limit: 100,
  });
  expect(
    sessionsAfterStaleAgentCleanup.data,
    'The dedicated QA user must not retain a human session between smoke runs.',
  ).toHaveLength(0);

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
    reportPhase('creating Clerk Agent Task');
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
    reportPhase('opening production through the Agent Task');
    await page.goto(agentTask.url, { waitUntil: 'domcontentloaded' });
    reportPhase('waiting for the signed-in application shell');
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    reportPhase('reading disposable browser session');
    agentSessionId = await page.evaluate(() => {
      const sessionId = window.Clerk?.session?.id;
      return typeof sessionId === 'string' && sessionId.startsWith('sess_') ? sessionId : '';
    });
    expect(Boolean(agentSessionId), 'The Agent Task must create a disposable Clerk browser session.').toBe(true);

    reportPhase('checking the Free license response');
    const response = await licenseResponse;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      plan: 'free',
      status: 'free',
      billingDisabled: true,
      retryable: false,
    });

    reportPhase('checking terminal billing UI');
    const billingTrigger = page.getByTestId('billing-trigger');
    await expect(billingTrigger).toHaveText('All Features Open');
    await billingTrigger.click();
    const billingDialog = page.getByRole('dialog', { name: 'All workflow features are open' });
    await expect(billingDialog).toBeVisible();
    await expect(billingDialog.getByText('All workflow features are available during prelaunch. Purchases are temporarily unavailable.', { exact: true })).toBeVisible();
    await expect(billingDialog.locator('p').filter({ hasText: /^Free$/ })).toBeVisible();
    await expect(billingDialog.getByText(/Owner Pro/)).toHaveCount(0);
    await expect(billingDialog.getByText('Purchases are temporarily unavailable', { exact: true })).toBeVisible();
    await expect(billingDialog.getByRole('button', { name: 'Manage Purchases' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: 'Sync Purchase' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: 'Refresh Status' })).toBeDisabled();
    await expect(billingDialog.getByRole('button', { name: /Go Pro/ })).toHaveCount(0);
    await expect(billingDialog.getByRole('button', { name: 'Enable Owner Pro' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(billingDialog).toHaveCount(0);

    reportPhase('checking Model Arena access');
    await page.goto(`${appUrl.href}#/compare`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Model Arena/)).toBeVisible();
    expect(blockedRequests, 'The smoke must not request billing, Stripe, providers, or telemetry.').toEqual([]);

  } finally {
    reportPhase('revoking the disposable session');
    if (agentSessionId) {
      await withTimeout(
        clerkClient.sessions.revokeSession(agentSessionId),
        'Clerk Agent Task session revocation',
      );
    } else if (agentTask) {
      await withTimeout(
        clerkClient.agentTasks.revoke(agentTask.agentTaskId),
        'Unused Clerk Agent Task revocation',
      ).catch(() => undefined);
    }
  }
});
