import { expect, test } from '@playwright/test';

// L-2: unknown app routes used to resolve silently back to the previous
// workspace. A dead deep link must land on the Write workspace, correct the
// URL, and tell the user what happened.

test('a dead deep link recovers to Write with visible feedback', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });

  await page.goto('/app/#/definitely-not-a-route');

  // The recovery toast lives ~2.4s, so catch it before the slower checks.
  await expect(page.getByText(/Page not found \(\/definitely-not-a-route\)/)).toBeVisible();
  await expect(page.getByTestId('prompt-input')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/#\/$/);
});

test('a known deep link still resolves without the recovery notice', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });

  await page.goto('/app/#/library');

  await expect(page).toHaveURL(/\/app\/#\/library$/);
  await expect(page.getByText(/Page not found/)).toHaveCount(0);
});
