import { expect, test } from '@playwright/test';

// L-1: mobile copyText fired navigator.clipboard.writeText and reported
// "Copied" before the browser accepted the write -- a rejected write (blocked
// permission, unfocused page) or a missing clipboard API still showed success.
// These journeys walk the Library detail Copy action under each clipboard
// outcome and require the toast to tell the truth.

async function openLibraryCopySurface(page) {
  await page.goto('/mobile/');
  await page.getByPlaceholder('Search prompts, tags, text').fill('bug');
  await page.getByRole('heading', { name: 'Bug repro extractor', exact: true }).click();
  return page.getByRole('button', { name: 'Copy', exact: true });
}

test('reports success only after the clipboard accepts the write', async ({ page }) => {
  await page.addInitScript(() => {
    window.__clipboardWrites = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value) => new Promise((resolve) => {
          // Resolve on a later tick so a premature toast can beat it.
          setTimeout(() => {
            window.__clipboardWrites.push(value);
            resolve();
          }, 50);
        }),
      },
    });
  });

  const copyButton = await openLibraryCopySurface(page);
  await copyButton.click();

  await expect(page.locator('.toast')).toHaveText('Copied');
  await expect.poll(() => page.evaluate(() => window.__clipboardWrites.length)).toBe(1);
});

test('reports failure when the browser rejects the clipboard write', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')),
      },
    });
  });

  const copyButton = await openLibraryCopySurface(page);
  await copyButton.click();

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  await expect(toast).not.toHaveText('Copied');
  await expect(toast).toContainText(/copy failed/i);
});

test('reports failure when no clipboard API exists', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
  });

  const copyButton = await openLibraryCopySurface(page);
  await copyButton.click();

  const toast = page.locator('.toast');
  await expect(toast).toBeVisible();
  await expect(toast).not.toHaveText('Copied');
  await expect(toast).toContainText(/copy failed/i);
});
