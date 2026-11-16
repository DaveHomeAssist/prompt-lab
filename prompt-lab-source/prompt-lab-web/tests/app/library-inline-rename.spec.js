import { expect, test } from '@playwright/test';

const oldTitle = 'Release checklist';
const card = (page, title = oldTitle) => page.getByRole('button', { name: `Inspect ${title}`, exact: true });
const titleText = (page, title = oldTitle) => card(page, title).getByText(title, { exact: true });
const heading = (page, title = oldTitle) => page.getByRole('heading', { name: title, exact: true });
const input = page => page.getByRole('textbox', { name: 'Rename prompt title' });
const stored = page => page.evaluate(() => localStorage.getItem('pl2-library'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(title => {
    if (sessionStorage.getItem('inline-rename-fixture')) return;
    sessionStorage.setItem('inline-rename-fixture', '1');
    localStorage.setItem('pl2-library', JSON.stringify([{
      id: 'release-checklist', title, original: 'Check the release.', enhanced: 'Check the release.',
      metadata: { purpose: 'Release QA' }, tags: [], versions: [],
    }]));
    localStorage.setItem('pl_telemetry_consent', 'denied');
  }, oldTitle);
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
});

test('renames from the card and inspector and keeps unrelated Details edits', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/#/library');
  await titleText(page).click();
  await expect(heading(page)).toBeVisible();
  const purpose = page.getByRole('textbox', { name: 'Purpose' });
  const detailsTitle = page.getByRole('textbox', { name: 'Title', exact: true });
  await purpose.fill('Unsaved purpose');
  await titleText(page).dblclick();
  await expect(input(page)).toBeFocused();
  expect(await input(page).evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd))).toBe(oldTitle);
  await input(page).fill('  Release review  ');
  await input(page).press('Enter');
  await expect(card(page, 'Release review')).toBeVisible();
  await expect(heading(page, 'Release review')).toBeVisible();
  await expect(detailsTitle).toHaveValue('Release review');
  await expect(purpose).toHaveValue('Unsaved purpose');
  await expect(page.getByRole('button', { name: 'Save details' })).toBeEnabled();

  await heading(page, 'Release review').dblclick();
  await expect(input(page)).toBeFocused();
  await input(page).fill('Final release review');
  await purpose.click();
  await expect(detailsTitle).toHaveValue('Final release review');
  await expect(card(page, 'Final release review')).toBeVisible();
  await expect(heading(page, 'Final release review')).toBeVisible();
  await expect(purpose).toHaveValue('Unsaved purpose');
  await page.reload();
  await card(page, 'Final release review').click();
  await expect(detailsTitle).toHaveValue('Final release review');
  await expect(purpose).toHaveValue('Release QA');
  expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight)).toBe(true);
});

test('keyboard rename, cancellation, invalid and unchanged names, and write failure', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/app/#/library');
  await card(page).focus();
  await expect.poll(async () => JSON.parse(await stored(page))[0].currentVersionId).toBeTruthy();
  const before = await stored(page);
  for (const [value, key] of [['Discard this', 'Escape'], ['   ', 'Enter'], [` ${oldTitle} `, 'Tab']]) {
    await card(page).press('F2');
    await expect(input(page)).toBeFocused();
    await input(page).fill(value);
    await input(page).press(key);
    await expect(input(page)).toHaveCount(0);
    await expect(card(page)).toBeVisible();
    expect(await stored(page)).toBe(before);
  }
  await card(page).press('F2');
  await input(page).fill('Failed rename');
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === 'pl2-library') throw new DOMException('Storage full', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await input(page).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'Could not rename the prompt' })).toBeVisible();
  await expect(card(page)).toBeVisible();
  expect(await stored(page)).toBe(before);
  await page.reload();
  await expect(card(page)).toBeVisible();
});

test('card double-click and inspector Escape work with the phone drawer', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/app/#/library');
  await titleText(page).dblclick();
  await expect(input(page)).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await input(page).fill('Mobile release');
  await input(page).press('Enter');
  await titleText(page, 'Mobile release').click();
  const dialog = page.getByRole('dialog', { name: 'Mobile release' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Rename prompt', exact: true }).press('Enter');
  await expect(input(page)).toBeFocused();
  await input(page).fill('Discard mobile rename');
  await input(page).press('Escape');
  await expect(input(page)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Rename prompt', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth && document.documentElement.scrollHeight === innerHeight)).toBe(true);
});
