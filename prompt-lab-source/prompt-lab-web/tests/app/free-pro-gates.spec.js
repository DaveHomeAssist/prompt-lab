import { expect, test } from '@playwright/test';

// The hosted dev build runs with Pro gates on and a Free plan, which is what a
// signed-in Free account sees in production after pricing v2 (#183):
// Library export is free; Collections, batch test-case runs and Compare
// (which hosts the diff viewer) are Pro and route to a named billing dialog.
// Nothing here opens checkout or calls a provider.

test.beforeEach(async ({ page }) => {
  await page.route('**/api/proxy', (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
    if (sessionStorage.getItem('free-gates-seeded')) return;
    localStorage.setItem('pl2-library', JSON.stringify([{
      id: 'alpha', title: 'Alpha prompt', collection: '', original: 'Summarize the incident report.',
      enhanced: 'Summarize the incident report in five bullet points.', tags: ['verification'],
      currentVersionId: 'alpha-v1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', metadata: {},
    }]));
    sessionStorage.setItem('free-gates-seeded', 'yes');
  });
});

test('Free accounts export the Library without a paywall', async ({ page }) => {
  await page.goto('/app/#/library');
  await expect(page.getByRole('button', { name: 'Inspect Alpha prompt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Pro', exact: true })).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.getByRole('dialog', { name: /is a Pro feature/ })).toHaveCount(0);
});

test('Free accounts see Collections behind a named Pro dialog', async ({ page }) => {
  await page.goto('/app/#/library');
  await page.getByRole('button', { name: 'Collections Pro feature', exact: true }).click();
  const gate = page.getByRole('dialog', { name: 'Collections is a Pro feature', exact: true });
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Close billing modal', exact: true }).click();
  await expect(gate).toHaveCount(0);
});

test('Free accounts can save test cases but batch runs open the Pro dialog', async ({ page }) => {
  await page.goto('/app/#/library');
  await page.getByRole('button', { name: 'Inspect Alpha prompt' }).click();
  await page.getByRole('tab', { name: 'Tests' }).click();
  const cases = page.getByRole('region', { name: 'Test cases' });
  await cases.getByRole('button', { name: 'Add Case' }).click();
  await page.getByLabel('Test case title').fill('Executive brevity');
  await page.getByLabel('Test case prompt input').fill('Summarize the Q3 outage report for the board.');
  await page.getByRole('button', { name: 'Save Case' }).click();
  await expect(cases).toContainText('Test Cases (1)');

  await page.getByRole('button', { name: 'Open in Editor' }).click();
  const runCases = page.getByRole('button', { name: 'Test Enhancer Pro feature', exact: true });
  await expect(runCases).toBeEnabled();
  await runCases.click();
  const gate = page.getByRole('dialog', { name: 'Batch runs is a Pro feature', exact: true });
  await expect(gate).toBeVisible();
  await expect(page.getByText(/Ran \d+\/1 test cases/)).toHaveCount(0);
});

test('Free accounts see a Pro badge on locked navigation, not on free views', async ({ page }) => {
  await page.goto('/app/#/evaluate');
  const views = page.getByRole('tablist', { name: 'Evaluate views' });
  const compareTab = views.getByRole('tab', { name: 'Compare Pro feature', exact: true });
  await expect(compareTab).toBeVisible();
  await expect(compareTab.getByTestId('pro-badge')).toHaveAttribute('title', 'Pro feature');
  await expect(compareTab.getByTestId('pro-badge')).toContainText('Pro');
  await expect(views.getByRole('tab', { name: 'History', exact: true })).toBeVisible();
  await expect(views.getByRole('tab', { name: 'History', exact: true }).getByTestId('pro-badge')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Compare View Pro feature', exact: true })).toBeVisible();

  await page.goto('/app/#/library');
  await page.getByRole('button', { name: 'Inspect Alpha prompt' }).click();
  const compare = page.getByRole('button', { name: 'Compare Pro feature', exact: true });
  await expect(compare).toBeVisible();
  await compare.click();
  const gate = page.getByRole('dialog', { name: 'Compare is a Pro feature', exact: true });
  await expect(gate).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open in Editor', exact: true }).getByTestId('pro-badge')).toHaveCount(0);
});
