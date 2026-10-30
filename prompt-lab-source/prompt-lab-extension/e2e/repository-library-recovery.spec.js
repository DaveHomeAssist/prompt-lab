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
  test(`checkpoint review and offline restore preserve the Library at ${viewport.width}px`, async ({ page }) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'promptlab-recovery-ui-'));
    const folder = resolve(directory, 'library'), adapter = await createFolderAdapter(folder), service = createCommandService(adapter);
    const workspace = { library: [{ id: 'shared', title: 'Shared prompt', original: 'Preserve this prompt', favorite: false,
      versions: Array.from({ length: 35 }, (_, i) => ({ id: `v${i}`, original: `History ${i}` })), future: { keep: true } }],
      folders: [{ id: 'original-folder', name: 'Original folder', collection: 'Original folder', parentId: null, future: { keep: true } }], collections: ['Original folder'] };
    const values = { 'pl2-library': JSON.stringify(workspace.library), 'pl2-collections': JSON.stringify(workspace.collections),
      'pl2-collection-folders': JSON.stringify(workspace.folders) };
    const inventory = await captureSourceInventory({ surface: 'web', sourceIdentity: 'recovery-browser-fixture',
      localStorage: { length: Object.keys(values).length, key: index => Object.keys(values)[index], getItem: key => values[key] ?? null },
      readIndexedStore: async () => ({ state: 'absent', reason: 'Synthetic fixture' }), archives: { reviewed: true, records: [] } });
    const receipt = await service.apply({ ...await service.preview({ libraryId: 'fixture', expectedRevision: null, mode: 'import',
      sourceText: JSON.stringify(workspace), sourceInventory: inventory }), idempotencyKey: 'import' });
    const checkpoint = (await service.apply({ ...await service.previewCurrentView({ libraryId: 'fixture', expectedRevision: receipt.revision }), idempotencyKey: 'select' })).revision;
    const token = 'synthetic-recovery-credential'.repeat(3);
    const api = createLocalApi({ adapter, libraryId: 'fixture', allowedOrigins: [origin], credentials: [{ token, scopes: ['read', 'write'], expiresAt: Date.now() + 180_000 }] });
    try {
      const options = { baseUrl: await api.listen(), token, libraryId: 'fixture', sourceBinding: receipt.sourceBinding };
      await page.setViewportSize(viewport);
      await page.addInitScript(options => {
        window.fixtureOptions = options;
        localStorage.setItem('pl2-library', '[{"id":"personal-source","original":"Untouched"}]');
      }, options);
      await page.goto(`${origin}/e2e/fixtures/repository-library.html`);
      await page.getByRole('button', { name: 'Favorite Shared prompt', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Unfavorite Shared prompt', exact: true })).toBeVisible();
      const before = await adapter.read();
      await page.getByRole('button', { name: 'Recovery', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Library recovery' });
      await page.getByLabel('Recovery checkpoint').selectOption(checkpoint);
      await page.getByRole('button', { name: 'Review checkpoint', exact: true }).click();
      await expect(page.getByText('1 active prompts after restore')).toBeVisible();
      await expect(page.getByText('0 Trash records · 1 folders · 0 evaluations')).toBeVisible();
      expect(await adapter.read()).toEqual(before);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Recovery', exact: true })).toBeFocused();
      expect(await adapter.read()).toEqual(before);
      await page.getByRole('button', { name: 'Recovery', exact: true }).click();
      await page.getByLabel('Recovery checkpoint').selectOption(checkpoint);
      await page.getByRole('button', { name: 'Review checkpoint', exact: true }).click();
      await expect(page.getByText('1 active prompts after restore')).toBeVisible();
      const fits = await page.evaluate(() => ({ width: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight <= document.documentElement.clientHeight }));
      expect(fits).toEqual({ width: true, height: true });
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`recovery-${viewport.width}.png`) });
      await page.evaluate(() => window.setFixtureTheme('dark'));
      // Wait for the existing theme transition before inspecting its final colors.
      await expect.poll(() => page.getByRole('button', { name: 'Restore this checkpoint', exact: true }).evaluate(node => {
        const style = getComputedStyle(node); return { text: style.color, background: style.backgroundColor };
      })).toEqual({ text: 'rgb(33, 11, 5)', background: 'rgb(251, 122, 85)' });
      await page.screenshot({ path: test.info().outputPath(`recovery-dark-${viewport.width}.png`) });
      await page.context().setOffline(true);
      await page.getByRole('button', { name: 'Restore this checkpoint', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Retry this restore', exact: true })).toBeEnabled();
      const pending = await page.evaluate(async () => (await repository.pending()).filter(row => row.state !== 'committed'));
      expect(pending).toHaveLength(1); expect(pending[0].request.checkpointId).toBe(checkpoint);
      expect(await adapter.read()).toEqual(before);
      await page.context().setOffline(false); await page.evaluate(() => window.holdSave());
      await page.getByRole('button', { name: 'Retry this restore', exact: true }).click();
      await expect(page.getByText('Restoring the Library…')).toBeVisible();
      await expect(page.getByText('Checkpoint restored. Later history and backups are retained.')).toHaveCount(0);
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
      await page.evaluate(() => window.releaseSave());
      await expect(page.getByText('Checkpoint restored. Later history and backups are retained.')).toBeVisible();
      await page.getByRole('button', { name: 'Close recovery' }).click();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Favorite Shared prompt', exact: true })).toHaveAttribute('aria-pressed', 'false');
      const state = await page.evaluate(async () => ({ library: await repository.readPromptLibrary(), source: localStorage.getItem('pl2-library') }));
      expect(JSON.parse(JSON.stringify(state.library.library))).toEqual(workspace.library);
      expect(JSON.parse(JSON.stringify(state.library.folders))).toEqual(workspace.folders);
      expect(state.source).toBe('[{"id":"personal-source","original":"Untouched"}]');
      const after = await adapter.read();
      expect(Object.keys(after.operations)).toHaveLength(Object.keys(before.operations).length + 1);
      for (const [id, value] of Object.entries(before.objects)) expect(after.objects[id]).toEqual(value);
      expect(await (await createFolderAdapter(folder)).read()).toEqual(after);
    } finally { await api.close(); await rm(directory, { recursive: true, force: true }); }
  });
}
