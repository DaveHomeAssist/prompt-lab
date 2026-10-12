import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { forbiddenRequestCategory, isProductionLicenseResponse, readProductionFreeSmokeConfig } from './production-auth.mjs';

// Explicit manual scope only: scheduled Library smoke must never create checkouts.
test('@production authenticated billing creates unpaid checkout and portal sessions', async ({ page }) => {
  test.skip(process.env.PROMPTLAB_BILLING_CHECKOUT_SMOKE !== 'true', 'Requires explicit billing scope.');
  test.setTimeout(90_000);
  const { appUrl, clerkSecretKey, clerkUserId } = readProductionFreeSmokeConfig();
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
  const blocked = [];
  let task;
  let sessionId;
  await page.addInitScript(() => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-telemetry', JSON.stringify({ telemetryEnabled: false, pendingEvents: [] }));
  });
  await page.route('**/*', async route => {
    const category = forbiddenRequestCategory(route.request().url());
    if (category) { blocked.push(category); await route.abort('blockedbyclient'); }
    else await route.continue();
  });
  try {
    task = await clerk.agentTasks.create({
      onBehalfOf: { userId: clerkUserId }, permissions: '*', agentName: 'promptlab-billing-smoke',
      taskDescription: 'Create unpaid checkout quotes and a portal session; never submit payment or change a subscription.',
      redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300,
    });
    const initialLicense = page.waitForResponse(response => isProductionLicenseResponse(response.url(), appUrl.origin));
    await page.goto(task.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
    expect(sessionId).toMatch(/^sess_/);
    const token = await page.evaluate(() => window.Clerk.session.getToken());
    const headers = { Authorization: `Bearer ${token}` };
    // Let the app's first validation finish before issuing billing requests.
    // Racing it could create duplicate QA customer records on a fresh account.
    const license = await initialLicense;
    expect(license.status()).toBe(200);
    const before = await license.json();
    expect(before.plan).toBe('free');
    expect(before.billingDisabled).not.toBe(true);

    for (const [period, priceId] of [
      ['monthly', 'price_1TM8l1AsNArhoaC1UZ0IATWJ'],
      ['annual', 'price_1TM8l1AsNArhoaC1J8otOv5p'],
    ]) {
      const response = await page.request.post(`${appUrl.origin}/api/billing/checkout`, {
        headers, data: { period, source: 'billing-restoration-smoke-20261012' },
      });
      expect(response.status()).toBe(200);
      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(result.priceId).toBe(priceId);
      expect(result.period).toBe(period);
      expect(result.customerId).toBe(before.customerId);
      expect(new URL(result.url).origin).toBe('https://checkout.stripe.com');
      expect(result.checkoutSessionId).toMatch(/^cs_live_/);
      // IDs identify only the synthetic QA sessions for immediate API expiration.
      // Checkout/portal URLs and authentication tokens must never enter logs.
      console.info(`[billing-smoke] ${period} unpaid session ${result.checkoutSessionId}`);
    }
    const portal = await page.request.post(`${appUrl.origin}/api/billing/portal`, { headers, data: {} });
    expect(portal.status()).toBe(200);
    expect(new URL((await portal.json()).url).origin).toBe('https://billing.stripe.com');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    await expect(page.getByTestId('billing-trigger')).toHaveText('Upgrade');
    const after = await page.request.post(`${appUrl.origin}/api/billing/license`, { headers, data: { action: 'validate' } });
    expect(after.status()).toBe(200);
    expect(await after.json()).toMatchObject({ plan: 'free', customerId: before.customerId, subscriptionId: '' });
    expect(blocked, 'No browser purchase, provider, or telemetry requests').toEqual([]);
  } finally {
    if (sessionId) await clerk.sessions.revokeSession(sessionId);
    else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
    expect((await clerk.sessions.getSessionList({ userId: clerkUserId, status: 'active', limit: 100 })).data).toHaveLength(0);
  }
});
