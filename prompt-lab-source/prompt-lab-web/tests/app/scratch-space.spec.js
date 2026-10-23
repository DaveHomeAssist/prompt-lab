import { expect, test } from '@playwright/test';

const note = '# Active note\n\nA synthetic note for screen-space acceptance.\n\n' + 'Long note content.\n'.repeat(80);
const readPads = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-pads')));

async function openScratch(page) {
  await page.addInitScript(({ note }) => {
    if (localStorage.getItem('__scratchSpace')) return;
    localStorage.setItem('__scratchSpace', '1');
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-pads-schema-version', '4');
    localStorage.setItem('pl2-pads', JSON.stringify({ revision: 1, activePadId: 'active', pads: [
      { id: 'active', name: 'Active note with a long descriptive title', content: note, timestamp: Date.now(), updatedAt: Date.now() },
      { id: 'other', name: 'Other note', content: 'Preserve this other note.', timestamp: Date.now() },
    ] }));
  }, { note });
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/app/#/scratch');
  const index = page.getByRole('complementary', { name: 'Scratch note index' });
  if (await page.getByRole('textbox', { name: 'Scratchpad' }).isHidden()) await index.getByRole('button', { name: /Active note/ }).click();
  await expect(page.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(note);
}

for (const size of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 768, height: 900 }, { width: 844, height: 390 }, { width: 320, height: 256 }, { width: 3840, height: 1080 }]) {
  test(`Scratch fills the pane and focuses without losing edits at ${size.width}x${size.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    await openScratch(page);
    const editor = page.getByRole('textbox', { name: 'Scratchpad' });
    const before = await editor.boundingBox();
    await page.getByRole('button', { name: 'Focus note', exact: true }).click();
    const exit = page.getByRole('button', { name: 'Exit focus', exact: true });
    await expect(exit).toHaveAttribute('aria-pressed', 'true');
    const after = await editor.boundingBox();
    expect(after.width * after.height).toBeGreaterThan(before.width * before.height);
    expect(after.height).toBeGreaterThanOrEqual(size.height <= 256 ? 48 : 80);
    if (size.width === 1440) {
      await page.setViewportSize({ width: 375, height: 812 });
      await expect(editor).toBeVisible();
      await expect(exit).toBeVisible();
      await exit.click();
      await expect(editor).toBeVisible();
      await page.getByRole('button', { name: 'Focus note', exact: true }).click();
      await page.setViewportSize(size);
      await expect(editor).toBeVisible();
      await expect(exit).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(page.getByRole('complementary', { name: 'Scratch note index' })).toBeHidden();
    await expect(page.getByRole('toolbar', { name: 'Markdown formatting toolbar' })).toBeHidden();
    await editor.fill(note + '\nA saved focus edit.');
    await expect.poll(async () => (await readPads(page)).pads.find(p => p.id === 'active').content).toContain('A saved focus edit.');
    await expect(page.getByText(/^(Saved|Last saved)/).last()).toBeVisible();
    if (size.width === 320 || size.width === 375 || size.width === 1440) {
      await page.evaluate(() => {
        window.__scratchOriginalSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
          if (key === 'pl2-pads') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
          return window.__scratchOriginalSet.call(this, key, value);
        };
      });
      await editor.fill(note + '\nA saved focus edit.\nRecover this draft.');
      await expect(page.getByText('Save failed — draft kept.', { exact: true })).toBeVisible();
      const retry = page.getByRole('button', { name: 'Retry saving', exact: true });
      expect(await retry.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      await page.evaluate(() => { Storage.prototype.setItem = window.__scratchOriginalSet; });
      await retry.click();
      await expect.poll(async () => (await readPads(page)).pads.find(p => p.id === 'active').content).toContain('Recover this draft.');
      await expect(page.getByText('Save failed — draft kept.', { exact: true })).toBeHidden();
      await editor.fill(note + '\nA saved focus edit.');
      await expect.poll(async () => (await readPads(page)).pads.find(p => p.id === 'active').content).not.toContain('Recover this draft.');
    }
    for (let theme = 0; theme < 2; theme += 1) {
      expect(await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= innerWidth, height: document.documentElement.scrollHeight <= innerHeight }))).toEqual({ width: true, height: true });
      for (const target of [editor, exit, page.getByRole('button', { name: 'Back to scratch notes' })]) {
        expect(await target.evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`focus-${size.width}-${theme}.png`) });
      await page.getByRole('button', { name: /Switch to (dark|light) mode/ }).click();
    }
    await exit.click();
    await expect(editor).toHaveValue(note + '\nA saved focus edit.');
    if (size.height > 390) {
      await page.getByRole('tablist', { name: 'Scratch editor view' }).getByRole('tab', { name: 'Split', exact: true }).click();
      await expect(page.getByLabel('Live Markdown preview')).toContainText('A saved focus edit.');
      await page.getByRole('button', { name: 'Focus note', exact: true }).click();
      expect((await editor.boundingBox()).height).toBeGreaterThan(80);
    } else await page.getByRole('button', { name: 'Focus note', exact: true }).click();
    await page.getByRole('button', { name: 'Back to scratch notes' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search scratch notes' })).toBeFocused();
    await page.getByRole('complementary', { name: 'Scratch note index' }).getByRole('button', { name: /Other note/ }).click();
    await expect(editor).toHaveValue('Preserve this other note.');
    await page.reload();
    const index = page.getByRole('complementary', { name: 'Scratch note index' });
    if (await editor.isHidden()) await index.getByRole('button', { name: /Other note/ }).click();
    await expect(editor).toHaveValue('Preserve this other note.');
    expect((await readPads(page)).pads.find(p => p.id === 'active').content).toContain('A saved focus edit.');
  });
}
