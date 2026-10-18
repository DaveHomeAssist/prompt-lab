import { expect, test } from '@playwright/test';

for (const [width, height] of [[375, 812], [812, 375], [1440, 900], [3440, 1440]]) {
  test(`hosted Library controls at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.addInitScript(() => {
      const text = 'Write a production handoff.';
      if (sessionStorage.getItem('controls-seeded')) return;
      localStorage.setItem('pl2-library', JSON.stringify([{ id: 'controls', title: 'Production handoff', original: text, enhanced: text, collection: 'Ops', tags: ['Writing'] }]));
      localStorage.setItem('pl2-collections', JSON.stringify(['Ops']));
      localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' })); localStorage.setItem('pl_telemetry_consent', 'denied');
      sessionStorage.setItem('controls-seeded', 'yes');
    });
    await page.goto('/app/#/library');
    await expect(page.getByRole('button', { name: 'Inspect Production handoff' })).toBeVisible();
    for (const mode of ['dark', 'light']) {
      const shell = page.locator('.pl-app-shell');
      if (await shell.getAttribute('data-theme') !== mode) await page.getByRole('button', { name: `Switch to ${mode} mode` }).click();
      for (const palette of ['ember', 'ocean', 'forest', 'plum']) {
        await page.getByLabel('Color palette').selectOption(palette);
        await expect(page.locator('html')).toHaveAttribute('data-palette', palette);
      }
    }
    await page.getByRole('button', { name: 'Gallery view' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Gallery view' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel('Color palette')).toHaveValue('plum');
    const dimensions = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - document.documentElement.clientWidth, y: document.documentElement.scrollHeight - document.documentElement.clientHeight }));
    expect(dimensions).toEqual({ x: 0, y: 0 });
    await page.screenshot({ path: `/tmp/codex-library-01a14cf8/hosted-library-${width}.png` });
  });
}
