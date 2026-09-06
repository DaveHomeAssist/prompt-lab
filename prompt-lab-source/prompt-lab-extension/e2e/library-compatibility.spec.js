import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const extensionPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const surfaces = [{ name: 'extension', url: null }];
if (process.env.PL_COMPAT_WEB_URL) surfaces.push({ name: 'local-web', url: process.env.PL_COMPAT_WEB_URL });
if (process.env.PL_COMPAT_DESKTOP_URL) surfaces.push({ name: 'desktop-frontend', url: process.env.PL_COMPAT_DESKTOP_URL });

async function openView(page, name, width) {
  if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name, exact: true }).click();
  else await page.getByRole('tablist', { name: 'Create views' }).getByRole('tab', { name, exact: true }).click();
}

for (const surface of surfaces) for (const width of [400, 1180]) {
  test(`${surface.name} Library compatibility at ${width}px`, async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-compatibility-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: surface.url ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try {
      let url = surface.url;
      if (!url) {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.setViewportSize({ width, height: 1000 });
      await page.route('**/api/proxy', route => route.abort());
      await page.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active', productName: 'Prompt Lab Pro' }));
        if (!localStorage.getItem('compatibility-seeded')) {
          const prompt = (id, title, collection, metadata = {}) => ({ id, title, collection, original: `${title} instructions`, enhanced: `${title} improved`, tags: ['verification'], currentVersionId: `${id}-v1`, createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z', metadata });
          localStorage.setItem('pl2-library', JSON.stringify([
            prompt('alpha', 'Alpha prompt', 'Ops', { owner: 'Avery', purpose: 'Navigation' }),
            prompt('hidden', 'Hidden prompt', 'Other'),
            prompt('beta', 'Beta starter', 'Ops', { packLoadedAt: '2026-09-05T00:00:00Z' }),
            prompt('child', 'Follow-up child', '', { followUpOrigin: { sourceKind: 'enhanced-prompt', sourcePromptId: 'alpha', sourcePromptVersionId: 'alpha-v1', generationModel: 'fixture-model' } }),
          ]));
          localStorage.setItem('pl2-collections', JSON.stringify(['Ops', 'Other']));
          localStorage.setItem('compatibility-seeded', 'true');
        }
      });
      await page.goto(url);
      await openView(page, 'Library', width);
      if (width < 720) {
        const labelsFit = await page.getByRole('navigation', { name: 'Smart views' }).evaluate(nav =>
          [...nav.querySelectorAll('button')].every(button => {
            const text = document.createRange();
            text.selectNodeContents(button.querySelector('span'));
            const label = text.getBoundingClientRect();
            const count = button.querySelector('small').getBoundingClientRect();
            const bounds = button.getBoundingClientRect();
            return label.left >= bounds.left && label.right <= count.left && count.right <= bounds.right;
          }));
        expect(labelsFit, 'smart-view labels and counts must fit without overlapping').toBe(true);
      }
      const list = page.getByRole('list', { name: 'Saved prompts' });
      await expect(list.getByRole('listitem').first()).toContainText('Beta starter');
      await page.getByTestId('library-search').fill('avery navigation');
      await expect(list.getByRole('listitem')).toHaveCount(1);
      await expect(list).toContainText('Alpha prompt');
      await openView(page, 'Compose', width);
      if (width < 720) await page.getByRole('tablist', { name: 'Composer views' }).getByRole('tab', { name: /Library/ }).click();
      await page.getByRole('textbox', { name: 'Filter composer library' }).fill('avery navigation');
      await expect(page.getByText('Alpha prompt', { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText('Beta starter', { exact: true })).toHaveCount(0);
      await openView(page, 'Library', width);
      await page.getByTestId('library-search').fill('');
      await page.getByRole('button', { name: /^Ops\s*2$/ }).click();
      await page.getByRole('combobox', { name: /Sort/ }).selectOption('manual');
      await expect(list.getByRole('listitem')).toHaveCount(2);
      const move = page.getByRole('button', { name: 'Move Beta starter up' });
      await move.focus();
      await move.press('Enter');
      await expect(list.getByRole('listitem').first()).toContainText('Beta starter');
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).map(row => row.id))).toEqual(['beta', 'alpha', 'hidden', 'child']);
      await page.getByRole('button', { name: 'Manage collections' }).click();
      await page.getByRole('button', { name: 'Delete collection Ops' }).click();
      await expect(list.getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('button', { name: /^All prompts/ })).toHaveAttribute('aria-current', 'page');
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library')).filter(row => row.collection === 'Ops').length)).toBe(0);
      await page.getByRole('button', { name: 'Inspect Follow-up child' }).click();
      const provenance = page.getByRole('region', { name: 'Follow-up provenance' });
      await expect(provenance).toContainText('fixture-model');
      await provenance.getByRole('button', { name: 'View source output' }).click();
      await expect(provenance).toContainText('Alpha prompt improved');
      await provenance.getByRole('button', { name: 'Open parent prompt' }).click();
      await expect(page.getByRole('region', { name: 'Follow-up prompts' })).toContainText('Follow-up child');
      await page.getByRole('button', { name: 'Close prompt inspector' }).click();
      await page.reload();
      await openView(page, 'Library', width);
      await expect(list.getByRole('listitem').first()).toContainText('Beta starter');
      await expect(page.getByRole('button', { name: /^Ops\d+$/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
