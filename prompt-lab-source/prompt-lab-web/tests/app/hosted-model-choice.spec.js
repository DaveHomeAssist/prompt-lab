import { expect, test } from '@playwright/test';

const models = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', input: 3, output: 15 },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
];

async function openProviders(page) {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if (await settings.isVisible()) await settings.click();
  else {
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.locator('#pl-header-more-panel').getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await page.getByRole('button', { name: /Provider Settings/ }).click();
}

for (const width of [1440, 375]) {
  test(`hosted model choice persists and routes after reload at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const sent = [];
    await page.route('**/api/proxy', async route => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { models } });
      }
      const envelope = route.request().postDataJSON();
      const body = JSON.parse(envelope.body);
      sent.push({ targetUrl: envelope.targetUrl, body });
      await route.fulfill({ json: { model: body.model, content: [{ type: 'text', text: 'Connected' }] }, headers: { 'X-Hosted-Model': body.model } });
    });
    await page.goto('/app/');
    await openProviders(page);
    await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('claude-sonnet-4-6');
    await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('claude-haiku-5-5');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.reload();
    await openProviders(page);
    await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('claude-haiku-5-5');
    await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
    await expect(page.getByText('Connected!', { exact: true })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].targetUrl).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0].body.model).toBe('claude-haiku-5-5');
    expect(sent[0].body).not.toHaveProperty('temperature');
    await expect(page.getByRole('dialog', { name: 'Provider Settings' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `/work/evidence/hosted-model-${width}.png` });
  });
}
