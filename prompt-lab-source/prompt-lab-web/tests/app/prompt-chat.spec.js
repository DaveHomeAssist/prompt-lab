import { expect, test } from '@playwright/test';
import { switchTheme } from './theme-toggle.js';

for (const width of [375, 1440]) {
  test(`hosted chat uses selected model, preserves history and reports limits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('pl_telemetry_consent', 'denied');
      localStorage.setItem('pl2-provider-settings', JSON.stringify({ anthropicModel: 'claude-haiku-5-5' }));
    });
    const sent = [];
    const reset = new Date(Date.now() + 86400000).toISOString();
    await page.route('**/api/**', async route => {
      if (!route.request().url().endsWith('/api/proxy') || route.request().method() !== 'POST') {
        return route.fulfill({ status: 503, json: {} });
      }
      const envelope = route.request().postDataJSON();
      const body = JSON.parse(envelope.body);
      sent.push({ target: envelope.targetUrl, body });
      if (sent.length === 3) {
        return route.fulfill({ status: 429, json: { error: 'Hosted daily limit reached', code: 'hosted_demo_limit', limit: 3, reset_at: reset }, headers: { 'X-Demo-Remaining': '0', 'X-Demo-Limit': '3', 'X-Demo-Reset': reset } });
      }
      return route.fulfill({ json: { model: body.model, content: [{ type: 'text', text: `Reply ${sent.length}` }] }, headers: { 'X-Hosted-Access': 'standard', 'X-Demo-Remaining': '2', 'X-Demo-Limit': '3', 'X-Demo-Reset': reset, 'X-Hosted-Model': body.model } });
    });
    await page.goto('/app/');
    await page.getByTestId('prompt-input').fill('Private draft excluded from chat');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const panel = page.getByRole('complementary', { name: 'Chat beside Write' });
    const input = panel.getByRole('textbox', { name: 'Message', exact: true });
    expect(sent).toHaveLength(0);
    await input.fill('First question');
    await input.press('Control+Enter');
    await expect(panel.getByText('Reply 1', { exact: true })).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].target).toBe('https://api.anthropic.com/v1/messages');
    expect(sent[0].body.model).toBe('claude-haiku-5-5');
    expect(sent[0].body.max_tokens).toBe(1024);
    expect(JSON.stringify(sent[0].body)).not.toContain('Private draft excluded from chat');
    await expect(panel.getByTestId('hosted-quota')).toContainText('2 of 3 left today');
    await input.fill('Second question');
    await panel.getByRole('button', { name: 'Send message' }).click();
    await expect(panel.getByText('Reply 2', { exact: true })).toBeVisible();
    expect(sent[1].body.messages).toEqual([{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'Reply 1' }, { role: 'user', content: 'Second question' }]);
    await input.fill('Third question');
    await panel.getByRole('button', { name: 'Send message' }).click();
    await expect(panel.getByRole('alert')).toContainText("Prompt Lab's free hosted demo limit is used up");
    await expect(input).toHaveValue('Third question');
    await expect(panel.getByTestId('hosted-quota')).toContainText('Hosted demo used up');
    expect(sent).toHaveLength(3);
    await panel.getByRole('button', { name: 'Send message' }).click();
    await expect(panel.getByText('Reply 4', { exact: true })).toBeVisible();
    expect(sent).toHaveLength(4);
    expect(sent[3].body.messages.map(row => row.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    for (const theme of ['light', 'dark']) {
      if (await page.locator('.pl-app-shell').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
      await expect(input).toBeInViewport();
      await expect(panel.getByRole('button', { name: 'Send message' })).toBeInViewport();
      expect(await page.evaluate(() => ({ x: document.documentElement.scrollWidth > document.documentElement.clientWidth, y: document.documentElement.scrollHeight > document.documentElement.clientHeight }))).toEqual({ x: false, y: false });
    }
    await panel.getByRole('button', { name: 'Provider Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Provider Settings' })).toBeVisible();
    expect(sent).toHaveLength(4);
  });
}
