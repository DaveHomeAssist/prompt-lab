// Theme, palette, shortcuts, and Report live in the header More menu at every
// width. Use the bar control when it is visible, otherwise the menu item.
// mode: 'dark' | 'light' switches to that mode; omitted toggles.
export async function switchTheme(page, mode) {
  const toggle = mode
    ? page.getByRole('button', { name: `Switch to ${mode} mode`, exact: true })
    : page.getByRole('button', { name: /^Switch to (dark|light) mode$/ });
  if (await toggle.isVisible()) return toggle.click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  const panel = page.locator('#pl-header-more-panel');
  const item = mode
    ? panel.getByRole('button', { name: `${mode === 'dark' ? 'Dark' : 'Light'} mode`, exact: true })
    : panel.getByRole('button', { name: /^(Dark|Light) mode$/ });
  return item.click();
}

// The palette picker lives in the same More menu.
export async function paletteControl(page) {
  const panel = page.locator('#pl-header-more-panel');
  const open = panel.getByLabel('Color palette', { exact: true });
  if (await open.isVisible().catch(() => false)) return open;
  const header = page.locator('[data-header-actions]').getByLabel('Color palette', { exact: true });
  if (await header.first().isVisible().catch(() => false)) return header.first();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  return panel.getByLabel('Color palette', { exact: true });
}

export async function selectPalette(page, palette) {
  const header = page.locator('[data-header-actions]').getByLabel('Color palette', { exact: true });
  if (await header.first().isVisible()) return header.first().selectOption(palette);
  const panel = page.locator('#pl-header-more-panel');
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await panel.getByLabel('Color palette', { exact: true }).selectOption(palette);
  return page.keyboard.press('Escape');
}
