import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { BILLING_FEATURES, canAccessFeature } from '../src/lib/billing.js';
import { forbiddenRequestCategory, isProductionLicenseResponse, readProductionFreeSmokeConfig } from './production-auth.mjs';

// Owner impersonation is explicit and manual; scheduled QA never runs this.
test('@production owner retains full Pro access without a paid subscription', async ({ page }) => {
  test.skip(process.env.PROMPTLAB_OWNER_ACCESS_SMOKE !== 'true', 'Requires explicit owner scope.');
  const { appUrl, clerkSecretKey } = readProductionFreeSmokeConfig();
  const login = process.env.PROMPTLAB_OWNER_GITHUB_LOGIN;
  expect(Boolean(login), 'An explicit repository owner identity is required').toBe(true);
  const profile = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  });
  expect(profile.status).toBe(200);
  const email = (await profile.json()).email?.trim().toLowerCase();
  expect(Boolean(email), 'The owner must expose an email for exact Clerk lookup').toBe(true);
  const clerk = createClerkClient({ secretKey: clerkSecretKey });
  const users = await clerk.users.getUserList({ emailAddress: [email], limit: 2 });
  expect(users.totalCount, 'Exactly one Clerk account must match the repository owner').toBe(1);
  const owner = users.data[0];
  expect(owner.emailAddresses.some(address => address.emailAddress.toLowerCase() === email.toLowerCase()
    && address.verification?.status === 'verified')).toBe(true);
  const original = await clerk.sessions.getSessionList({ userId: owner.id, status: 'active', limit: 100 });
  expect(original.totalCount).toBeLessThanOrEqual(100);
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
      onBehalfOf: { userId: owner.id }, permissions: '*', agentName: 'promptlab-owner-access-smoke',
      taskDescription: 'Verify owner entitlement and reload only. No purchase, provider activity or account changes.',
      redirectUrl: appUrl.href, sessionMaxDurationInSeconds: 300,
    });
    const responsePromise = page.waitForResponse(response => isProductionLicenseResponse(response.url(), appUrl.origin));
    await page.goto(task.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: 'Library', exact: true })).toBeVisible();
    sessionId = await page.evaluate(() => window.Clerk?.session?.id || '');
    expect(sessionId.startsWith('sess_')).toBe(true);
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const license = await response.json();
    expect(license).toMatchObject({ plan: 'pro', status: 'active', billingPeriod: 'owner', owner: true, subscriptionId: 'owner-entitlement', checkoutDisabled: false });
    expect(license.customerId === `clerk:${owner.id}`).toBe(true);
    expect(license.clerkUserId === owner.id).toBe(true);
    expect(license.billingDisabled).not.toBe(true);
    for (const feature of Object.keys(BILLING_FEATURES)) expect(canAccessFeature(license.plan, feature), feature).toBe(true);
    await expect(page.getByTestId('billing-trigger')).toHaveText('Owner Pro');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('billing-trigger')).toHaveText('Owner Pro');
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-billing')));
    expect(persisted).toMatchObject({ plan: 'pro', billingPeriod: 'owner', subscriptionId: 'owner-entitlement' });
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Manage collections', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
    await page.goto(`${appUrl.href}#/compare`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Model Arena/)).toBeVisible();
    expect(blocked, 'Owner check must not attempt purchases, provider calls or telemetry').toEqual([]);
    console.info('[owner-smoke] Owner Pro, all five feature gates, reload, collections, export and Model Arena verified');
  } finally {
    if (sessionId) await clerk.sessions.revokeSession(sessionId);
    else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
    const remaining = await clerk.sessions.getSessionList({ userId: owner.id, status: 'active', limit: 100 });
    expect(remaining.data.some(session => session.id === sessionId)).toBe(false);
    for (const session of original.data) expect(remaining.data.some(item => item.id === session.id), 'Pre-existing owner sessions remain active').toBe(true);
    console.info('[owner-smoke] Disposable session revoked; pre-existing owner sessions preserved');
  }
});
