import { expect, test } from '@playwright/test';

const library = [{
  id: 'brief',
  title: 'Quarterly briefing',
  collection: '',
  original: 'Summarize the quarter for the board.',
  enhanced: 'Write the quarterly customer briefing in five bullets.',
  tags: ['finance'],
  currentVersionId: 'brief-v1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  metadata: {},
  versions: [],
}];

async function boot(page) {
  await page.addInitScript((rows) => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-library', JSON.stringify(rows));
    localStorage.setItem('pl2-prompt-variable-values', '{}');
    const written = [];
    window.__copied = written;
    const clipboard = {
      writeText: (text) => { written.push(String(text)); return Promise.resolve(); },
      readText: async () => written[written.length - 1] || '',
    };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  }, library);
  await page.route('**/api/**', route => {
    if (!route.request().url().includes('/api/proxy')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: JSON.stringify({
        enhanced: 'A filled briefing for the launch team.',
        changes: ['Filled the variables.'],
        reasoning: 'Fixture.',
        variants: [],
      }) } })}\n\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    });
  });
  await page.goto('/app/');
  await expect(page.getByTestId('prompt-input')).toBeVisible();
}

test('command palette finds a prompt and a setting from the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  const search = palette.getByRole('textbox', { name: 'Search commands' });
  await search.fill('brif');
  await expect(palette.getByRole('button', { name: /Quarterly briefing/ })).toBeVisible();
  await search.press('Enter');
  await expect(page.getByTestId('prompt-input')).toHaveValue('Summarize the quarter for the board.');

  await page.keyboard.press('Control+k');
  await expect(palette).toBeVisible();
  await search.fill('dens');
  await palette.getByRole('button', { name: 'Setting: Density' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('?');
  const shortcuts = page.getByTestId('shortcuts-overlay');
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.locator('[data-shortcut-id="cmdPalette"]')).toContainText('Command palette');
  await expect(shortcuts.locator('[data-shortcut-id="cmdPalette"]')).toContainText('Ctrl');
});

test('New Prompt returns focus to the prompt input after the palette or header closes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  const input = page.getByTestId('prompt-input');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const search = palette.getByRole('textbox', { name: 'Search commands' });
  const confirm = page.getByRole('dialog', { name: 'Start a new prompt?' });
  const newPromptFromPalette = async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await search.fill('New Prompt');
    await palette.getByRole('button', { name: /^New Prompt/ }).click();
  };

  // An empty draft starts over without asking.
  await page.evaluate(() => document.body.focus());
  await newPromptFromPalette();
  await expect(confirm).toHaveCount(0);
  await expect(input).toBeFocused();

  // A draft with content asks first; the palette is gone by the time it closes.
  await input.fill('A draft the new prompt replaces.');
  await newPromptFromPalette();
  await confirm.getByRole('button', { name: 'Start new prompt', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();

  // The header button still opens the editor ready for typing.
  await input.fill('Another draft.');
  await page.getByTestId('global-new-prompt').click();
  await confirm.getByRole('button', { name: 'Start new prompt', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await page.keyboard.type('Typed straight into the new prompt.');
  await expect(input).toHaveValue('Typed straight into the new prompt.');
});

test('variable form appears before refine and copy, and remembers values', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await boot(page);
  const prompt = 'Write a briefing for {{audience|the team}} about {{topic}}.';
  await page.getByTestId('prompt-input').fill(prompt);
  await page.getByTestId('refine-action').click();
  const dialog = page.getByTestId('prompt-variable-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('{{audience}}')).toHaveValue('the team');
  await expect(dialog.getByLabel('{{topic}}')).toHaveValue('');
  await dialog.getByLabel('{{topic}}').fill('launch');
  const request = page.waitForRequest((call) => call.url().includes('/api/proxy') && call.method() === 'POST');
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  const sent = await request;
  expect(sent.postData() || '').toContain('the team');
  expect(sent.postData() || '').toContain('launch');
  expect(sent.postData() || '').not.toContain('{{topic}}');
  await expect(page.getByTestId('prompt-input')).toHaveValue(prompt);

  await page.getByTestId('copy-as').getByRole('button', { name: /Copy as/ }).click();
  await page.getByRole('menuitem', { name: 'Plain text' }).click();
  await expect(dialog.getByLabel('{{topic}}')).toHaveValue('launch');
  await dialog.getByRole('button', { name: 'Use these values' }).click();
  await expect.poll(() => page.evaluate(() => window.__copied.at(-1))).toBe('Write a briefing for the team about launch.');
});
