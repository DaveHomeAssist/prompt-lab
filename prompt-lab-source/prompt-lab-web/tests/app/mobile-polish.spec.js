import { expect, test } from '@playwright/test';

// Oct 27 web QA leftovers: at 320px the "New unsaved prompt" heading was drawn
// under the Scratch toggle, and the compact tab bar said "Dual" while every
// other surface says "Dual Pane".

const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

for (const width of [320, 375]) {
  test(`editing context heading and side-panel toggles do not overlap at ${width}px`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
      localStorage.setItem('pl_telemetry_consent', 'denied');
    });
    await page.setViewportSize({ width, height: 700 });
    await page.goto('/app/#/');
    await page.getByTestId('prompt-input').fill('Review my deploy plan and flag what could break tonight.');

    const bar = page.getByRole('region', { name: 'Editing context' });
    const heading = bar.getByText('New unsaved prompt', { exact: true });
    await expect(heading).toBeVisible();
    const headingBox = await heading.boundingBox();
    const barBox = await bar.boundingBox();
    for (const name of ['Scratch', 'Prompts']) {
      const box = await bar.getByRole('button', { name, exact: true }).boundingBox();
      expect(overlaps(headingBox, box), `${name} covers the heading at ${width}px`).toBe(false);
      expect(box.x + box.width).toBeLessThanOrEqual(barBox.x + barBox.width);
    }

    const nav = page.getByRole('navigation', { name: 'Primary mobile navigation' });
    await expect(nav.getByRole('button', { name: 'Dual Pane', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Dual', exact: true })).toHaveCount(0);
  });
}
