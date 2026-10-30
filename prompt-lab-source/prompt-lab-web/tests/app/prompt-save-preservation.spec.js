import { expect, test } from '@playwright/test';

for (const width of [1440, 375]) {
  test(`editor saves and reloads all historical versions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__savePreservationFixture')) return;
      sessionStorage.setItem('__savePreservationFixture', '1');
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-create-layout', JSON.stringify('split'));
      localStorage.setItem('pl2-library', JSON.stringify([{
        id: 'preserved', title: 'Preserved history', original: 'Synthetic original', enhanced: 'Synthetic current result',
        currentVersionId: 'current', createdAt: '2026-10-29T00:00:00.000Z', future: { value: ['retain', false] },
        goldenResponse: { text: 'Golden content '.repeat(2000), futureGolden: true },
        versions: Array.from({ length: 41 }, (_, n) => ({ id: `past-${n}`, original: `Input ${n}`, enhanced: `Result ${n}`,
          savedAt: '2026-10-29T00:00:00.000Z', futureVersion: n })),
      }]));
    });
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
    await page.goto('/app/');
    await page.getByRole('button', { name: 'Prompts', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Prompts beside Write' });
    await panel.getByRole('button', { name: 'Open Preserved history in Write' }).click();
    const close = panel.getByRole('button', { name: 'Close side panel' });
    if (await close.isVisible()) await close.click();
    const result = page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name: 'Result', exact: true });
    if (await result.isVisible()) await result.click();
    await page.getByTestId('output-textarea').fill('Edited through the actual app.');
    await page.getByTestId('save-to-library').click();
    await expect(page.locator('#save-receipt-title')).toBeVisible();
    const read = () => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0]);
    await expect.poll(async () => (await read()).versions.length).toBe(42);
    const saved = await read();
    expect(saved.versions.slice(0, 41).map(version => [version.id, version.futureVersion]))
      .toEqual(Array.from({ length: 41 }, (_, n) => [`past-${n}`, n]));
    expect(saved.future).toEqual({ value: ['retain', false] });
    expect(saved.goldenResponse).toMatchObject({ text: 'Golden content '.repeat(2000), futureGolden: true });
    await page.reload();
    await expect(page.getByTestId('global-new-prompt')).toBeVisible();
    const reopened = await read();
    expect(reopened.versions).toEqual(saved.versions);
    expect(reopened.future).toEqual(saved.future);
    expect(reopened.goldenResponse).toEqual(saved.goldenResponse);
  });
}
