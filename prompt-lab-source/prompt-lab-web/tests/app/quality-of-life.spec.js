import { expect, test } from '@playwright/test';
import { switchTheme } from './theme-toggle.js';

const entries = [
  { id: 'saved', title: 'Saved draft', original: 'Original saved text', collection: 'Creative', tags: ['Writing'], metadata: { status: 'active' }, currentVersionId: 'v1' },
  { id: 'block', title: 'Assembly block', original: 'Block payload', collection: 'Code', tags: ['Code'], metadata: { status: 'draft' }, currentVersionId: 'v2' },
];
async function prepare(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(data => {
    if (sessionStorage.getItem('__qol_seed')) return;
    sessionStorage.setItem('__qol_seed', '1');
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-library', JSON.stringify(data));
    localStorage.setItem('pl2-collections', JSON.stringify(['Creative', 'Code']));
    localStorage.setItem('pl2-session-pl2-session', JSON.stringify({ raw: 'Current unsaved changes', enhanced: '', variants: [], notes: '', resultMeta: null, tab: 'editor', editingId: 'saved', editingVersionId: 'v1', saveTitle: 'Saved draft' }));
  }, entries);
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/app/');
  await expect(page.getByTestId('prompt-input')).toHaveValue('Current unsaved changes');
}
async function navigate(page, name) {
  const mobile = page.getByRole('navigation', { name: 'Primary mobile navigation' });
  if (await mobile.isVisible()) await mobile.getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab', { name, exact: true }).click();
}
async function addBlock(page) {
  const libraryTab = page.getByRole('tab', { name: /^Library \(/ });
  if (await libraryTab.isVisible()) await libraryTab.click();
  await page.getByRole('textbox', { name: 'Filter composer library' }).fill('Assembly block');
  await page.getByRole('button', { name: /^Add (Starter|Block)$/ }).click();
  const canvasTab = page.getByRole('tab', { name: /^Canvas \(/ });
  if (await canvasTab.isVisible()) await canvasTab.click();
}
const session = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-session-pl2-session') || '{}'));
for (const width of [375, 1440]) {
  test(`Library filters survive workspace navigation at ${width}`, async ({ page }) => {
    await prepare(page, width); await navigate(page, 'Library');
    const drawer = page.getByRole('button', { name: 'Show Library drawer', exact: true }); if (await drawer.isVisible()) await drawer.click();
    await page.getByRole('button', { name: '#Writing', exact: true }).click();
    await page.getByLabel('Filter by status', { exact: true }).selectOption('active');
    await navigate(page, 'Write'); await navigate(page, 'Library');
    await expect(page.getByRole('button', { name: 'Inspect Saved draft' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Inspect Assembly block' })).toHaveCount(0);
    await expect(page.getByLabel('Filter by status', { exact: true })).toHaveValue('active');
    await expect(page.getByText('Tag: Writing', { exact: true })).toBeVisible();
  });
  test(`Composer new draft and Clear have safe undo at ${width}`, async ({ page }) => {
    await prepare(page, width); await navigate(page, 'Compose'); await addBlock(page);
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo Clear', exact: true })).toBeVisible();
    await addBlock(page);
    await page.getByRole('button', { name: 'Undo Clear', exact: true }).click();
    await expect(page.getByText('Canvas (2 blocks)', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open as new draft', exact: true }).click();
    await expect(page.getByTestId('prompt-input')).toHaveValue(/Block payload/);
    await expect.poll(async () => (await session(page)).editingId).toBeNull();
    await page.getByRole('button', { name: 'Restore previous draft', exact: true }).click();
    await navigate(page, 'Write');
    await expect(page.getByTestId('prompt-input')).toHaveValue('Current unsaved changes');
    await expect.poll(async () => (await session(page)).editingId).toBe('saved');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).find(row => row.id === 'saved'));
    expect(saved.original).toBe('Original saved text');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.documentElement.scrollHeight <= document.documentElement.clientHeight)).toBe(true);
    await switchTheme(page, 'dark');
    await page.screenshot({ path: test.info().outputPath(`qol-restored-${width}.png`) });
  });
}
