// Phones (<=640 px) keep search on the Library toolbar and put status, profile,
// sort, and view behind Filters, and Export, Packs, and Import behind ….
async function visible(locator) {
  return locator.isVisible().catch(() => false);
}

export async function closeLibraryFilters(page) {
  const sheet = page.getByRole('dialog', { name: 'Library filters' });
  if (await visible(sheet)) await sheet.getByRole('button', { name: 'Done', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' }).catch(() => {});
}

export async function showLibraryFilters(page) {
  const status = page.getByRole('combobox', { name: 'Filter by status', exact: true });
  if (await visible(status)) return page.locator('.pl-library-toolbar');
  const filters = page.getByRole('button', { name: 'Filters', exact: true });
  if (!(await visible(filters))) return page.locator('.pl-library-toolbar');
  const sheet = page.getByRole('dialog', { name: 'Library filters' });
  if (!(await visible(sheet))) await filters.click();
  await status.waitFor({ state: 'visible' });
  return sheet;
}

export async function libraryViewButton(page, name) {
  const direct = page.getByRole('button', { name, exact: true });
  if (await visible(direct)) return direct;
  const sheet = await showLibraryFilters(page);
  return sheet.getByRole('button', { name, exact: true });
}

export async function libraryAction(page, name) {
  const direct = page.getByRole('button', { name, exact: true });
  if (await visible(direct)) return direct;
  const menu = page.getByRole('group', { name: 'Library actions' });
  if (!(await visible(menu))) await page.getByRole('button', { name: 'Library actions', exact: true }).click();
  return menu.getByRole('button', { name, exact: true });
}
