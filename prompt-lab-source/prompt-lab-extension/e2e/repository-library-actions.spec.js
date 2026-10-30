import { test, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createCommandService } from '../../library-storage/contract.mjs';
import { createFolderAdapter } from '../../library-storage/folder-adapter.mjs';
import { createLocalApi } from '../../library-storage/local-api.mjs';
import { captureSourceInventory } from '../../library-storage/source-inventory.mjs';

let vite, origin;
test.use(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL }
  : process.env.CHROME_BIN ? { launchOptions: { executablePath: process.env.CHROME_BIN } } : { channel: 'chromium' });
test.beforeAll(async () => {
  vite = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await vite.listen(); origin = vite.resolvedUrls.local[0].replace(/\/$/, '');
});
test.afterAll(() => vite?.close());

for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }, { width: 2560, height: 720 }]) {
  test(`connected Library confirms saves and retries offline actions at ${viewport.width}px`, async ({ page }) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-library-ui-'));
    const adapter = await createFolderAdapter(resolve(directory, 'library')), service = createCommandService(adapter);
    const workspace = { library: [{ id: 'shared', title: 'Shared prompt', original: 'Preserve this prompt', favorite: false,
      versions: Array.from({ length: 35 }, (_, i) => ({ id: `v${i}`, original: `History ${i}` })), future: { keep: true } }], folders: [], collections: [] };
    const values = { 'pl2-library': JSON.stringify(workspace.library) };
    const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'browser-fixture',
      localStorage: { length: 1, key: () => 'pl2-library', getItem: key => values[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
    const receipt = await service.apply({ ...await service.preview({ libraryId: 'fixture', expectedRevision: null, mode: 'import',
      sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
    await service.apply({ ...await service.previewCurrentView({ libraryId: 'fixture', expectedRevision: receipt.revision }), idempotencyKey: 'select' });
    const token = 'synthetic-disposable-library-credential'.repeat(2);
    const api = createLocalApi({ adapter, libraryId: 'fixture', allowedOrigins: [origin], credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 }] });
    try {
      const options = { baseUrl: await api.listen(), token, libraryId: 'fixture', sourceBinding: receipt.sourceBinding };
      await page.setViewportSize(viewport);
      await page.addInitScript(options => {
        window.fixtureOptions = options;
        localStorage.setItem('pl2-library', '[{"id":"personal-source","original":"Untouched"}]');
      }, options);
      await page.goto(`${origin}/e2e/fixtures/repository-library.html`);
      await expect(page.getByRole('button', { name: 'Favorite Shared prompt', exact: true })).toBeVisible();
      await page.evaluate(() => window.holdSave());
      await page.getByRole('button', { name: 'Favorite Shared prompt', exact: true }).click();
      await expect(page.getByText('Saving to the selected Library…')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Favorite Shared prompt', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await page.evaluate(() => window.releaseSave());
      await expect(page.getByRole('button', { name: 'Unfavorite Shared prompt', exact: true })).toBeVisible();
      await page.context().setOffline(true);
      await page.getByRole('button', { name: 'Unfavorite Shared prompt', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry pending changes' })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`offline-${viewport.width}.png`) });
      await page.locator('main').evaluate(node => node.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: test.info().outputPath(`offline-dark-${viewport.width}.png`) });
      const fits = await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight <= document.documentElement.clientHeight }));
      expect(fits).toEqual({ width: true, height: true });
      await page.context().setOffline(false);
      await page.getByRole('button', { name: 'Retry pending changes' }).click();
      await expect(page.getByRole('button', { name: 'Favorite Shared prompt', exact: true })).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByRole('button', { name: 'Retry pending changes' })).toHaveCount(0);
      const saved = await page.evaluate(async () => ({ row: await repository.readRecord('prompts', 'shared'), original: localStorage.getItem('pl2-library') }));
      expect(saved.row.versions).toHaveLength(37); expect(saved.row.future).toEqual({ keep: true });
      expect(saved.original).toBe('[{"id":"personal-source","original":"Untouched"}]');
      expect(Object.keys((await adapter.read()).operations)).toHaveLength(4);

      const openDrawer = async () => {
        if (!await page.getByRole('button', { name: 'Manage collections' }).isVisible()) await page.getByRole('button', { name: 'Show Library drawer' }).click();
      };
      const closeDrawer = async () => {
        if (viewport.width < 720) await page.getByRole('button', { name: 'Close Library drawer', exact: true }).last().click();
      };
      await openDrawer(); await page.getByRole('button', { name: 'Manage collections' }).click();
      await page.getByLabel('New collection name').fill('Offline folder');
      await page.context().setOffline(true); await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText('Folder changes were not saved. Please retry.')).toBeVisible();
      const retained = await page.evaluate(async () => (await repository.pending()).filter(row => row.state !== 'committed'));
      expect(retained).toHaveLength(1); expect(retained[0].request.mode).toBe('folder');
      await page.context().setOffline(false); await page.reload();
      await openDrawer();
      await expect(page.locator('.pl-folder-select').filter({ hasText: 'Offline folder' })).toBeVisible();
      const recovered = await page.evaluate(async () => (await repository.pending()).find(row => row.request.mode === 'folder'));
      expect(recovered.operationId).toBe(retained[0].operationId); expect(recovered.state).toBe('committed');
      await closeDrawer();
      await expect(page.getByRole('button', { name: 'Favorite Shared prompt', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Inspect Shared prompt' }).click();
      await expect(page.getByText('Saving to the selected Library…')).toHaveCount(0);
      await page.getByRole('combobox', { name: 'Collection', exact: true }).selectOption('Offline folder');
      await page.getByRole('button', { name: 'Save details', exact: true }).click();
      await expect(page.getByText('Saved details for Shared prompt.')).toBeAttached();
      await expect(page.getByText('Saving to the selected Library…')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close prompt inspector' }).click();
      await openDrawer(); await page.getByRole('button', { name: 'Manage collections' }).click();
      await page.getByRole('button', { name: 'Rename / Move', exact: true }).click();
      await page.getByLabel('Rename Offline folder').fill('Confirmed folder');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.locator('.pl-folder-select').filter({ hasText: 'Confirmed folder' })).toBeVisible();
      await page.getByRole('button', { name: 'Artwork', exact: true }).click();
      await page.locator('summary').filter({ hasText: 'Collection artwork' }).click();
      await page.getByLabel('Collection artwork emoji').fill('🧪');
      await expect.poll(() => page.evaluate(async () => (await repository.readPromptLibrary()).folders[0].artwork.emoji)).toBe('🧪');
      await expect(page.getByText('Saving to the selected Library…')).toHaveCount(0);
      const drawerLayout = await page.locator('.pl-library-rail').evaluate(rail => {
        const bounds = rail.getBoundingClientRect();
        const controls = [...rail.querySelectorAll('.pl-collection-manager button, .pl-collection-manager input, .pl-collection-manager select')]
          .filter(node => node.getClientRects().length);
        return { fits: rail.scrollWidth <= rail.clientWidth && controls.every(node => {
          const rect = node.getBoundingClientRect(); return rect.left >= bounds.left && rect.right <= bounds.right;
        }), height: bounds.height, width: rail.clientWidth, scrollWidth: rail.scrollWidth,
        overflow: controls.filter(node => {
          const rect = node.getBoundingClientRect(); return rect.left < bounds.left || rect.right > bounds.right;
        }).map(node => ({ label: node.getAttribute('aria-label') || node.textContent, width: node.getBoundingClientRect().width })) };
      });
      expect(drawerLayout.fits, JSON.stringify(drawerLayout)).toBe(true);
      if (viewport.width < 720) expect(drawerLayout.height).toBeGreaterThan(viewport.height * 0.8);
      await page.screenshot({ path: test.info().outputPath(`folder-${viewport.width}.png`) });
      await page.getByRole('button', { name: 'Remove folder Confirmed folder, keep prompts' }).click();
      await expect(page.getByText('Folder removed; its prompts remain in All prompts.')).toBeAttached();
      const final = await page.evaluate(async () => ({ library: await repository.readPromptLibrary(), source: localStorage.getItem('pl2-library') }));
      expect(final.library.folders).toHaveLength(0);
      expect(final.library.library[0]).toMatchObject({ folderId: '', collection: '', future: { keep: true } });
      expect(final.library.library[0].versions.slice(0, 35)).toEqual(workspace.library[0].versions);
      expect(final.source).toBe(saved.original);
      expect(Object.keys((await adapter.read()).operations)).toHaveLength(10);
    } finally { await api.close(); await rm(directory, { recursive: true, force: true }); }
  });
}
