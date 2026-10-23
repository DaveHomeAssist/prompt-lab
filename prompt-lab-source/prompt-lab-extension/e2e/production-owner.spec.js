import { createClerkClient } from '@clerk/backend';
import { expect, test } from '@playwright/test';
import { forbiddenRequestCategory, isProductionLicenseResponse, readProductionFreeSmokeConfig } from './production-auth.mjs';

// Owner impersonation is explicit and manual; scheduled QA never runs this.
test('@production owner retains full Pro access without a paid subscription', async ({ page }) => {
  test.skip(process.env.PROMPTLAB_OWNER_ACCESS_SMOKE !== 'true', 'Requires explicit owner scope.');
  test.setTimeout(150_000);
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
    if (location.origin !== 'https://promptlab.tools') return;
    if (!localStorage.getItem('__owner_access_fixture')) {
      localStorage.setItem('__owner_access_fixture', '1');
      localStorage.setItem('pl2-library', JSON.stringify([{
        id: 'owner-access-fixture', title: 'Owner access fixture', collection: '',
        original: 'Summarize the synthetic incident report.', enhanced: 'Summarize the synthetic incident report in five bullet points.',
        tags: ['owner-smoke'], currentVersionId: 'owner-access-v1',
        createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', metadata: {},
      }]));
    }
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
    await expect(page.getByText('Owner Pro', { exact: true })).toBeVisible();
    await expect(page.getByTestId('billing-trigger')).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Owner Pro', { exact: true })).toBeVisible();
    await expect(page.getByTestId('billing-trigger')).toHaveCount(0);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-billing')));
    expect(persisted).toMatchObject({ plan: 'pro', billingPeriod: 'owner', subscriptionId: 'owner-entitlement' });
    await page.getByRole('tab', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Manage collections', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'New collection name', exact: true })).toBeEditable();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    expect(await (await downloadPromise).failure()).toBeNull();
    await page.getByRole('button', { name: 'Inspect Owner access fixture', exact: true }).click();
    await page.getByRole('tab', { name: 'Tests', exact: true }).click();
    await page.getByRole('region', { name: 'Test cases' }).getByRole('button', { name: 'Add Case' }).click();
    await page.getByLabel('Test case title', { exact: true }).fill('Owner batch access');
    await page.getByLabel('Test case prompt input', { exact: true }).fill('Summarize a synthetic report.');
    await page.getByRole('button', { name: 'Save Case', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Test cases' })).toContainText('Test Cases (1)');
    await page.getByRole('button', { name: 'Open in Editor', exact: true }).click();
    const batch = page.getByRole('button', { name: 'Test Enhancer', exact: true });
    await expect(batch).toBeEnabled();
    await expect(batch).not.toHaveAttribute('data-testid', 'pro-gated-action');
    await expect(batch).not.toHaveAttribute('title', 'Batch runs are part of Prompt Lab Pro.');
    const output = page.getByTestId('output-panel');
    await output.getByRole('button', { name: 'Diff', exact: true }).click();
    await expect(output.getByRole('tab', { name: 'Side-by-side', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(output.getByRole('tabpanel')).toContainText('Summarize the synthetic incident report');
    await page.goto(`${appUrl.href}#/compare`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/Model Arena|Compare · \d+ variants/)).toBeVisible();
    await expect(page.getByText(/^(A\/B testing|Compare) is part of Prompt Lab Pro\.$/)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /is a Pro feature/ })).toHaveCount(0);
    expect(blocked, 'Owner check must not attempt purchases, provider calls or telemetry').toEqual([]);
    console.info('[owner-smoke] Owner Pro and reload verified; production collection editor, export download, ungated batch control, Diff view and Compare accessible');
  } finally {
    if (sessionId) await clerk.sessions.revokeSession(sessionId);
    else if (task) await clerk.agentTasks.revoke(task.agentTaskId);
    const remaining = await clerk.sessions.getSessionList({ userId: owner.id, status: 'active', limit: 100 });
    expect(remaining.data.some(session => session.id === sessionId)).toBe(false);
    for (const session of original.data) expect(remaining.data.some(item => item.id === session.id), 'Pre-existing owner sessions remain active').toBe(true);
    console.info('[owner-smoke] Disposable session revoked; pre-existing owner sessions preserved');
  }
});
