import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { switchTheme } from './theme-toggle.js';

for (const layout of ['stacked', 'split']) for (const theme of ['light', 'dark']) {
  test(`cancelled ${layout} Create results remain keyboard reachable in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize(layout === 'stacked' ? { width: 1440, height: 900 } : { width: 812, height: 375 });
    await page.addInitScript(layout => {
      localStorage.setItem('pl2-create-layout', JSON.stringify(layout));
      localStorage.setItem('pl_telemetry_consent', 'denied');
    }, layout);
    await page.route('**/api/**', route => route.fulfill({ status: 503, body: '{}' }));
    await page.goto('/app/');
    const input = page.getByTestId('prompt-input');
    await expect(input).toBeVisible();
    if (theme === 'dark') await switchTheme(page, 'dark');
    await page.evaluate(() => {
      const original = window.fetch;
      let once = true;
      window.__acceptanceAborted = false;
      window.fetch = (input, init = {}) => {
        if (once && new URL(typeof input === 'string' ? input : input.url, location.href).pathname === '/api/proxy') {
          once = false;
          return Promise.resolve(new Response(new ReadableStream({ start(controller) {
            const chunk = { type: 'content_block_delta', delta: { text: 'Synthetic pending output.' } };
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
            init.signal.addEventListener('abort', () => {
              window.__acceptanceAborted = true;
              controller.error(new DOMException('Cancelled', 'AbortError'));
            }, { once: true });
          } }), { headers: { 'Content-Type': 'text/event-stream' } }));
        }
        return original(input, init);
      };
    });
    await input.fill('Write a synthetic release checklist with owners and measurable outcomes.');
    await page.getByTestId('refine-action').press('Enter');
    await expect(page.getByText('Synthetic pending output.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().press('Enter');
    await expect.poll(() => page.evaluate(() => window.__acceptanceAborted)).toBe(true);
    await expect(page.getByText('Generation cancelled.', { exact: true })).toBeVisible();

    // With no candidates, the results scroller has no interactive descendants.
    // Its cancellation notice must still be reachable using the keyboard.
    const results = page.getByRole('region', { name: layout === 'stacked' ? 'Enhancement results' : 'Enhanced result', exact: true });
    await expect(results).toHaveAttribute('tabindex', '0');
    const anchor = layout === 'stacked'
      ? page.getByRole('button', { name: 'Reset Draft', exact: true })
      : page.getByRole('group', { name: 'Workspace pane' }).getByRole('button', { name: 'Result', exact: true });
    await anchor.focus();
    for (let step = 0; step < 6 && !(await results.evaluate(el => el === document.activeElement)); step++) {
      await page.keyboard.press('Tab');
    }
    await expect(results).toBeFocused();
    expect(await results.evaluate(el => {
      const style = getComputedStyle(el);
      return el.matches(':focus-visible') && (style.boxShadow !== 'none' || style.outlineStyle === 'solid');
    })).toBe(true);
    const audit = await new AxeBuilder({ page }).include('[aria-label="Prompt editor workspace"]')
      .withRules(['scrollable-region-focusable']).analyze();
    expect(audit.violations).toEqual([]);
    await expect(input).toHaveValue('Write a synthetic release checklist with owners and measurable outcomes.');
  });
}
