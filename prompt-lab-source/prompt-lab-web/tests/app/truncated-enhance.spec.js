import { expect, test } from '@playwright/test';

const DRAFT = 'Write a handle-intake checklist for the on-call rotation.';
const CUT = '{"schema_version":2,"primary_id":"expanded","enhanced":"# handle-intake and route the request';
const TAIL = ' before closing the ticket.","variants":[]}';

function anthropicStream({ text, stopReason, inputTokens, outputTokens }) {
  const frames = [
    { type: 'message_start', message: { usage: { input_tokens: inputTokens } } },
    { type: 'content_block_delta', delta: { text } },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ];
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('');
}

test('a truncated Expanded response stays usable and can be continued', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  const sent = [];
  await page.route('**/api/proxy', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: { models: [] } });
      return;
    }
    const body = JSON.parse(route.request().postDataJSON().body);
    sent.push(body);
    const truncated = sent.length === 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: anthropicStream({
        text: truncated ? CUT : TAIL,
        stopReason: truncated ? 'max_tokens' : 'end_turn',
        inputTokens: 911,
        outputTokens: truncated ? 8192 : 40,
      }),
    });
  });

  await page.goto('/app/');
  await page.getByTestId('prompt-input').fill(DRAFT);
  await page.getByTestId('refine-action').click();

  await expect(page.getByText('Response was cut off at the output limit')).toBeVisible();
  await expect(page.getByTestId('partial-result')).toContainText('Partial result');
  await expect(page.getByTestId('output-textarea')).toHaveValue('# handle-intake and route the request');
  await expect(page.getByTestId('output-panel')).toContainText('911 input');
  await expect(page.getByTestId('output-panel')).toContainText('8,192 output');
  expect(await page.getByTestId('prompt-input').inputValue()).toBe(DRAFT);
  expect(sent[0].max_tokens).toBeGreaterThanOrEqual(8192);
  expect(sent[0].system).toContain('"primary_id":"expanded"');

  const continueButton = page.getByRole('button', { name: 'Continue' });
  await continueButton.scrollIntoViewIfNeeded();
  await continueButton.click();
  await expect(page.getByTestId('output-textarea')).toHaveValue('# handle-intake and route the request before closing the ticket.');
  await expect(page.getByText('Response was cut off at the output limit')).toHaveCount(0);
  expect(await page.getByTestId('prompt-input').inputValue()).toBe(DRAFT);
  expect(sent[1].messages.at(-1).content).toMatch(/cut off by the output limit/);
  expect(sent[1].max_tokens).toBeGreaterThan(sent[0].max_tokens);
});
