import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const seed = JSON.parse(readFileSync(new URL('../../../prompt-lab-extension/src/data/promptlab-seed-libraries.json', import.meta.url), 'utf8'));
const template = seed.libraries.find((pack) => pack.name === 'Prompt Engineering Meta-Toolkit')
  .prompts.find((prompt) => prompt.title === 'Original vs Enhanced Comparison');

async function prepare(page, library) {
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem('__recoveredContent')) return;
    sessionStorage.setItem('__recoveredContent', '1');
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-library', JSON.stringify(entries));
  }, library);
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
  test(`recovered engineering template accepts multiline values at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await prepare(page, [{ id: 'engineering-template', title: template.title, original: template.prompt,
      enhanced: template.prompt, inputs: template.inputs, tags: [], metadata: {} }]);
    await page.goto('/app/#/library');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Fill Template Variables' });
    await expect(dialog).toBeVisible();
    const original = dialog.getByRole('textbox', { name: 'Original', exact: true });
    const enhanced = dialog.getByRole('textbox', { name: 'Enhanced', exact: true });
    await expect(original).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Apply Template' })).toBeDisabled();
    await original.fill('Raw version\nSecond line');
    await enhanced.fill('Improved version\nSecond line');
    await expect(dialog.getByRole('button', { name: 'Apply Template' })).toBeEnabled();
    expect(await page.evaluate(() => ({
      height: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    }))).toEqual({ height: true, width: true });
    await dialog.getByRole('button', { name: 'Apply Template' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}').enhanced || ''))
      .toContain('Raw version\nSecond line');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session')).enhanced))
      .toContain('Improved version\nSecond line');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session')).raw)).toBe(template.prompt);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].original)).toBe(template.prompt);
    await page.goto('/app/#/library');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}').enhanced || ''))
      .toBe(template.prompt);
  });
}

test('optional published image pack imports through Library review without becoming a starter', async ({ page }) => {
  await prepare(page, []);
  const response = await page.request.get('/packs/image-generation.json');
  expect(response.ok()).toBe(true);
  const pack = await response.json();
  expect(pack.presets).toHaveLength(34);
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'image-generation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)),
  });
  const dialog = page.getByRole('dialog', { name: 'Review Library import' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply import', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]').length)).toBe(34);
});
