import { expect, test } from '@playwright/test';

const TITLE = 'Split save regression';
const OLD = 'Previously saved output';
const NEW = 'Current draft text must become the saved Library output.';
const readLibrary = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));

async function prepare(page, existing) {
  await page.addInitScript(({ existing, title, old }) => {
    if (sessionStorage.getItem('__splitSaveFixture')) return;
    sessionStorage.setItem('__splitSaveFixture', '1');
    localStorage.setItem('pl_telemetry_consent', 'denied');
    localStorage.setItem('pl2-library', JSON.stringify(existing ? [{
      id: 'split-save-fixture', title, original: old, enhanced: old,
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] : []));
    localStorage.setItem('pl2-session-pl2-session', JSON.stringify({
      raw: old, enhanced: old, variants: [], tab: 'editor', saveTitle: title,
      editingId: existing ? 'split-save-fixture' : null,
    }));
  }, { existing, title: TITLE, old: OLD });
  await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }));
  await page.goto('/app/#/split');
  if (page.viewportSize().width < 720) {
    await page.getByRole('tablist', { name: 'Dual pane mobile view' }).getByRole('tab', { name: 'Write', exact: true }).click();
  }
  await expect(page.getByLabel('Dual pane prompt editor')).toHaveValue(OLD);
}

for (const [width, trigger] of [[1440, 'Control+s'], [1440, 'Meta+s'], [375, 'Control+s'], [1440, 'palette']]) {
  for (const existing of [true, false]) {
    test(`split ${trigger} saves the current ${existing ? 'version' : 'new prompt'} at ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await prepare(page, existing);
      if (existing) await expect.poll(async () => Array.isArray((await readLibrary(page))[0]?.versions)).toBe(true);
      const before = await readLibrary(page);
      const editor = page.getByLabel('Dual pane prompt editor');
      await editor.fill(NEW);
      await expect(page.locator('.pl-dual-autosave-status')).toHaveText('Draft saved');
      expect(await readLibrary(page), 'draft autosave must not claim a Library update').toEqual(before);

      if (trigger === 'palette') {
        await page.keyboard.press('Control+k');
        await page.getByLabel('Search commands').fill(existing ? 'Save new version' : 'Save as new prompt');
        await page.getByRole('dialog').getByRole('button', { name: /Save (new version|as new prompt)/ }).click();
      } else {
        await editor.press(trigger);
      }

      await expect.poll(async () => (await readLibrary(page))[0]?.enhanced).toBe(NEW);
      const saved = (await readLibrary(page))[0];
      expect(await readLibrary(page)).toHaveLength(1);
      expect(saved.original).toBe(NEW);
      expect(saved.title).toBe(TITLE);
      if (existing) {
        expect(saved.id).toBe('split-save-fixture');
        expect(saved.versions).toHaveLength(before[0].versions.length + 1);
      }
      await page.screenshot({ path: testInfo.outputPath('draft-saved.png') });
      await page.goto('/app/#/library');
      await page.reload();
      await page.getByTestId('library-search').fill(TITLE);
      await expect(page.locator('.pl-library-card').filter({ hasText: TITLE })).toContainText(NEW);
      expect((await readLibrary(page))[0]).toMatchObject({ id: saved.id, original: NEW, enhanced: NEW });
      expect(await page.evaluate(() => ({
        height: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
        width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      }))).toEqual({ height: true, width: true });
    });
  }
}
