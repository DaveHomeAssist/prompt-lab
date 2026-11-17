import { expect, test } from '@playwright/test';

const INSTRUCTIONS = 'Use field-note terms and do not invent a location.';

test('picking a project profile shows the preamble in the send preview and leaves the prompt text alone', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pl_telemetry_consent', 'denied');
  });
  await page.route('**/api/**', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/app/');

  await page.getByTestId('project-profile-chip').click();
  await page.getByRole('button', { name: 'Manage profiles' }).click();
  const dialog = page.getByRole('dialog', { name: 'Project profiles' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Profile name').fill('Field notes');
  await page.getByLabel('Instructions').fill(INSTRUCTIONS);
  await expect(dialog.getByText(/about \d+ tokens/)).toBeVisible();
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(dialog.getByRole('status')).toContainText('Saved Field notes.');
  await page.getByRole('button', { name: 'Close project profiles' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByTestId('project-profile-chip')).toContainText('Field notes');
  await page.getByTestId('project-profile-chip').click();
  await page.getByRole('button', { name: 'Preview what gets sent' }).click();
  const preview = page.getByTestId('project-profile-preview');
  await expect(preview).toContainText(INSTRUCTIONS);
  await expect(preview).toContainText('Your prompt text is not changed');

  await page.getByTestId('prompt-input').fill('Describe the migration.');
  await expect(page.getByTestId('prompt-input')).toHaveValue('Describe the migration.');
  await expect(page.getByTestId('prompt-input')).not.toHaveValue(/field-note/);

  await page.getByLabel('Profile off for this run').check();
  await expect(preview).toContainText('No project profile will be added');

  await expectContrast(page.getByTestId('project-profile-chip'));
  await expectContrast(preview);
  await page.getByRole('button', { name: /Switch to (light|dark) mode/ }).click();
  await expectContrast(page.getByTestId('project-profile-chip'));
  await expectContrast(preview);

  await page.setViewportSize({ width: 390, height: 720 });
  await expect(page.getByTestId('project-profile-chip')).toBeInViewport();
  await expect(preview).toBeInViewport();
});

async function expectContrast(locator) {
  const ratio = await locator.evaluate((node) => {
    const rgb = (color) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = '#000';
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const luminance = (parts) => {
      const values = parts.map((part) => {
        const value = part / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const probe = document.createElement('span');
    probe.textContent = 'Ag';
    node.append(probe);
    const foreground = getComputedStyle(probe).color;
    probe.remove();
    let element = node;
    let background = 'rgba(0, 0, 0, 0)';
    while (element && /,\s*0\)$/.test(background)) {
      background = getComputedStyle(element).backgroundColor;
      element = element.parentElement;
    }
    const lighter = Math.max(luminance(rgb(foreground)), luminance(rgb(background)));
    const darker = Math.min(luminance(rgb(foreground)), luminance(rgb(background)));
    return (lighter + 0.05) / (darker + 0.05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}
