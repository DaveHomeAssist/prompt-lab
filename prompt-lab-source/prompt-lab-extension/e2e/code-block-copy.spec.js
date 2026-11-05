import { chromium, expect, test } from '@playwright/test';
import path from 'node:path';

test('Scratch code blocks copy exact text with keyboard access in both themes', async () => {
  const extension = path.resolve('dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.route('**/api/**', route => route.abort());
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    await page.getByTestId('nav-scratch').click();
    const editor = page.getByRole('textbox', { name: 'Scratchpad', exact: true });
    const code = '  <tag>& "quoted" $& {{input}}\n\t雪\n';
    await editor.fill('```html\n' + code + '\n```\n\n```js\nsecond()\n```');
    await page.getByRole('tab', { name: 'Preview', exact: true }).click();
    const buttons = page.getByRole('button', { name: 'Copy code', exact: true });
    await expect(buttons).toHaveCount(2);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      for (const viewport of [{ width: 375, height: 812 }, { width: 1440, height: 900 }, { width: 3840, height: 1080 }]) {
        await page.setViewportSize(viewport);
        if (viewport.width === 375) {
          await expect(page.locator('.pl-scratch-workspace')).toHaveClass(/pl-scratch-is-compact/);
          const index = page.getByRole('complementary', { name: 'Scratch note index' });
          if (await index.isVisible()) await index.locator('[aria-current="page"]').click();
        }
        await expect(buttons.first()).toBeVisible();
        await buttons.first().focus({ timeout: 5000 });
        await page.keyboard.press('Enter');
        await expect(page.locator('.md-code-toolbar [role="status"]').first()).toHaveText('Copied');
        // Browser clipboard reads can require separate permission; paste into
        // the app editor exercises the actual written clipboard instead.
        await page.getByRole('tablist', { name: 'Scratch editor view' }).getByRole('tab', { name: 'Write', exact: true }).click();
        await editor.fill('');
        await editor.focus();
        await page.keyboard.press('Control+V');
        await expect(editor).toHaveValue(code);
        await editor.fill('```html\n' + code + '\n```\n\n```js\nsecond()\n```');
        await page.getByRole('tab', { name: 'Preview', exact: true }).click();
        const overflow = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight > document.documentElement.clientHeight,
          width: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        }));
        expect(overflow).toEqual({ height: false, width: false });
      }
    }
  } finally { await context.close(); }
});
