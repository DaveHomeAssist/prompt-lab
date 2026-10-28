import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const entry = { id: 'library-controls', title: 'Production handoff', original: 'Write a production handoff.', enhanced: 'Write a production handoff.', collection: 'Ops', tags: ['Writing'], metadata: { status: 'active' }, variants: [], notes: '', versions: [] };
async function fixture(width, height, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-library-controls-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] });
  try {
    await context.addInitScript(seed => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('pl2-library', JSON.stringify([seed])); localStorage.setItem('pl2-collections', JSON.stringify(['Ops']));
      localStorage.setItem('pl_telemetry_consent', 'denied'); localStorage.setItem('pl2-telemetry', JSON.stringify({ consent: 'denied' })); sessionStorage.setItem('seeded', 'yes');
    }, entry);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(); await page.setViewportSize({ width, height });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
    if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
    else await page.getByRole('tablist', { name: 'Workspaces' }).getByRole('tab', { name: 'Library', exact: true }).click();
    await run(page);
  } finally { await context.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}
for (const [width, height] of [[375, 812], [812, 375], [1440, 900], [1920, 1080], [3440, 1440]]) {
  test(`Library controls fit ${width}x${height}`, async () => fixture(width, height, async page => {
    await expect(page.getByRole('listitem').filter({ hasText: entry.title })).toBeVisible();
    const toggle = page.getByRole('button', { name: /^(Show|Hide) Library drawer$/ });
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    await page.getByRole('button', { name: 'Show Library drawer' }).click();
    if (width < 720) { await expect(page.getByRole('dialog', { name: 'Library views' })).toBeVisible(); await page.keyboard.press('Escape'); }
    else await page.getByRole('button', { name: 'Hide Library drawer', exact: true }).click();
    for (const view of ['Compact view', 'Gallery view', 'Tile view', 'List view']) { await page.getByRole('button', { name: view }).click(); await expect(page.getByRole('button', { name: view })).toHaveAttribute('aria-pressed', 'true'); }
    // Phones (<=520 px) fold the palette picker into the header's More menu.
    const more = page.getByRole('button', { name: 'More actions', exact: true });
    const paletteScope = await more.isVisible() ? (await more.click(), page.locator('#pl-header-more-panel')) : page.locator('[data-header-actions]');
    for (const palette of ['forest', 'plum', 'ember', 'ocean']) await paletteScope.getByLabel('Color palette').selectOption(palette);
    if (await more.isVisible()) await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'ocean');
    await page.getByRole('button', { name: `Inspect ${entry.title}` }).click();
    if (width > 1100) {
      const separator = page.getByRole('separator', { name: 'Resize prompt inspector' });
      const before = Number(await separator.getAttribute('aria-valuenow')); await separator.focus(); await page.keyboard.press('ArrowLeft');
      await expect(separator).toHaveAttribute('aria-valuenow', String(before + 24));
    }
    const dimensions = await page.evaluate(() => ({ w: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: document.documentElement.scrollHeight - document.documentElement.clientHeight }));
    expect(dimensions).toEqual({ w: 0, h: 0 });
    await page.screenshot({ path: `/tmp/codex-library-01a14cf8/library-${width}.png`, fullPage: false });
  }));
}

test('nested folder identity and artwork survive rename, save and export', async () => fixture(1440, 900, async page => {
  await page.getByRole('button', { name: 'Manage collections' }).click();
  await page.getByLabel('Parent folder').selectOption('legacy:Ops');
  await page.getByLabel('New collection name').fill('Shows');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-collection-folders') || '[]').length)).toBe(2);
  const childId = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-collection-folders')).find(folder => folder.name === 'Shows').id);
  await page.locator('.pl-collection-manage-row').filter({ hasText: 'Ops/Shows' }).getByRole('button', { name: 'Artwork', exact: true }).click();
  await page.locator('.pl-artwork-details > summary').click();
  await page.getByRole('button', { name: 'Collection artwork: Star', exact: true }).click();
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('pl2-collection-folders')).find(folder => folder.id === id).artwork.icon, childId)).toBe('Star');
  await page.locator('.pl-collection-manage-row').filter({ hasText: /^OpsArtwork/ }).getByRole('button', { name: 'Rename / Move' }).click();
  await page.getByLabel('Rename Ops', { exact: true }).fill('Operations');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(id => JSON.parse(localStorage.getItem('pl2-collection-folders')).find(folder => folder.id === id).collection, childId)).toBe('Operations/Shows');
  await page.getByRole('button', { name: 'Inspect Production handoff' }).click();
  await page.locator('.pl-inspector-content .pl-artwork-details > summary').click();
  await page.getByRole('button', { name: 'Prompt artwork: Star', exact: true }).click();
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.artwork.icon)).toBe('Star');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const download = await downloadEvent; const file = await download.path();
  const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(exported.folders.find(folder => folder.id === childId)).toMatchObject({ parentId: 'legacy:Ops', collection: 'Operations/Shows', artwork: { icon: 'Star' } });
  expect(exported.library[0]).toMatchObject({ collection: 'Operations', metadata: { artwork: { icon: 'Star' } } });
}));
