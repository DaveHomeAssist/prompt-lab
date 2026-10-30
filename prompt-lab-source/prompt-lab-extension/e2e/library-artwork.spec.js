import { switchTheme } from '../../prompt-lab-web/tests/app/theme-toggle.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const entry = { id: 'library-controls', title: 'Production handoff', original: 'Write a production handoff.', enhanced: 'Write a production handoff.', collection: 'Ops', tags: ['Writing'], metadata: { status: 'active', owner: 'Stored owner', purpose: 'Keep prompt metadata' }, variants: [], notes: '', versions: [] };
async function fixture(width, height, run) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pl-artwork-'));
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

for (const [width, height] of [[375, 812], [844, 390], [1440, 900], [3840, 1080], [320, 256]]) {
  for (const theme of ['light', 'dark']) {
    test(`Artwork picker ${width}x${height} ${theme}`, async () => fixture(width, height, async page => {
      if (await page.locator('.pl-app-shell').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
      await expect(page.locator('.pl-app-shell')).toHaveAttribute('data-theme', theme);
      for (const view of ['List view', 'Tile view', 'Compact view', 'Gallery view']) {
        await page.getByRole('button', { name: view }).click();
        const trigger = page.getByRole('button', { name: `Change artwork for ${entry.title}` });
        await trigger.focus(); await page.keyboard.press('Enter');
        const picker = page.getByRole('dialog', { name: `Artwork for ${entry.title}` });
        await expect(picker).toBeVisible();
        await picker.getByLabel('Prompt artwork emoji').fill('👩🏽‍💻');
        await picker.getByRole('button', { name: 'Apply', exact: true }).click();
        await expect(picker).not.toBeVisible(); await expect(trigger).toBeFocused();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.artwork.emoji)).toBe('👩🏽‍💻');
        await trigger.click();
        await picker.getByRole('button', { name: 'Prompt artwork: Clock', exact: true }).click();
        await page.keyboard.press('Escape'); await expect(picker).not.toBeVisible(); await expect(trigger).toBeFocused();
        const dimensions = await page.evaluate(() => ({ w: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: document.documentElement.scrollHeight - document.documentElement.clientHeight }));
        expect(dimensions).toEqual({ w: 0, h: 0 });
      }
      await page.reload();
      await expect(page.locator('.pl-library-card-artwork')).toContainText('👩🏽‍💻');
      await page.getByRole('button', { name: `Change artwork for ${entry.title}` }).click();
      const picker = page.getByRole('dialog', { name: `Artwork for ${entry.title}` });
      const box = await picker.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.y + box.height).toBeLessThanOrEqual(height);
      await picker.getByRole('button', { name: 'Clear artwork', exact: true }).click();
      await picker.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.getByRole('button', { name: 'Gallery view' }).click();
      await page.getByRole('button', { name: `Add image for ${entry.title}` }).click();
      await expect(picker).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`artwork-${width}-${theme}.png`) });
      await page.keyboard.press('Escape');
    }));
  }
}

test('artwork image limits, failed Apply retry, inspector preservation and export', async () => fixture(1440, 900, async page => {
  const originalOwner = await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.owner);
  await page.getByRole('button', { name: `Inspect ${entry.title}` }).click();
  await page.getByLabel('Owner', { exact: true }).fill('Pending owner');
  await page.getByRole('button', { name: `Change artwork for ${entry.title}` }).click();
  const picker = page.getByRole('dialog', { name: `Artwork for ${entry.title}` });
  const upload = picker.getByLabel('Prompt artwork image');
  await upload.setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(picker.getByRole('alert')).toContainText('up to 64 KB');
  await upload.setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(65537) });
  await expect(picker.getByRole('alert')).toContainText('up to 64 KB');
  await upload.setInputFiles({ name: 'damaged.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(picker.getByRole('alert')).toContainText('could not be read');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.artwork?.image || '')).toBe('');
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAQklEQVR4nGP4v08DK5LLu4MVkaqeYdSCUQuGgAXUMgiX+lELRi0YChZQyyBc6kctGLVgKFhALYNwqR+1YNSCIWABADaYmluVENWtAAAAAElFTkSuQmCC', 'base64');
  await upload.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: pixel });
  await expect(picker.locator('img')).toBeVisible();
  await page.evaluate(() => {
    window.artworkOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'pl2-library') throw new Error('Synthetic quota failure'); return window.artworkOriginalSetItem.call(this, key, value); };
  });
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(picker.getByRole('alert')).toContainText('not saved');
  await page.evaluate(() => { Storage.prototype.setItem = window.artworkOriginalSetItem; });
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(picker).not.toBeVisible();
  await expect(page.getByLabel('Owner', { exact: true })).toHaveValue('Pending owner');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.owner)).toBe(originalOwner);
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))[0].metadata.owner)).toBe('Pending owner');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exported = JSON.parse(fs.readFileSync(await (await downloadEvent).path(), 'utf8'));
  expect(exported.library[0].metadata.artwork.image).toBe(`data:image/png;base64,${pixel.toString('base64')}`);
  await page.reload(); await expect(page.locator('.pl-library-card-artwork img')).toBeVisible();
}));
