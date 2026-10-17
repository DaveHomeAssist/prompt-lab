import { test, expect } from '@playwright/test';

const visitKey = 'promptlab_splash_seen';

test('first visit, repeat tab, cleared storage and forced splash', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), visitKey)).toBe('1');
  await page.reload();
  await expect(page).toHaveURL(/\/app\/?$/);

  const returningTab = await context.newPage();
  await returningTab.goto('/?utm_source=return&upgrade=pro');
  await expect(returningTab).toHaveURL(/\/app\/?\?utm_source=return&upgrade=pro$/);
  await returningTab.close();

  await page.goto('/?splash=1');
  await expect(page).toHaveURL(/\/\?splash=1$/);
  await page.goto('/#pricing');
  await expect(page).toHaveURL(/\/#pricing$/);
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page).toHaveURL(/\/app\/?$/);
});

for (const failure of ['access', 'write']) {
  test(`blocked storage (${failure}) keeps landing and app links usable`, async ({ page }) => {
    await page.addInitScript((mode) => {
      if (mode === 'access') {
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
      } else {
        Storage.prototype.setItem = () => { throw new Error('Quota exceeded'); };
      }
    }, failure);
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('a[href^="/app"]').first()).toBeVisible();
    await page.locator('a[href^="/app"]').first().click();
    await expect(page).toHaveURL(/\/app\/?\?/);
  });
}

test('direct app entry remains direct', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app\/?$/);
});
