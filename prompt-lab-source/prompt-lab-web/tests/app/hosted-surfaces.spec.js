import { expect, test } from '@playwright/test';

const hostedResponse = {
  content: [{
    type: 'text',
    text: JSON.stringify({
      enhanced: 'Production-ready hosted prompt',
      variants: [
        { label: 'Variant A', content: 'Hosted variant A' },
        { label: 'Variant B', content: 'Hosted variant B' },
      ],
      notes: 'Mocked hosted proxy response',
      assumptions: [],
      tags: ['hosted', 'qa'],
    }),
  }],
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
};

async function mockHostedProxy(page, response = hostedResponse) {
  const requests = [];
  await page.route('**/api/proxy', async (route) => {
    requests.push(route.request().postDataJSON());
    const text = response.content[0].text;
    const body = [
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}`,
      `data: ${JSON.stringify({ type: 'message_stop' })}`,
      '',
    ].join('\n\n');
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream; charset=utf-8',
      headers: {
        'x-ratelimit-store': 'kv',
        'x-demo-remaining': '2',
      },
      body,
    });
  });
  return requests;
}

test('hosted web Enhance works without a user API key', async ({ page }) => {
  const requests = await mockHostedProxy(page);
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });

  await page.goto('/app/');
  await page.getByTestId('prompt-input').fill('Turn this into a reliable release checklist');
  await page.getByTestId('refine-action').click();

  await expect(page.getByTestId('output-textarea')).toHaveValue('Production-ready hosted prompt');
  expect(requests).toHaveLength(1);
  expect(requests[0].targetUrl).toBe('https://api.anthropic.com/v1/messages');
  expect(requests[0].body).toContain('Turn this into a reliable release checklist');
  expect(requests[0].headers['x-api-key']).toBe('__plb_hosted_shared_key__');
});

test('mobile invalidates stale output across prompt, Pad, and voice handoffs', async ({ page }) => {
  const mobileResponse = {
    content: [{ type: 'text', text: 'Copy-ready prompt\n\nRole\nQA lead\n\nTask\nVerify the release.' }],
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  };
  await mockHostedProxy(page, mobileResponse);

  await page.goto('/mobile/');
  await page.getByRole('button', { name: '+ Compose' }).click();
  const composer = page.getByRole('textbox', { name: 'Write or paste a rough prompt' });
  await composer.fill('Verify a release');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('anthropic / claude-sonnet-4-6')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to Pad' })).toBeVisible();

  await page.getByRole('button', { name: 'P Pad' }).click();
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('textbox', { name: 'Pad title' }).fill('QA note');
  await page.getByRole('textbox', { name: 'Pad body' }).fill('Check hosted quotas and persistence.');
  await page.getByRole('button', { name: 'To Composer' }).click();

  await expect(composer).toHaveValue(/Check hosted quotas and persistence/);
  await expect(page.getByText('Run a prompt to generate a copy-ready provider response here.')).toBeVisible();
  await expect(page.getByText('anthropic / claude-sonnet-4-6')).toHaveCount(0);

  await page.getByRole('button', { name: 'Voice' }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByPlaceholder('Transcript appears here')).toHaveValue(/launch checklist/, { timeout: 3_000 });
  await page.getByRole('button', { name: 'Use text' }).click();

  await expect(composer).toHaveValue(/launch checklist/);
  await expect(page.getByText('Run a prompt to generate a copy-ready provider response here.')).toBeVisible();
});

test('mobile Library reuse increments usage and survives reload', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByPlaceholder('Search prompts, tags, text').fill('bug');
  await page.getByRole('heading', { name: 'Bug repro extractor', exact: true }).click();
  await expect(page.getByText('Engineering - 12 uses')).toBeVisible();
  await page.getByRole('button', { name: 'Use prompt' }).click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('pl_mobile_app_state_v2'));
    return state.prompts.find((prompt) => prompt.id === 'p3').uses;
  })).toBe(13);
  await page.reload();
  await page.getByRole('button', { name: 'L Library' }).click();
  await page.getByPlaceholder('Search prompts, tags, text').fill('bug');
  await page.getByRole('heading', { name: 'Bug repro extractor', exact: true }).click();
  await expect(page.getByText('Engineering - 13 uses')).toBeVisible();
});

test('Reset Draft requires confirmation and restores the cleared desktop draft', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });

  await page.goto('/app/');
  const promptInput = page.getByTestId('prompt-input');
  await promptInput.fill('Keep this draft until I explicitly reset it.');

  await page.getByRole('button', { name: 'Reset Draft' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset this draft?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(promptInput).toHaveValue('Keep this draft until I explicitly reset it.');

  await page.getByRole('button', { name: 'Reset Draft' }).click();
  await dialog.getByRole('button', { name: 'Reset draft' }).click();
  await expect(promptInput).toHaveValue('');
  await page.reload();
  await page.getByRole('button', { name: 'Undo reset' }).click();
  await expect(promptInput).toHaveValue('Keep this draft until I explicitly reset it.');
});

test('mobile Clear requires confirmation and restores the cleared composer', async ({ page }) => {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: '+ Compose' }).click();
  const composer = page.getByRole('textbox', { name: 'Write or paste a rough prompt' });
  await composer.fill('Keep this mobile composer draft.');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Clear composer?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(composer).toHaveValue('Keep this mobile composer draft.');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear composer' }).click();
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(composer).toHaveValue('Keep this mobile composer draft.');
});

test('workspace navigation keeps browser history and explains a free compare deep link', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' }));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });

  await page.goto('/app/');
  await page.getByTestId('nav-library').click();
  await expect(page).toHaveURL(/\/app\/#\/library$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByTestId('prompt-input')).toBeVisible();

  await page.goto('/app/#/compare');
  await expect(page).toHaveURL(/\/app\/#\/evaluate$/);
  await expect(page.getByRole('dialog')).toContainText('is a Pro feature');
});
