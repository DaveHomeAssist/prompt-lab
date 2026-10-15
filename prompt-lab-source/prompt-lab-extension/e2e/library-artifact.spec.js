import fs from 'node:fs';
import { legacyLibraryFixture, verifyLegacyLibrary } from '../../scripts/verify-legacy-library.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const directory = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(directory, '../dist');
const artifactPath = process.env.PL_LIBRARY_CONTRACT_FILE || path.resolve(directory, '../../../contracts/promptlab-library-v2.json');
const artifacts = [JSON.parse(fs.readFileSync(artifactPath, 'utf8')), legacyLibraryFixture];
const surfaces = [{ name: 'extension', url: null }];
if (process.env.PL_COMPAT_WEB_URL) surfaces.push({ name: 'local-web', url: process.env.PL_COMPAT_WEB_URL });
if (process.env.PL_COMPAT_DESKTOP_URL) surfaces.push({ name: 'desktop-frontend', url: process.env.PL_COMPAT_DESKTOP_URL });

function checkRecords(library, artifact) {
  if (artifact === legacyLibraryFixture) { verifyLegacyLibrary(library); return; }
  const selected = library.filter(row => artifact.library.some(source => source.id === row.id));
  expect(selected.map(row => row.id)).toEqual(artifact.library.map(row => row.id));
  for (const [index, row] of selected.entries()) {
    const source = artifact.library[index];
    for (const field of ['id', 'title', 'original', 'enhanced', 'notes', 'variants', 'tags', 'collection', 'createdAt', 'updatedAt', 'updated_at', 'versions', 'currentVersionId']) {
      if (field === 'versions' && source.versions) expect(row.versions).toMatchObject(source.versions);
      else if (source[field] !== undefined) expect(row[field], `${source.id}: ${field}`).toEqual(source[field]);
    }
    if (source.metadata) expect(row.metadata).toMatchObject(source.metadata);
  }
}

for (const artifact of artifacts) for (const surface of surfaces) for (const width of [400, 1180]) {
  test(`${surface.name} imports schema ${artifact.schemaVersion} artifact and retains it through process restart at ${width}px`, async () => {
    test.setTimeout(120_000);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'promptlab-artifact-'));
    let context;
    const openLibrary = async page => {
      if (width < 720) await page.getByRole('navigation', { name: 'Primary mobile navigation' }).getByRole('button', { name: 'Library', exact: true }).click();
      else await page.getByRole('tablist', { name: 'Create views' }).getByRole('tab', { name: 'Library', exact: true }).click();
    };
    const readLibrary = page => page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library') || '[]'));
    const launch = async (libraryView = true) => {
      context = await chromium.launchPersistentContext(profile, {
        channel: 'chromium', headless: true, acceptDownloads: true,
        viewport: { width, height: 1000 },
        args: surface.url ? [] : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      await context.route('**/api/proxy', route => route.abort());
      await context.addInitScript(() => {
        localStorage.setItem('pl_telemetry_consent', 'denied');
        localStorage.setItem('pl2-billing', JSON.stringify({ plan: 'pro', status: 'active' }));
      });
      let url = surface.url;
      if (!url) {
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        url = `chrome-extension://${new URL(worker.url()).host}/panel.html`;
      }
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      await page.goto(url);
      if (libraryView) await openLibrary(page);
      return page;
    };
    try {
      let page = await launch(false);
      const original = `Packaged lifecycle schema ${artifact.schemaVersion} at ${width}px.`;
      await page.getByTestId('prompt-input').fill(original);
      await page.getByRole('button', { name: 'Save as new prompt', exact: true }).click();
      await expect.poll(async () => (await readLibrary(page)).filter(row => row.original === original).length).toBe(1);
      const created = (await readLibrary(page)).find(row => row.original === original);
      expect(created.id).toBeTruthy();
      await page.getByTestId('prompt-input').fill(`${original} Updated through the editor.`);
      await page.getByRole('button', { name: 'Save new version', exact: true }).click();
      await expect.poll(async () => (await readLibrary(page)).find(row => row.id === created.id)?.original).toBe(`${original} Updated through the editor.`);
      const saved = (await readLibrary(page)).find(row => row.id === created.id);
      expect(saved.versions.some(version => version.original === original)).toBe(true);
      await page.reload();
      await openLibrary(page);
      expect((await readLibrary(page)).find(row => row.id === saved.id)).toEqual(saved);
      await page.getByText('Starter Libraries', { exact: true }).click();
      const pack = page.getByText("Project Prompt Instruments — Dave's Suite", { exact: true }).locator('xpath=ancestor::div[.//button][1]');
      await pack.getByRole('button', { name: 'Load', exact: true }).click();
      await expect.poll(async () => (await readLibrary(page)).filter(row => row.metadata?.packId === 'lib_project_prompt_instruments').length).toBe(14);
      const loaded = (await readLibrary(page)).filter(row => row.metadata?.packId === 'lib_project_prompt_instruments');
      expect(loaded.every(row => row.metadata.packLoadedAt && row.title && (row.original || row.enhanced))).toBe(true);
      await page.getByRole('combobox', { name: 'Sort prompts', exact: true }).selectOption('newest');
      const first = await page.getByRole('list', { name: 'Saved prompts' }).getByRole('listitem').first().innerText();
      expect(loaded.some(row => first.includes(row.title))).toBe(true);
      await page.getByText('Starter Libraries', { exact: true }).click();
      await page.locator('[aria-label="Import Prompt Lab workspace"]').setInputFiles({ name: 'library-artifact.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) });
      const dialog = page.getByRole('dialog', { name: 'Review Library import' });
      await dialog.getByRole('button', { name: 'Apply import', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => page.evaluate(ids => JSON.parse(localStorage.getItem('pl2-library')).filter(row => ids.includes(row.id)).length, artifact.library.map(row => row.id))).toBe(artifact.library.length);
      checkRecords(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))), artifact);
      await page.reload();
      await expect.poll(() => page.evaluate(ids => JSON.parse(localStorage.getItem('pl2-library')).filter(row => ids.includes(row.id)).length, artifact.library.map(row => row.id))).toBe(artifact.library.length);
      checkRecords(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))), artifact);
      await context.close();
      page = await launch();
      expect((await readLibrary(page)).find(row => row.id === saved.id)).toEqual(saved);
      expect((await readLibrary(page)).filter(row => row.metadata?.packId === 'lib_project_prompt_instruments')).toEqual(loaded);
      checkRecords(await page.evaluate(() => JSON.parse(localStorage.getItem('pl2-library'))), artifact);
      await page.getByRole('combobox', { name: 'Sort prompts', exact: true }).selectOption('manual');
      await page.getByTestId('library-search').fill('');
      await expect(page.getByRole('list', { name: 'Saved prompts' }).getByRole('listitem').first()).toContainText(artifact.library[0].title);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export Library', exact: true }).click();
      const download = await downloadPromise;
      const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      checkRecords(exported.library, artifact);
      expect(exported.library.find(row => row.id === saved.id)).toEqual(saved);
      expect(exported.schemaVersion).toBe(2);
      for (const run of artifact.runs || []) expect(exported.runs.find(row => row.id === run.id)).toMatchObject({ promptId: run.promptId, promptVersionId: run.promptVersionId });
      for (const record of artifact.testCases || []) expect(exported.testCases.find(row => row.id === record.id)?.promptId).toBe(record.promptId);
      for (const record of artifact.trash || []) expect(exported.trash.some(row => row.id === record.id)).toBe(true);
      for (const collection of artifact.collections || []) expect(exported.collections).toContain(collection);
      await test.info().attach('cross-shell-export', { body: JSON.stringify(exported, null, 2), contentType: 'application/json' });
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      if (artifact.library.some(row => row.id === 'contract-child')) {
        await page.getByRole('button', { name: 'Inspect Contract follow-up' }).click();
        const provenance = page.getByRole('region', { name: 'Follow-up provenance' });
        await provenance.getByRole('button', { name: 'View source output' }).click();
        await expect(provenance).toContainText('Summarize {{incident}} with impact and actions.');
        await page.getByRole('button', { name: 'Close prompt inspector' }).click();
      }
    } finally {
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
